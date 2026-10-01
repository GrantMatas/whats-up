import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { defaultSettings } from '../../shared/defaults';
import { settingsSchema, radarSchema, idSchema, happeningSchema, sourceSchema, locationSchema, type AppSettings, type AppState, type Happening, type Radar, type Source, type Location, type EngineState, type RadarMatch, type SourceCheck, type CachedDocument } from '../../shared/models';
import { deduplicate } from '../deduplication';
import { rankHappening } from '../ranking';
import { evaluateRadar } from '../radar/matching';
import { searchHappenings, textCorpus, parseIntent, expandTopic } from '../search/intent';
import { nextCheck } from '../scheduler/policy';
import { IntelligenceStore } from './intelligence';
import { evidenceFromHappening, type ConfidenceWeights } from '../../shared/intelligence';
import { assessConfidence, meaningfulChanges, samePublisherIdentity, indexResearchSubjects } from '../research/confidence';

export function locationKey(location: Location): string { return location.key ?? location.name; }
export const emptyEngine: EngineState = { scanning: false, phase: 'idle', sourcesDiscovered: 0, sourcesHealthy: 0, sourcesFailed: 0, pagesChecked: 0, newHappenings: 0, updatedHappenings: 0, duplicatesMerged: 0, browserSessions: 0, failures: 0, httpRequests: 0, queueSize: 0, currentlyChecking: null, currentJob: null, lastScan: null, nextScan: null, error: null };
export interface CrawlJob { id: string; sourceId: string; locationKey: string; status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled'; priority: number; createdAt: string; updatedAt: string; error?: string }
export interface IngestResult { inserted: number; updated: number; duplicates: number; radarMatches: number }

export class LocalDatabase {
  private db: DatabaseSync;
  readonly intelligence: IntelligenceStore;
  constructor(filename: string) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.intelligence = new IntelligenceStore(this.db);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.migrate();
  }
  private transaction<T>(operation: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const result = operation(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  private migrate() {
    this.transaction(() => {
      const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
      this.db.exec(`CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS happenings (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS radars (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS saved (id TEXT PRIMARY KEY REFERENCES happenings(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS locations (location_key TEXT PRIMARY KEY, data TEXT NOT NULL, selected_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS source_locations (source_id TEXT REFERENCES sources(id) ON DELETE CASCADE, location_key TEXT NOT NULL, PRIMARY KEY(source_id,location_key));
        CREATE TABLE IF NOT EXISTS happening_locations (happening_id TEXT REFERENCES happenings(id) ON DELETE CASCADE, location_key TEXT NOT NULL, PRIMARY KEY(happening_id,location_key));
        CREATE TABLE IF NOT EXISTS source_checks (id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, location_key TEXT NOT NULL, checked_at TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS raw_documents (url TEXT PRIMARY KEY, body TEXT NOT NULL, content_type TEXT NOT NULL, fetched_at TEXT NOT NULL, expires_at TEXT NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS crawl_jobs (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, location_key TEXT NOT NULL, status TEXT NOT NULL, priority INTEGER NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS searches (id INTEGER PRIMARY KEY, query TEXT NOT NULL, location_key TEXT NOT NULL, searched_at TEXT NOT NULL, result_count INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS radar_matches (radar_id TEXT REFERENCES radars(id) ON DELETE CASCADE, happening_id TEXT REFERENCES happenings(id) ON DELETE CASCADE, data TEXT NOT NULL, PRIMARY KEY(radar_id,happening_id));
        CREATE TABLE IF NOT EXISTS geocode_cache (query TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS engine_state (location_key TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE VIRTUAL TABLE IF NOT EXISTS happenings_fts USING fts5(id UNINDEXED, content, tokenize='porter unicode61');
        CREATE INDEX IF NOT EXISTS happenings_category_idx ON happenings(json_extract(data,'$.category'));
        CREATE INDEX IF NOT EXISTS happenings_time_idx ON happenings(json_extract(data,'$.startTime'));
        CREATE INDEX IF NOT EXISTS happenings_mode_idx ON happenings(json_extract(data,'$.isDemo'));
        CREATE INDEX IF NOT EXISTS sources_mode_idx ON sources(json_extract(data,'$.isDemo'));
        CREATE INDEX IF NOT EXISTS source_checks_scope_idx ON source_checks(location_key,checked_at);
        CREATE INDEX IF NOT EXISTS crawl_jobs_scope_idx ON crawl_jobs(location_key,status,priority);
        CREATE INDEX IF NOT EXISTS raw_documents_expiry_idx ON raw_documents(expires_at);`);
      const settingsRow = this.db.prepare('SELECT data FROM settings WHERE id=1').get();
      if (!settingsRow) this.db.prepare('INSERT INTO settings VALUES(1, ?)').run(JSON.stringify(defaultSettings));
      if (version < 2 && settingsRow) {
        const settings = settingsSchema.parse({...JSON.parse(settingsRow.data as string), demoMode:false});
        settings.demoMode = false; settings.location.timezone ??= defaultSettings.location.timezone;
        this.db.prepare('UPDATE settings SET data=? WHERE id=1').run(JSON.stringify(settings));
        const key = locationKey(settings.location);
        for (const row of this.db.prepare('SELECT id,data FROM sources').all()) { const record = JSON.parse(row.data as string) as Source; this.db.prepare('INSERT OR IGNORE INTO source_locations VALUES(?,?)').run(row.id, record.locationKey ?? key); }
        for (const row of this.db.prepare('SELECT id,data FROM happenings').all()) { const record = JSON.parse(row.data as string) as Happening; this.db.prepare('INSERT OR IGNORE INTO happening_locations VALUES(?,?)').run(row.id, record.locationKey ?? key); this.db.prepare('INSERT INTO happenings_fts(id,content) VALUES(?,?)').run(row.id, textCorpus(record)); }
      }
      this.intelligence.migrate();
      if(version<4){
        const oldSettings=JSON.parse(this.db.prepare('SELECT data FROM settings WHERE id=1').get()!.data as string);
        this.db.prepare('UPDATE settings SET data=? WHERE id=1').run(JSON.stringify(settingsSchema.parse({...oldSettings,demoMode:false})));
        this.db.exec("DELETE FROM happenings_fts WHERE id IN (SELECT id FROM happenings WHERE json_extract(data,'$.isDemo')=1); DELETE FROM happenings WHERE json_extract(data,'$.isDemo')=1; DELETE FROM sources WHERE json_extract(data,'$.isDemo')=1; DELETE FROM source_checks WHERE source_id NOT IN (SELECT id FROM sources); DELETE FROM raw_documents WHERE content_type='application/vnd.whatsup.fixture+json';");
      }
      this.db.exec('PRAGMA user_version=4;');
    });
  }
  private settings(): AppSettings { return settingsSchema.parse(JSON.parse(this.db.prepare('SELECT data FROM settings WHERE id=1').get()!.data as string)); }
  getSettings(): AppSettings { return this.settings(); }
  private records<T>(table: 'happenings' | 'sources' | 'radars'): T[] { return this.db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(r => JSON.parse(r.data as string) as T); }
  private active<T extends Happening | Source>(table: 'happenings' | 'sources', settings = this.settings()): T[] {
    if (!settings.onboarded) return [];
    const links = table === 'happenings' ? 'happening_locations' : 'source_locations'; const field = table === 'happenings' ? 'happening_id' : 'source_id';
    return this.db.prepare(`SELECT r.data FROM ${table} r WHERE json_extract(r.data,'$.isDemo')=? AND (?=1 OR EXISTS(SELECT 1 FROM ${links} l WHERE l.${field}=r.id AND l.location_key=?)) ORDER BY r.rowid`).all(settings.demoMode ? 1 : 0, settings.demoMode ? 1 : 0, locationKey(settings.location)).map(r => JSON.parse(r.data as string) as T);
  }
  getState(): AppState {
    const settings = this.settings(); const happenings = this.active<Happening>('happenings', settings); const sources = this.active<Source>('sources', settings);
    const ids = new Set(happenings.map(h => h.id)); const key = locationKey(settings.location);
    const radars = this.records<Radar>('radars').filter(r => !r.locationKey || r.locationKey === key);
    const radarIds = new Set(radars.map(r => r.id));
    const radarMatches = this.db.prepare('SELECT data FROM radar_matches').all().map(row => JSON.parse(row.data as string) as RadarMatch).filter(m => ids.has(m.happeningId) && radarIds.has(m.radarId));
    return { settings, happenings, sources, radars, savedIds: this.db.prepare('SELECT id FROM saved ORDER BY rowid').all().map(row => row.id as string).filter(id => ids.has(id)), engine: settings.demoMode ? { ...emptyEngine, phase: 'demo' } : this.getEngineState(), radarMatches, intelligence:this.intelligence.state(key,ids) };
  }
  saveSettings(value: AppSettings): AppState {
    const settings = settingsSchema.parse(value);
    this.transaction(() => {
      this.db.prepare('UPDATE settings SET data=? WHERE id=1').run(JSON.stringify(settings));
      this.db.prepare('INSERT INTO locations VALUES(?,?,?) ON CONFLICT(location_key) DO UPDATE SET data=excluded.data, selected_at=excluded.selected_at').run(locationKey(settings.location), JSON.stringify(settings.location), new Date().toISOString());
      // The selection table contains the current location only, not a movement history.
      this.db.prepare('DELETE FROM locations WHERE location_key<>?').run(locationKey(settings.location));

    });
    return this.getState();
  }
  toggleSaved(value: string): AppState {
    const id = idSchema.parse(value); if (!this.getState().happenings.some(h => h.id === id)) throw new Error('Happening does not exist in this area');
    this.transaction(() => { if (this.db.prepare('SELECT id FROM saved WHERE id=?').get(id)) this.db.prepare('DELETE FROM saved WHERE id=?').run(id); else this.db.prepare('INSERT INTO saved VALUES(?)').run(id); }); return this.getState();
  }
  saveRadar(value: Radar): AppState { const intent=parseIntent(value.query); const radar = radarSchema.parse({...value,topics:intent.topics,exclusions:intent.exclusions,timePreference:intent.timeWindow}); radar.locationKey ??= locationKey(this.settings().location); if (this.records<Radar>('radars').length >= 100 && !this.db.prepare('SELECT id FROM radars WHERE id=?').get(radar.id)) throw new Error('Limit of 100 Radars reached'); this.db.prepare('INSERT INTO radars VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(radar.id, JSON.stringify(radar)); this.refreshRadars(); return this.getState(); }
  deleteRadar(value: string): AppState { this.db.prepare('DELETE FROM radars WHERE id=?').run(idSchema.parse(value)); return this.getState(); }
  private writeHappening(h: Happening, key: string) { this.db.prepare('INSERT INTO happenings VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(h.id, JSON.stringify(h)); this.db.prepare('INSERT OR IGNORE INTO happening_locations VALUES(?,?)').run(h.id, key); this.db.prepare('DELETE FROM happenings_fts WHERE id=?').run(h.id); this.db.prepare('INSERT INTO happenings_fts(id,content) VALUES(?,?)').run(h.id, textCorpus(h)); }
  private writeSource(s: Source, key: string) { this.db.prepare('INSERT INTO sources VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(s.sourceId, JSON.stringify(s)); this.db.prepare('INSERT OR IGNORE INTO source_locations VALUES(?,?)').run(s.sourceId, key); }
  upsertSources(values: Source[], key = locationKey(this.settings().location)): Source[] {
    const validated = values.map(value => sourceSchema.parse(value));
    this.transaction(() => { for (const source of validated) { const row = this.db.prepare('SELECT data FROM sources WHERE id=?').get(source.sourceId); const previous = row ? JSON.parse(row.data as string) as Source : null; const isCheckUpdate = source.lastChecked !== null && (!previous?.lastChecked || Date.parse(source.lastChecked) >= Date.parse(previous.lastChecked)); this.writeSource(previous ? (isCheckUpdate ? { ...previous, ...source } : { ...source, ...previous }) : source, key); } });
    return this.active<Source>('sources');
  }
  ingest(values: Happening[], key = locationKey(this.settings().location)): IngestResult {
    const settings = this.settings(); const now = new Date().toISOString(); const validated = values.map(value => happeningSchema.parse(value));
    const existing = this.db.prepare(`SELECT h.data FROM happenings h JOIN happening_locations l ON l.happening_id=h.id WHERE l.location_key=? AND json_extract(h.data,'$.isDemo')=0`).all(key).map(r => JSON.parse(r.data as string) as Happening);
    const old = new Map(existing.map(h => [h.id, h])); const combined = new Map(existing.map(h => [h.id, h]));
    const publisherIndex=new Map<string,Happening[]>();for(const h of existing){const key=`${h.sourceId}|${h.sourceUrl}`;publisherIndex.set(key,[...(publisherIndex.get(key)||[]),h]);}
    const incoming=validated.map(h=>{if(old.has(h.id))return h;const candidates=(publisherIndex.get(`${h.sourceId}|${h.sourceUrl}`)||[]).filter(before=>samePublisherIdentity(before,h));return candidates.length===1?{...h,id:candidates[0].id}:h;});
    for (const h of incoming) { const previous = combined.get(h.id); combined.set(h.id, rankHappening(previous ? { ...h, discoveredAt: previous.discoveredAt, relatedSources: [...previous.relatedSources, ...h.relatedSources] } : h, settings.interests, settings.location, now)); }
    const aliases = new Map<string,string>();
    const merged = deduplicate([...combined.values()], (removed,retained) => aliases.set(removed,retained)); let inserted = 0; let updated = 0;
    const relatedTo=indexResearchSubjects(merged);const touched=new Set(incoming.map(h=>h.id));for(const [removed,retained] of aliases){touched.add(removed);touched.add(retained);}for(const h of incoming)for(const other of relatedTo(h))touched.add(other.id);
    this.transaction(() => {
      const retained=(id:string)=>{const seen=new Set<string>();while(aliases.has(id)&&!seen.has(id)){seen.add(id);id=aliases.get(id)!;}return id;};
      for(const h of incoming)this.intelligence.addEvidence(evidenceFromHappening({...h,id:retained(h.id)}),key);
      for(const [removed,id] of aliases)this.intelligence.mergeEvidence(removed,retained(id),key);
      for (const h of merged) {
        if(!touched.has(h.id))continue;
        const before = old.get(h.id);const changes=before?meaningfulChanges(before,h):[];
        const referencesChanged=!!before&&h.relatedSources.some(source=>!before.relatedSources.some(previous=>previous.url===source.url));
        if(before&&!changes.length&&!referencesChanged)h.updatedAt=before.updatedAt;
        const previousAssessment=this.intelligence.assessmentFor(h.id,key);
        const evidence=this.intelligence.evidenceFor(h.id,key);
        for(const related of relatedTo(h))evidence.push(...this.intelligence.evidenceFor(related.id,key).map(item=>({...item,happeningId:h.id})));
        const checks=Number(this.db.prepare("SELECT COUNT(*) n FROM source_checks WHERE source_id=? AND status IN ('success','not-modified')").get(h.sourceId||'')!.n);
        const assessment=assessConfidence(h.id,evidence,now,settings.confidenceWeights as Partial<ConfidenceWeights>,checks);
        h.confidence=assessment.score;this.intelligence.saveAssessment(assessment,key);
        if (!before) {inserted++;this.intelligence.history({happeningId:h.id,at:now,kind:'new',description:`First discovered from ${h.sourceName}.`,confidence:h.confidence},key);}
        else if(changes.length||referencesChanged){updated++;this.intelligence.history({happeningId:h.id,at:now,kind:'updated',description:changes.length?'Publisher details changed.':'Additional source references found.',changes,previousConfidence:before.confidence,confidence:h.confidence},key);}
        if(assessment.contradictions.length&&JSON.stringify(previousAssessment?.contradictions)!==JSON.stringify(assessment.contradictions))this.intelligence.history({happeningId:h.id,at:now,kind:'conflicting',description:assessment.contradictions.map(c=>c.description).join(' '),confidence:h.confidence},key);
        if(assessment.evidence.some(e=>e.cancelled)&&!previousAssessment?.evidence.some(e=>e.cancelled))this.intelligence.history({happeningId:h.id,at:now,kind:'cancelled',description:'An original source published a cancellation status. Check its evidence link.',confidence:h.confidence},key);
        if(assessment.score>=75&&assessment.evidence.length>=2&&(!previousAssessment||previousAssessment.score<75)&&!assessment.contradictions.length)this.intelligence.history({happeningId:h.id,at:now,kind:'confirmed',description:'Matching source evidence raised confidence; inspect the evidence before relying on it.',previousConfidence:before?.confidence,confidence:h.confidence},key);
        this.writeHappening(h, key);
      }
      for (const [removed,retained] of aliases) {
        this.db.prepare('INSERT OR IGNORE INTO happening_locations(happening_id,location_key) SELECT ?,location_key FROM happening_locations WHERE happening_id=?').run(retained,removed);
        this.db.prepare('INSERT OR IGNORE INTO saved(id) SELECT ? FROM saved WHERE id=?').run(retained,removed);
        this.db.prepare('DELETE FROM happenings_fts WHERE id=?').run(removed);
        this.db.prepare('DELETE FROM happenings WHERE id=?').run(removed);
      }
    });
    const radarMatches = key === locationKey(settings.location) ? this.refreshRadars(now) : 0;
    return { inserted, updated, duplicates: combined.size - merged.length + validated.length - new Set(validated.map(h => h.id)).size, radarMatches };
  }
  attachResearch(id:string,reference:Happening,key:string){
    const row=this.db.prepare('SELECT h.data FROM happenings h JOIN happening_locations l ON l.happening_id=h.id WHERE h.id=? AND l.location_key=?').get(id,key);if(!row)return;
    const h=JSON.parse(row.data as string) as Happening;const evidence=evidenceFromHappening({...reference,id});const prior=this.intelligence.assessmentFor(id,key);this.intelligence.addEvidence(evidence,key);
    const assessment=assessConfidence(id,this.intelligence.evidenceFor(id,key),new Date().toISOString(),this.getSettings().confidenceWeights as Partial<ConfidenceWeights>);this.intelligence.saveAssessment(assessment,key);
    h.confidence=assessment.score;if(!h.relatedSources.some(source=>source.url===reference.sourceUrl))h.relatedSources.push({name:reference.sourceName,url:reference.sourceUrl,type:reference.sourceType});this.writeHappening(h,key);
    if(!prior?.evidence.some(e=>e.sourceUrl===evidence.sourceUrl)||JSON.stringify(prior.contradictions)!==JSON.stringify(assessment.contradictions))this.intelligence.history({happeningId:id,at:new Date().toISOString(),kind:assessment.contradictions.length?'conflicting':assessment.evidence.some(e=>e.cancelled)?'cancelled':'research',description:`Checked ${reference.sourceName}; ${assessment.contradictions.length?'published details disagree': 'stored the matching original reference'}.`,previousConfidence:prior?.score,confidence:assessment.score},key);
  }
  refreshRadars(now?: string): number {
    const state = this.getState(); const clock = now ?? new Date().toISOString(); let count = 0;
    this.transaction(() => { for (const radar of state.radars) { const matches = evaluateRadar(radar, state.happenings, state.settings, clock); const previous = new Set(this.db.prepare('SELECT happening_id FROM radar_matches WHERE radar_id=?').all(radar.id).map(r => r.happening_id as string)); this.db.prepare('DELETE FROM radar_matches WHERE radar_id=?').run(radar.id); for (const match of matches) { match.isNew = !previous.has(match.happeningId); this.db.prepare('INSERT INTO radar_matches VALUES(?,?,?)').run(match.radarId, match.happeningId, JSON.stringify(match)); count++; } this.db.prepare('UPDATE radars SET data=? WHERE id=?').run(JSON.stringify({ ...radar, lastScan: clock }), radar.id); } });
    return count;
  }
  getDueSources(now: number | string = Date.now(), force = false): Source[] { const clock = typeof now === 'string' ? Date.parse(now) : now; return this.active<Source>('sources').filter(s => s.enabled !== false && !s.isDemo && (force || !s.nextCheckAt || Date.parse(s.nextCheckAt) <= clock)).sort((a, b) => a.checkFrequency - b.checkFrequency); }
  recordCheck(check: SourceCheck): void {
    const row = this.db.prepare('SELECT data FROM sources WHERE id=?').get(check.sourceId); if (!row) throw new Error('Source does not exist');
    const source = JSON.parse(row.data as string) as Source; const success = check.status === 'success' || check.status === 'not-modified';
    const alreadyUpdated = source.lastChecked === check.checkedAt;
    source.lastChecked = check.checkedAt; if (success) source.lastSuccessful = check.checkedAt;
    source.failureCount = success ? 0 : source.failureCount + (alreadyUpdated ? 0 : 1); source.unchangedChecks = check.status === 'not-modified' ? (source.unchangedChecks ?? 0) + (alreadyUpdated ? 0 : 1) : 0;
    source.status = success ? 'healthy' : check.status === 'blocked' ? 'blocked' : 'failed'; source.lastError = check.error ?? null;
    if (check.etag !== undefined) source.etag = check.etag; if (check.lastModified !== undefined) source.lastModified = check.lastModified;
    source.nextCheckAt = new Date(nextCheck(source, Date.parse(check.checkedAt), source.unchangedChecks)).toISOString();
    this.transaction(() => { this.db.prepare('UPDATE sources SET data=? WHERE id=?').run(JSON.stringify(source), source.sourceId); this.db.prepare('INSERT INTO source_checks(source_id,location_key,checked_at,status,data) VALUES(?,?,?,?,?)').run(source.sourceId, locationKey(this.settings().location), check.checkedAt, check.status, JSON.stringify(check)); this.db.exec('DELETE FROM source_checks WHERE id NOT IN(SELECT id FROM source_checks ORDER BY id DESC LIMIT 2000)'); });
  }
  getSourceChecks(limit = 100): SourceCheck[] { return this.db.prepare('SELECT data FROM source_checks WHERE location_key=? ORDER BY id DESC LIMIT ?').all(locationKey(this.settings().location), Math.min(2000, Math.max(1, limit))).map(r => JSON.parse(r.data as string) as SourceCheck); }
  getSourceHistory(id:string):SourceCheck[]{const key=locationKey(this.settings().location);if(!this.db.prepare('SELECT source_id FROM source_locations WHERE source_id=? AND location_key=?').get(id,key))throw Error('Source not found in the selected area');return this.db.prepare('SELECT data FROM source_checks WHERE source_id=? AND location_key=? ORDER BY id DESC LIMIT 30').all(id,key).map(row=>JSON.parse(row.data as string));}
  hasImageUrl(url:string):boolean {const settings=this.settings();if(!settings.onboarded)return false;return !!this.db.prepare("SELECT h.id FROM happenings h JOIN happening_locations l ON l.happening_id=h.id JOIN json_each(h.data,'$.images') i WHERE i.value=? AND l.location_key=? AND json_extract(h.data,'$.isDemo')=? LIMIT 1").get(url,locationKey(settings.location),settings.demoMode?1:0);}
  getCachedDocument(url: string): CachedDocument | null { const row = this.db.prepare('SELECT data,body FROM raw_documents WHERE url=?').get(url); return row ? { ...JSON.parse(row.data as string), body: row.body } as CachedDocument : null; }
  cacheDocument(document: CachedDocument): void {
    if (Buffer.byteLength(document.body, 'utf8') > 2 * 1024 * 1024) return;
    this.transaction(() => { const { body: _body, ...metadata } = document; this.db.prepare('INSERT INTO raw_documents VALUES(?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET body=excluded.body,content_type=excluded.content_type,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at,data=excluded.data').run(document.url, document.body, document.contentType, document.fetchedAt, document.expiresAt, JSON.stringify(metadata)); this.db.exec('DELETE FROM raw_documents WHERE url NOT IN(SELECT url FROM raw_documents ORDER BY fetched_at DESC LIMIT 100)'); while (Number(this.db.prepare('SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) AS bytes FROM raw_documents').get()!.bytes) > 20 * 1024 * 1024) this.db.exec('DELETE FROM raw_documents WHERE url=(SELECT url FROM raw_documents ORDER BY fetched_at LIMIT 1)'); });
  }
  getGeocode(query: string): Location | null { const row = this.db.prepare('SELECT data FROM geocode_cache WHERE query=?').get(query.trim().toLowerCase()); return row ? locationSchema.parse(JSON.parse(row.data as string)) : null; }
  cacheGeocode(query: string, value: Location): void { const location = locationSchema.parse(value); this.db.prepare('INSERT INTO geocode_cache VALUES(?,?,?) ON CONFLICT(query) DO UPDATE SET data=excluded.data,cached_at=excluded.cached_at').run(query.trim().toLowerCase(), JSON.stringify(location), new Date().toISOString()); this.db.exec('DELETE FROM geocode_cache WHERE query NOT IN(SELECT query FROM geocode_cache ORDER BY cached_at DESC LIMIT 100)'); }
  getEngineState(): EngineState { const row = this.db.prepare('SELECT data FROM engine_state WHERE location_key=?').get(locationKey(this.settings().location)); return row ? { ...emptyEngine, ...JSON.parse(row.data as string) } : { ...emptyEngine }; }
  setEngineState(patch: Partial<EngineState>, key = locationKey(this.settings().location)): EngineState { const row = this.db.prepare('SELECT data FROM engine_state WHERE location_key=?').get(key); const state = { ...emptyEngine, ...(row ? JSON.parse(row.data as string) : {}), ...patch }; this.db.prepare('INSERT INTO engine_state VALUES(?,?) ON CONFLICT(location_key) DO UPDATE SET data=excluded.data').run(key, JSON.stringify(state)); return state; }
  search(query: string): Happening[] {
    if (query.length > 600) throw new Error('Search is too long'); const settings = this.settings(); const intent = parseIntent(query);
    let candidates: Happening[] = [];
    if (settings.onboarded && intent.topics.length) {
      // Tokens are generated by our tokenizer, never interpreted as caller-supplied FTS syntax.
      const match = intent.topics.map(topic => `(${expandTopic(topic).filter(t => /^[a-z0-9]+$/.test(t)).map(t => `"${t}"`).join(' OR ')})`).join(' AND ');
      candidates = this.db.prepare(`SELECT h.data FROM happenings_fts f JOIN happenings h ON h.id=f.id WHERE happenings_fts MATCH ? AND json_extract(h.data,'$.isDemo')=? AND (?=1 OR EXISTS(SELECT 1 FROM happening_locations l WHERE l.happening_id=h.id AND l.location_key=?)) ORDER BY bm25(happenings_fts)`).all(match, settings.demoMode ? 1 : 0, settings.demoMode ? 1 : 0, locationKey(settings.location)).map(r => JSON.parse(r.data as string) as Happening);
    } else candidates = this.active<Happening>('happenings', settings);
    const result = searchHappenings(candidates, query, settings.location, settings.radiusMiles, new Date().toISOString());
    this.db.prepare('INSERT INTO searches(query,location_key,searched_at,result_count) VALUES(?,?,?,?)').run(query, locationKey(settings.location), new Date().toISOString(), result.length); this.db.exec('DELETE FROM searches WHERE id NOT IN(SELECT id FROM searches ORDER BY id DESC LIMIT 100)'); return result;
  }
  queueJob(value: string | (Partial<CrawlJob> & Pick<CrawlJob, 'sourceId'>)): string { const input = typeof value === 'string' ? { sourceId: value } : value; const now = new Date().toISOString(); const key = input.locationKey ?? locationKey(this.settings().location); const id = input.id ?? createHash('sha256').update(`${key}:${input.sourceId}`).digest('hex').slice(0, 24); const job: CrawlJob = { locationKey: key, status: 'queued', priority: 50, createdAt: now, updatedAt: now, ...input, id }; this.db.prepare('INSERT INTO crawl_jobs VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,priority=excluded.priority,updated_at=excluded.updated_at,data=excluded.data').run(id, job.sourceId, key, job.status, job.priority, now, JSON.stringify(job)); return id; }
  updateJob(id: string, update: Partial<CrawlJob> | CrawlJob['status'] | 'completed', error?: string): void { const patch = typeof update === 'string' ? { status: update === 'completed' ? 'complete' as const : update, ...(error ? { error } : {}) } : update; const row = this.db.prepare('SELECT data FROM crawl_jobs WHERE id=?').get(id); if (!row) return; const job = { ...JSON.parse(row.data as string), ...patch, id, updatedAt: new Date().toISOString() } as CrawlJob; this.db.prepare('UPDATE crawl_jobs SET status=?,priority=?,updated_at=?,data=? WHERE id=?').run(job.status, job.priority, job.updatedAt, JSON.stringify(job), id); }
  getAggregates() {
    const settings = this.settings(); const mode = settings.demoMode ? 1 : 0; const key = locationKey(settings.location);
    const condition = `json_extract(h.data,'$.isDemo')=? AND (?=1 OR EXISTS(SELECT 1 FROM happening_locations l WHERE l.happening_id=h.id AND l.location_key=?))`;
    const rows = this.db.prepare(`SELECT json_extract(h.data,'$.category') category, COUNT(*) count, SUM(CASE WHEN json_extract(h.data,'$.latitude') IS NOT NULL AND json_extract(h.data,'$.longitude') IS NOT NULL THEN 1 ELSE 0 END) mapped FROM happenings h WHERE ${condition} GROUP BY category`).all(mode, mode, key);
    const sources = this.active<Source>('sources', settings); const state = this.getState();
    return { total: rows.reduce((sum, row) => sum + Number(row.count), 0), byCategory: Object.fromEntries(rows.map(row => [row.category, Number(row.count)])), mapped: rows.reduce((sum, row) => sum + Number(row.mapped), 0), sourceCount: sources.length, sourcesHealthy: sources.filter(s => s.status === 'healthy').length, sourcesFailed: sources.filter(s => s.status === 'failed' || s.status === 'blocked').length, radarMatches: state.radarMatches?.length ?? 0 };
  }
  resetSetup():AppState {const before=this.settings();return this.saveSettings({...defaultSettings,theme:before.theme,density:before.density,motion:before.motion});}
  resetData(): AppState { this.transaction(() => { this.db.exec('DELETE FROM saved; DELETE FROM radar_matches; DELETE FROM radars; DELETE FROM happenings; DELETE FROM sources; DELETE FROM happenings_fts; DELETE FROM source_checks; DELETE FROM raw_documents; DELETE FROM crawl_jobs; DELETE FROM searches; DELETE FROM geocode_cache; DELETE FROM locations; DELETE FROM engine_state;'); this.intelligence.reset(); this.db.prepare('UPDATE settings SET data=? WHERE id=1').run(JSON.stringify(defaultSettings)); }); this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); return this.getState(); }
  close() { this.db.close(); }
}
