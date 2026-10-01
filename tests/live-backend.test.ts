import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDatabase, locationKey } from '../src/backend/database';
import { testSettings as defaultSettings } from './fixtures/test-records';
import { testHappenings, testSources } from './fixtures/test-records';
import { happeningSchema, type Happening } from '../src/shared/models';
import { matchesIntent, matchesTime, parseIntent, searchHappenings, timeBounds } from '../src/backend/search/intent';

const clock = '2026-11-01T16:00:00.000Z';
const real = (extra: Partial<Happening> = {}): Happening => ({ ...testHappenings[0], id: 'real-event', isDemo: false, sourceId: 'real-source', sourceName: 'Public venue', sourceUrl: 'https://venue.example/events/1', originalUrl: 'https://venue.example/events/1', title: 'Workshop with the makers', tags: ['technology', 'software', 'student'], category: 'technology', startTime: '2026-11-02T16:00:00Z', endTime: '2026-11-02T18:00:00Z', discoveredAt: clock, updatedAt: clock, lastVerifiedAt: clock, ...extra });
describe('real ingestion database', () => {
  it('starts empty and rejects a request to enable legacy demo mode', () => {
    const db=new LocalDatabase(':memory:');db.saveSettings({...defaultSettings,onboarded:true});
    expect(db.getState().happenings).toEqual([]);expect(()=>db.saveSettings({...defaultSettings,onboarded:true,demoMode:true})).toThrow();db.close();
  });
  it('removes previously stored duplicates while preserving saved records and provenance', () => {
    const db=new LocalDatabase(':memory:');db.saveSettings({...defaultSettings,onboarded:true});
    const original=real();const other=real({id:'other',title:'A different title',sourceUrl:'https://other.example/1',originalUrl:'https://other.example/1'});
    db.ingest([original,other]);db.toggleSaved('other');
    db.ingest([{...other,title:original.title}]);
    expect(db.getState().happenings).toHaveLength(1);expect(db.getState().savedIds).toEqual([original.id]);
    expect(db.getState().happenings[0].relatedSources.some(s=>s.url===other.sourceUrl)).toBe(true);
    expect(db.search('different title')).toEqual([]);db.close();
  });
  it('preserves real records and isolates selected cities', () => {
    const db = new LocalDatabase(':memory:');
    expect(defaultSettings.demoMode).toBe(false);
    db.saveSettings({ ...defaultSettings, onboarded: true });
    db.upsertSources([{ ...testSources[0], sourceId: 'real-source', isDemo: false }]);
    expect(db.ingest([real()]).inserted).toBe(1);
    expect(db.search('software workshop').map(h => h.id)).toEqual(['real-event']);
    expect(db.search('" OR * ; DROP TABLE happenings; --')).toEqual([]);
    db.toggleSaved('real-event');
    expect(db.getState().happenings.map(h=>h.id)).toEqual(['real-event']);expect(db.getState().savedIds).toEqual(['real-event']);
    db.saveSettings({ ...defaultSettings, onboarded: true, location: { name: 'London', latitude: 51.5, longitude: -0.1, timezone: 'Europe/London' } });
    expect(db.getState().happenings).toEqual([]); expect(db.getDueSources()).toEqual([]);
    db.saveSettings({ ...defaultSettings, onboarded: true }); expect(db.getState().happenings).toHaveLength(1); db.close();
  });
  it('keeps source checks/cache across rediscovery and links one source to multiple locations', () => {
    const db = new LocalDatabase(':memory:'); db.saveSettings({ ...defaultSettings, onboarded: true });
    const source = { ...testSources[0], sourceId: 'real-source', isDemo: false, lastChecked: null, lastSuccessful: null };
    db.upsertSources([source]); db.recordCheck({ sourceId: source.sourceId, checkedAt: clock, status: 'failed', error: 'Timeout' }); db.upsertSources([source]);
    expect(db.getState().sources[0].failureCount).toBe(1); expect(db.getState().sources[0].lastError).toBe('Timeout');
    db.cacheDocument({ url: source.url, body: '<rss/>', contentType: 'application/rss+xml', fetchedAt: clock, expiresAt: '2026-11-08T16:00:00Z' });
    expect(db.getCachedDocument(source.url)?.body).toBe('<rss/>');
    const other = { name: 'Another area', latitude: 41, longitude: -85 };
    db.upsertSources([source], locationKey(other)); db.saveSettings({ ...defaultSettings, onboarded: true, location: other });
    expect(db.getState().sources).toHaveLength(1); expect(db.getSourceChecks()).toEqual([]);
    db.cacheGeocode('Some Place', other); expect(db.getGeocode('some place')).toEqual(other);
    db.resetData(); expect(db.getCachedDocument(source.url)).toBeNull(); expect(db.getGeocode('some place')).toBeNull(); db.close();
  });
  it('updates same ID without losing discovery time, dedupes independent URLs and stores Radar reasons', () => {
    const db = new LocalDatabase(':memory:'); db.saveSettings({ ...defaultSettings, onboarded: true });
    db.saveRadar({ id: 'tech', name: 'Tech', query: 'technology workshop', radiusMiles: 50, enabled: true, createdAt: clock });
    db.ingest([real()]); db.ingest([real({ title: 'Updated workshop with the makers', discoveredAt: '2026-11-03T16:00:00Z' })]);
    expect(db.getState().happenings[0].title).toContain('Updated'); expect(db.getState().happenings[0].discoveredAt).toBe(clock);
    const matches = db.getState().radarMatches!; expect(matches).toHaveLength(1); expect(matches[0].reasons).toContain('Matches topic: technology');
    db.close();
  });
  it('migrates v1 without treating prior fixtures as real', () => {
    const filename = join(mkdtempSync(join(tmpdir(), 'whatsup-migrate-')), 'local.sqlite'); const old = new DatabaseSync(filename);
    old.exec('CREATE TABLE settings(id INTEGER PRIMARY KEY,data TEXT); CREATE TABLE happenings(id TEXT PRIMARY KEY,data TEXT); PRAGMA user_version=1;');
    old.prepare('INSERT INTO settings VALUES(1,?)').run(JSON.stringify({ ...defaultSettings, onboarded: true, demoMode: true }));
    old.prepare('INSERT INTO happenings VALUES(?,?)').run(testHappenings[0].id, JSON.stringify({...testHappenings[0],isDemo:true})); old.close();
    const db = new LocalDatabase(filename); expect(db.getState().settings.demoMode).toBe(false); expect(db.getState().happenings).toEqual([]); expect(db.getState().happenings).toEqual([]); db.close();
  });
});
describe('generic search and calendar logic', () => {
  it('persists structured Radar terms and applies exclusions without treating them as required words', () => {
    const db=new LocalDatabase(':memory:');db.saveSettings({...defaultSettings,onboarded:true});
    db.ingest([real({title:'Software workshop for children',tags:['software','workshop','children']}),real({id:'adults',title:'Workshop for developers',tags:['software','workshop'],sourceUrl:'https://venue.example/adults',originalUrl:'https://venue.example/adults'})]);
    expect(db.search('software workshop without children').map(h=>h.id)).toEqual(['adults']);
    const state=db.saveRadar({id:'adults-radar',name:'Workshops',query:'software workshop without children',radiusMiles:50,enabled:true,createdAt:clock});
    expect(state.radars[0].exclusions).toEqual(['children']);expect(state.radarMatches?.map(m=>m.happeningId)).toEqual(['adults']);db.close();
  });
  it('handles 23- and 25-hour local days and different time zones', () => {
    const spring = timeBounds('today', '2026-03-08T15:00:00Z', 'America/New_York')!;
    const fall = timeBounds('today', clock, 'America/New_York')!;
    expect(spring[1] - spring[0]).toBe(23 * 3600000); expect(fall[1] - fall[0]).toBe(25 * 3600000);
    const item = real({ startTime: '2026-11-02T02:00:00Z', endTime: '2026-11-02T03:00:00Z' });
    expect(matchesTime(item, 'today', '2026-11-01T12:00:00Z', 'America/New_York')).toBe(true); expect(matchesTime(item, 'today', '2026-11-01T12:00:00Z', 'Asia/Tokyo')).toBe(false);
  });
  it('matches genre metadata without artist hardcoding; includes honest unknown-location results', () => {
    const item = real({ title: 'An unfamiliar artist', summary: 'A live performance', tags: ['thrash', 'music'], category: 'music', latitude: null, longitude: null, geometry: null, geometryType: null, startTime: null, endTime: null });
    expect(happeningSchema.safeParse(item).success).toBe(true);
    expect(matchesIntent(item, parseIntent('metal concerts'), defaultSettings.location, 25, clock)).toBe(true);
    expect(matchesIntent(item, parseIntent('metal concerts within 25 miles'), defaultSettings.location, 25, clock)).toBe(false);
    expect(searchHappenings([item], 'metal concerts', null, 25, clock)).toEqual([item]);
  });
  it('filters publication dates without inventing event times and keeps unknown dates in All', () => {
    const item = real({ startTime: null, endTime: null, category: 'news', publishedAt: '2026-10-31T20:00:00Z' });
    expect(matchesTime(item, 'week', clock)).toBe(true); expect(matchesTime(item, 'today', clock)).toBe(false);
    expect(matchesTime({ ...item, publishedAt: null }, 'all', clock)).toBe(true); expect(matchesTime({ ...item, publishedAt: null }, 'week', clock)).toBe(false);
  });
});
