import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { ConfidenceAssessment, EventHistoryEntry, Evidence, IntelligenceState, ScanMode, ScanRun, ScanTask, SearchCache, WatchArea, UserFeedback, AreaCoverage, HappeningRelationship, SourceRelationship, PulseSnapshot } from '../../shared/intelligence';
import { watchAreaSchema } from '../../shared/intelligence';

const tables = ['scan_runs','scan_tasks','search_queries','search_results','public_post_queries','evidence','confidence_scores','confidence_factors','event_history','user_feedback','area_coverage','source_relationships','happening_relationships','watch_areas','pulse_snapshots'] as const;
type Table = typeof tables[number];
export class IntelligenceStore {
  constructor(private db: DatabaseSync) {}
  migrate() {
    for (const table of tables) this.db.exec(`CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY, location_key TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS ${table}_scope_idx ON ${table}(location_key, updated_at);`);
  }
  private put(table: Table, id: string, key: string, data: unknown, at = new Date().toISOString()) {
    this.db.prepare(`INSERT INTO ${table} VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET location_key=excluded.location_key,data=excluded.data,updated_at=excluded.updated_at`).run(id,key,JSON.stringify(data),at);
  }
  private rows<T>(table: Table, key: string, limit=500): T[] {
    return this.db.prepare(`SELECT data FROM ${table} WHERE location_key=? ORDER BY updated_at DESC,rowid DESC LIMIT ?`).all(key,limit).map(row=>JSON.parse(row.data as string) as T);
  }
  private prune(table: Table, limit: number) { this.db.exec(`DELETE FROM ${table} WHERE id NOT IN(SELECT id FROM ${table} ORDER BY updated_at DESC LIMIT ${limit})`); }
  recoverScans() {
    for (const row of this.db.prepare("SELECT data FROM scan_runs WHERE json_extract(data,'$.status')='running'").all()) {
      const run=JSON.parse(row.data as string) as ScanRun;
      this.updateRun(run.id,{status:'interrupted',completedAt:new Date().toISOString(),phase:'Interrupted',currentActivity:null,error:'The app closed before this scan completed.'});
    }
    for(const row of this.db.prepare("SELECT id FROM scan_tasks WHERE json_extract(data,'$.status')='running'").all())this.finishTask(String(row.id),'Interrupted when the app closed',true);
  }
  beginRun(key: string, mode: ScanMode, origin: ScanRun['origin']): ScanRun {
    const run:ScanRun={id:randomUUID(),locationKey:key,mode,origin,status:'running',startedAt:new Date().toISOString(),completedAt:null,phase:'Preparing scan',totalTasks:0,completedTasks:0,sourcesChecked:0,findings:0,updated:0,duplicates:0,radarMatches:0,failures:0,currentActivity:null,error:null};
    this.put('scan_runs',run.id,key,run);
    this.db.exec("DELETE FROM scan_runs WHERE id NOT IN(SELECT id FROM scan_runs ORDER BY updated_at DESC LIMIT 100) AND id NOT IN(SELECT id FROM (SELECT id,row_number() OVER(PARTITION BY location_key ORDER BY updated_at DESC) AS position FROM scan_runs WHERE json_extract(data,'$.mode')<>'quick') WHERE position<=10)");
    this.db.exec("DELETE FROM scan_tasks WHERE json_extract(data,'$.runId') NOT IN(SELECT id FROM scan_runs)");
    return run;
  }
  getRun(id:string):ScanRun|null { const row=this.db.prepare('SELECT data FROM scan_runs WHERE id=?').get(id);return row?JSON.parse(row.data as string):null; }
  updateRun(id:string,patch:Partial<ScanRun>):ScanRun|null { const before=this.getRun(id);if(!before)return null;const run={...before,...patch,id,locationKey:before.locationKey};this.put('scan_runs',id,run.locationKey,run);return run; }
  startTask(runId:string,kind:ScanTask['kind'],label:string,url?:string):ScanTask {
    const run=this.getRun(runId);if(!run)throw Error('Scan does not exist');
    const task:ScanTask={id:randomUUID(),runId,kind,label:label.slice(0,600),...(url?{url}:{}),status:'running',startedAt:new Date().toISOString(),completedAt:null,result:null};
    this.put('scan_tasks',task.id,run.locationKey,task);this.updateRun(runId,{totalTasks:run.totalTasks+1,currentActivity:task.label});this.prune('scan_tasks',5000);return task;
  }
  finishTask(id:string,result:string,failed=false) {
    const row=this.db.prepare('SELECT data FROM scan_tasks WHERE id=?').get(id);if(!row)return;
    const task=JSON.parse(row.data as string) as ScanTask;if(task.status!=='running')return;
    const run=this.getRun(task.runId);if(!run)return;
    this.put('scan_tasks',id,run.locationKey,{...task,status:failed?'failed':'complete',completedAt:new Date().toISOString(),result:result.slice(0,1000)});
    this.updateRun(run.id,{completedTasks:run.completedTasks+1});
  }
  runs(key:string):ScanRun[] {const recent=this.rows<ScanRun>('scan_runs',key,90);const research=this.db.prepare("SELECT data FROM scan_runs WHERE location_key=? AND json_extract(data,'$.mode')<>'quick' ORDER BY updated_at DESC LIMIT 10").all(key).map(row=>JSON.parse(row.data as string) as ScanRun);return [...new Map([...recent,...research].map(run=>[run.id,run])).values()].sort((a,b)=>b.startedAt.localeCompare(a.startedAt));}
  runDetails(id:string,key:string):{run:ScanRun;tasks:ScanTask[]} {const run=this.getRun(id);if(!run||run.locationKey!==key)throw Error('Scan not found in the selected area');return {run,tasks:this.db.prepare("SELECT data FROM scan_tasks WHERE location_key=? AND json_extract(data,'$.runId')=? ORDER BY updated_at DESC LIMIT 500").all(key,id).map(row=>JSON.parse(row.data as string))};}
  closeTasks(runId:string,result:string){for(const row of this.db.prepare("SELECT id FROM scan_tasks WHERE json_extract(data,'$.runId')=? AND json_extract(data,'$.status')='running'").all(runId))this.finishTask(String(row.id),result,true);}
  cacheSearch(cache:SearchCache) {this.put('search_queries',cache.key,cache.locationKey,{...cache,results:[]});this.put('search_results',cache.key,cache.locationKey,cache);this.prune('search_queries',300);this.prune('search_results',300);}
  getSearch(key:string,now=Date.now()):SearchCache|null {const row=this.db.prepare('SELECT data FROM search_results WHERE id=?').get(key);if(!row)return null;const data=JSON.parse(row.data as string) as SearchCache;return Date.parse(data.expiresAt)>now?data:null;}
  postQuery(key:string):{records:import('../parsers/contracts').ExtractedRecord[];error?:string;expiresAt:number}|null{const row=this.db.prepare('SELECT data FROM public_post_queries WHERE id=?').get(key);if(!row)return null;const value=JSON.parse(row.data as string);return value.expiresAt>Date.now()?value:null;}
  cachePosts(key:string,value:{records:import('../parsers/contracts').ExtractedRecord[];error?:string;expiresAt:number}){this.put('public_post_queries',key,'public-posts',value);this.prune('public_post_queries',200);}
  addEvidence(evidence:Evidence,key:string) {this.put('evidence',`${key}:${evidence.id}`,key,evidence);this.prune('evidence',5000);}
  evidenceFor(id:string,key:string):Evidence[] {return this.db.prepare("SELECT data FROM evidence WHERE location_key=? AND json_extract(data,'$.happeningId')=? ORDER BY updated_at DESC").all(key,id).map(row=>JSON.parse(row.data as string));}
  saveAssessment(assessment:ConfidenceAssessment,key:string) {
    this.put('confidence_scores',`${key}:${assessment.happeningId}`,key,assessment);
    for(const factor of assessment.factors)this.put('confidence_factors',`${key}:${assessment.happeningId}:${factor.key}`,key,{happeningId:assessment.happeningId,...factor});
    this.prune('confidence_scores',2500);this.prune('confidence_factors',25000);
  }
  assessmentFor(id:string,key:string):ConfidenceAssessment|null {const row=this.db.prepare('SELECT data FROM confidence_scores WHERE id=?').get(`${key}:${id}`);return row?JSON.parse(row.data as string):null;}
  history(entry:Omit<EventHistoryEntry,'id'>,key:string) {const id=randomUUID();this.put('event_history',id,key,{...entry,id},entry.at);this.prune('event_history',5000);}
  mergeEvidence(removed:string,retained:string,key:string) {
    for(const evidence of this.evidenceFor(removed,key))this.addEvidence({...evidence,id:`${retained}:${evidence.sourceUrl}`,happeningId:retained},key);
    this.db.prepare("DELETE FROM evidence WHERE location_key=? AND json_extract(data,'$.happeningId')=?").run(key,removed);
    this.db.prepare('DELETE FROM confidence_scores WHERE id=?').run(`${key}:${removed}`);
  }
  saveWatchArea(value:WatchArea) {const area=watchAreaSchema.parse(value);if(this.db.prepare('SELECT COUNT(*) n FROM watch_areas').get()!.n as number>=20&&!this.db.prepare('SELECT id FROM watch_areas WHERE id=?').get(area.id))throw Error('Limit of 20 watch areas reached');this.put('watch_areas',area.id,'workspace',area);}
  watchAreas():WatchArea[] {return this.rows('watch_areas','workspace',20);}
  deleteWatchArea(id:string) {this.db.prepare('DELETE FROM watch_areas WHERE id=?').run(id);}
  feedback(value:UserFeedback) {this.put('user_feedback',`${value.locationKey}:${value.happeningId}`,value.locationKey,value);this.prune('user_feedback',2500);}
  coverage(value:AreaCoverage,key:string) {this.put('area_coverage',key,key,value);}
  relationships(value:HappeningRelationship[],key:string) {this.db.prepare('DELETE FROM happening_relationships WHERE location_key=?').run(key);for(const item of value.slice(0,500))this.put('happening_relationships',`${key}:${item.fromId}:${item.toId}`,key,item);}
  sourceLink(value:SourceRelationship,key:string) {this.put('source_relationships',`${key}:${value.fromId}:${value.toId}`,key,value);this.prune('source_relationships',2500);}
  snapshot(value:PulseSnapshot) {const day=value.at.slice(0,10);this.put('pulse_snapshots',`${value.locationKey}:${day}`,value.locationKey,value,value.at);this.prune('pulse_snapshots',1000);}
  state(key:string,ids:Set<string>):IntelligenceState {
    const runs=this.runs(key);const scans=[...new Map([...runs.slice(0,20),...runs.filter(run=>run.mode!=='quick').slice(0,10)].map(run=>[run.id,run])).values()].sort((a,b)=>b.startedAt.localeCompare(a.startedAt));const runIds=new Set(scans.slice(0,3).map(run=>run.id));
    const coverage=this.rows<AreaCoverage>('area_coverage',key,1)[0]??{score:0,categories:[],assessedAt:new Date().toISOString(),explanation:'Coverage describes known checked sources, not the whole internet.'};
    return {scans,tasks:this.rows<ScanTask>('scan_tasks',key,600).filter(task=>runIds.has(task.runId)),assessments:this.rows<ConfidenceAssessment>('confidence_scores',key,2500).filter(a=>ids.has(a.happeningId)),history:this.rows<EventHistoryEntry>('event_history',key,500).filter(entry=>ids.has(entry.happeningId)),watchAreas:this.watchAreas(),feedback:this.rows<UserFeedback>('user_feedback',key,2500),coverage,relationships:this.rows('happening_relationships',key,500),sourceRelationships:this.rows('source_relationships',key,2500),pulse:this.rows('pulse_snapshots',key,100)};
  }
  reset() {for(const table of tables)this.db.exec(`DELETE FROM ${table}`);}
}
