import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Worker} from 'node:worker_threads';
import {createRequire} from 'node:module';
mkdirSync('artifacts/live',{recursive:true});
await build({entryPoints:['src/backend/worker.ts'],outfile:'artifacts/live/worker.cjs',bundle:true,platform:'node',format:'cjs',external:['node:sqlite']});
await build({entryPoints:['src/backend/database/index.ts'],outfile:'artifacts/live/database.cjs',bundle:true,platform:'node',format:'cjs',external:['node:sqlite']});
const {LocalDatabase}=createRequire(import.meta.url)('../artifacts/live/database.cjs');
for(const query of process.argv.slice(2).length?process.argv.slice(2):['Fishers, Indiana','Chicago, Illinois','Seattle, Washington']){
 const slug=query.split(',')[0].toLowerCase();const path=resolve('artifacts/live/validated-'+slug+'-'+Date.now()+'.sqlite');const db=new LocalDatabase(path);const worker=new Worker(resolve('artifacts/live/worker.cjs'),{workerData:{databasePath:path}});
 let resolveLocation,rejectLocation;const locationPromise=new Promise((resolve,reject)=>{resolveLocation=resolve;rejectLocation=reject;});
 let scanStarted=false,resolveScan,rejectScan;const scanPromise=new Promise((resolve,reject)=>{resolveScan=resolve;rejectScan=reject;});
 worker.on('error',error=>{rejectLocation(error);rejectScan(error);});
 let lastPhase='';worker.on('message',message=>{
  if(message.type==='ready')worker.postMessage({type:'resolve-location',id:1,query});
  if(message.type==='response'&&message.id===1)message.error?rejectLocation(Error(message.error)):resolveLocation(message.result);
  if(message.type==='state-changed'){const engine=db.getEngineState();if(engine.scanning)scanStarted=true;if(engine.phase!==lastPhase){lastPhase=engine.phase;console.log(query+': '+engine.phase);}if(scanStarted&&!engine.scanning)resolveScan();}
  if(message.type==='render-page')worker.postMessage({type:'rendered-page',id:message.id,error:'Browser fallback is exercised by desktop smoke, not the CLI validator'});
 });
 const timer=setTimeout(()=>rejectScan(Error('Scan exceeded 8 minutes')),480000);
 try{
  const location=await locationPromise;db.saveSettings({...db.getState().settings,onboarded:true,demoMode:false,location,radiusMiles:25});worker.postMessage({type:'scan',options:{force:true}});await scanPromise;
  const state=db.getState();const located=state.happenings.filter(h=>h.latitude!==null&&h.longitude!==null);const dated=state.happenings.filter(h=>h.startTime);
  const sample=located[0]||dated[0]||state.happenings[0];const search=sample?db.search(sample.title.split(/\s+/).slice(0,2).join(' ')):[];
  const radar={id:'live-validation-'+slug,name:'Live validation',query:sample?.tags[0]||sample?.category||'community',radiusMiles:100,enabled:true,createdAt:new Date().toISOString()};db.saveRadar(radar);
  const report={query,location,sources:state.sources.length,healthy:state.sources.filter(s=>s.lastSuccessful).length,records:state.happenings.length,located:located.length,dated:dated.length,parsers:[...new Set(db.getSourceChecks().filter(c=>c.status==='success').map(c=>state.sources.find(s=>s.sourceId===c.sourceId)?.parserType))],noDemo:state.happenings.every(h=>!h.isDemo),searchResults:search.length,radarMatches:db.getState().radarMatches?.length||0,aggregates:db.getAggregates(),engine:state.engine,samples:state.happenings.slice(0,20),sourceHealth:state.sources};
  writeFileSync('artifacts/live/'+slug+'-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({location:query,sources:report.sources,healthy:report.healthy,records:report.records,located:report.located,dated:report.dated,search:report.searchResults,radar:report.radarMatches,parsers:report.parsers}));
  if(!report.noDemo||!report.sources||!report.records)throw Error('Real ingestion validation failed for '+query);
 }finally{clearTimeout(timer);await worker.terminate();db.close();}
}
