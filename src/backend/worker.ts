import { parentPort, workerData } from 'node:worker_threads';
import { LocalDatabase } from './database';
import { PublicHttp, type HttpDocument } from './collectors/http';
import { CachedGeocoder } from './geocoding';
import { WikipediaDirectory, discoveryQueries, sourceFromResult } from './discovery/directory';
import { extract } from './extraction';
import { normalizeRecord } from './normalization';
import { belongsToArea, currentPublicRecord } from './normalization/locality';
import { nextCheck } from './scheduler/policy';
import type { Happening, Source, ScanRequest } from '../shared/models';
import { chooseScanMode } from './scheduler/scans';
import type { ScanTask } from '../shared/intelligence';
import { SearchDiscoveryEngine, MwmblSearchProvider, SearxngSearchProvider, webDiscoveryQueries, intersectingWatchLocations } from './discovery/search';
import { WorkQueue } from './scheduler/queue';
import { PublicPostProvider } from './discovery/posts';
import { researchPublicRecords } from './research/pipeline';
import { updateLocalIntelligence } from './research/pulse';
import { appendFileSync, existsSync, statSync, truncateSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { freemem, loadavg, cpus } from 'node:os';
import { parseIntent, expandTopic } from './search/intent';

const database = new LocalDatabase(workerData.databasePath);
const http = new PublicHttp();
const geocoder = new CachedGeocoder(database,http);
const directory = new WikipediaDirectory(http);
const searchQueue=new WorkQueue('Search',1,40);
const geocodingQueue=new WorkQueue('Geocoding',1,40);
const browserQueue=new WorkQueue('Browser',1,2);
const verificationQueue=new WorkQueue('Verification',1,12);
const posts=new PublicPostProvider(http,database.intelligence);
const searchEngines=new Map<string,SearchDiscoveryEngine>();
function searchEngine(endpoint:string){let engine=searchEngines.get(endpoint);if(!engine){engine=new SearchDiscoveryEngine([new MwmblSearchProvider(http),...(endpoint?[new SearxngSearchProvider(http,endpoint)]:[])],database.intelligence);searchEngines.set(endpoint,engine);if(searchEngines.size>5)searchEngines.delete(searchEngines.keys().next().value!);}return engine;}
let scanning = false;
let activeScope: string | undefined;
let onBattery = false;
let pendingScan: ScanRequest | undefined;
let browserRequestId=0;
const browserRequests=new Map<number,{resolve:(html:string)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
function browserPage(url:string){return new Promise<string>((resolve,reject)=>{const id=++browserRequestId;const timer=setTimeout(()=>{browserRequests.delete(id);reject(Error('Browser extraction timed out'));},22000);browserRequests.set(id,{resolve,reject,timer});parentPort?.postMessage({type:'render-page',id,url});});}
function emit() { parentPort?.postMessage({ type:'state-changed' }); }
function status(patch: Record<string,unknown>) { if (!database.getSettings().onboarded) return; database.setEngineState(patch,activeScope); emit(); }
function log(value: Record<string,unknown>) {
  const path = join(dirname(workerData.databasePath),'crawl-diagnostics.jsonl');
  if (existsSync(path) && statSync(path).size > 2_000_000) truncateSync(path,0);
  appendFileSync(path,JSON.stringify({at:new Date().toISOString(),...value})+'\n');
}
async function scan(options: ScanRequest = {}) {
  if (scanning) { pendingScan = options; return; }
  let settings = database.getSettings();
  if (!settings.onboarded || settings.demoMode) return;
  scanning = true;
  let location = settings.location;
  const locationKey = location.key || location.name;
  activeScope=locationKey;
  const mode=chooseScanMode(options.mode||(options.force?'refresh':options.query?'deep':options.origin==='scheduled'||options.origin==='startup'?'smart':'refresh'),settings,database.intelligence.runs(locationKey),Date.now(),database.getState().happenings.length>0);
  const run=database.intelligence.beginRun(locationKey,mode,options.origin||'manual');
  const task=(kind:ScanTask['kind'],label:string,url?:string)=>{const value=database.intelligence.startTask(run.id,kind,label,url);emit();return value.id;};
  const done=(id:string,result:string,failed=false)=>{database.intelligence.finishTask(id,result,failed);emit();};
  const previous = database.getEngineState();
  status({scanning:true,phase:'Discovering sources',currentlyChecking:location.name,error:null});
  let newCount=0,updateCount=0,duplicates=0,checked=0,failures=0,geocoded=0,browsers=0;
  const attemptedAddresses=new Set<string>();
  const started = Date.now();
  try {
    try{const resolved=await geocoder.discoveryArea(location);const current=database.getSettings();if((current.location.key||current.location.name)!==locationKey||!current.onboarded)return;if(resolved.discoveryName&&resolved.discoveryName!==location.discoveryName){location=resolved;settings={...current,location};database.saveSettings(settings);emit();}}catch(error){log({stage:'area-resolution',error:String(error)});}
    if(mode==='refresh'){directory.clearCache();searchEngine(settings.scanning.searchEndpoint).refresh();posts.refresh();}
    let sources = database.getState().sources;
    // Catalogs are reused. Discovery is refreshed at most daily, or explicitly for deeper search.
    if (!sources.length || options.query || mode==='refresh') {
      const found: Source[] = [];
      for (const query of discoveryQueries(location,options.query)) {
        const id=task('discovery',`Finding local organizations · ${query}`);
        try { const results = await directory.discover({query,locationName:location.discoveryName||location.name,radiusMiles:settings.radiusMiles}); found.push(...results.map(r=>sourceFromResult(r,location)));done(id,`${results.length} source candidates`); }
        catch (error) { done(id,String(error),true);log({stage:'discovery',provider:directory.name,query,error:String(error)}); }
      }
      if (location.countryCode === 'US' || !location.countryCode && location.longitude < -50) {
        found.unshift(sourceFromResult({title:'National Weather Service · Official website',url:`https://api.weather.gov/alerts/active?point=${location.latitude},${location.longitude}`,snippet:'Official active weather alerts for the selected coordinate. Empty responses mean no published alerts for this point.'},location));
        found[0].parserType='json';found[0].checkFrequency=600;
      }
      const current=database.getState().settings;
      if(!current.onboarded||current.demoMode||(current.location.key||current.location.name)!==locationKey)return;
      database.upsertSources(found,locationKey); sources=database.getState().sources;
    }
    if(mode==='deep'||mode==='refresh'){
      status({phase:'Searching the public web'});database.intelligence.updateRun(run.id,{phase:'Searching the public web'});
      const state=database.getState();const nearby=[...directory.nearbyLocations(),...intersectingWatchLocations(location,settings.radiusMiles,state.intelligence?.watchAreas||[])];
      const queries=webDiscoveryQueries(location,state.radars,settings.interests,nearby,options.query,options.category).slice(0,onBattery?4:options.query?12:24);
      const engine=searchEngine(settings.scanning.searchEndpoint);const discovered=new Map<string,Source>();
      for(const query of queries){
        if(!engine.available())break;
        const current=database.getSettings();if(!current.onboarded||current.demoMode||(current.location.key||current.location.name)!==locationKey)return;
        const id=task('search',query);const providerStates:string[]=[];
        try{const results=await searchQueue.run(()=>engine.search({query,locationName:location.name,radiusMiles:settings.radiusMiles},locationKey,(provider,state)=>providerStates.push(`${provider}: ${state}`)));
          for(const result of results){if(/(^|\.)(wikipedia\.org|wikimedia\.org|google\.com|bing\.com)$/.test(new URL(result.url).hostname))continue;const source=sourceFromResult({...result,snippet:`Found through ${result.provider}. Query: ${query}. Region and facts must be checked on the original page.`},location);if(/(^|\.)(bsky\.app|reddit\.com|mastodon\.[\w.]+|meetup\.com|facebook\.com|instagram\.com|x\.com|twitter\.com)$/.test(source.domain)){source.type='COMMUNITY';source.reliability=35;}discovered.set(source.url,source);if(discovered.size>=60)break;}
          done(id,`${results.length} results. ${providerStates.join(' · ')}`,!results.length&&providerStates.some(state=>state.includes('Failed:')));
        }catch(error){done(id,String(error),true);}
        if(discovered.size>=60)break;
      }
      database.upsertSources([...discovered.values()],locationKey);sources=database.getState().sources;
    }
    const queue = database.getDueSources(Date.now(),mode==='refresh');
    for(let i=queue.length-1;i>=0;i--)if(!settings.sourceTypes.includes(queue[i].type))queue.splice(i,1);
    // Prioritize weather, feeds and calendars over slow/static documents.
    const priority=(s:Source)=>s.domain==='api.weather.gov'?1000:s.parserType==='rss'||s.parserType==='ical'?800:/verified regional organization/i.test(s.notes||'')?600:s.type==='OFFICIAL'?500:100;
    queue.sort((a,b)=>priority(b)-priority(a)||a.checkFrequency-b.checkFrequency);
    queue.splice(onBattery?18:36);
    const seen = new Set(sources.map(s=>s.url));
    const domains = new Set<string>(); let active=0, totalBudget=onBattery?30:52;
    status({phase:'Checking public sources',sourcesDiscovered:sources.length,queueSize:queue.length});
    database.intelligence.updateRun(run.id,{phase:'Checking public sources'});
    async function collect(source: Source) {
      const began=Date.now(); const now=new Date().toISOString();
      const jobId=database.queueJob(source.sourceId);
      const taskId=task('fetch',`Checking ${source.name}`,source.url);
      database.updateJob(jobId,'running');
      status({currentlyChecking:source.name,queueSize:queue.length,httpRequests:http.requests});
      let document:HttpDocument|undefined;
      try {
        const cached=database.getCachedDocument(source.url);
        // NWS explicitly publishes this endpoint for application use; its API robots policy
        // excludes search indexing. HTTP access restrictions still apply.
        const documentedApi=source.domain==='api.weather.gov'&&/^\/alerts\/(active|[^/]+$)/.test(new URL(source.url).pathname);
        document=await http.request(source.url,{...(source.etag?{'If-None-Match':source.etag}:{}),...(source.lastModified?{'If-Modified-Since':source.lastModified}:{})},!documentedApi);
        if (document.status===304 && (!cached||cached.contentType==='application/vnd.whatsup.extraction+json'&&JSON.parse(cached.body).extractionVersion!==3)) document=await http.request(source.url,{},!documentedApi);
        if (document.status!==200 && document.status!==304) throw Error(`HTTP ${document.status}`);
        const body=document.status===304?cached!.body:document.body;
        let parsed=document.status===304&&cached?.contentType==='application/vnd.whatsup.extraction+json'?JSON.parse(body) as ReturnType<typeof extract>:extract(body,document.url,document.contentType || cached?.contentType || '',now,location.timezone || 'UTC');
        if(!parsed.records.length&&parsed.parserType==='html'&&/id=["'](?:root|app|__next)|enable javascript/i.test(body)&&!/captcha|access denied|cloudflare challenge/i.test(body)&&!onBattery&&browsers<2&&freemem()>1_000_000_000&&loadavg()[0]<cpus().length*.8){
          browsers++;status({browserSessions:(previous.browserSessions||0)+browsers});
          const browserTask=task('browser',`Reading public page · ${source.domain}`,document.url);
          const pageUrl=document.url;
          try{const rendered=await browserQueue.run(()=>browserPage(pageUrl));const result=extract(rendered,pageUrl,'text/html',now,location.timezone||'UTC');if(result.records.length||result.discoveredLinks.length)parsed=result;done(browserTask,`${result.records.length} extracted records`);}catch(error){done(browserTask,String(error),true);log({stage:'browser',sourceId:source.sourceId,error:String(error)});}
        }
        const records: Happening[]=[]; let rejected=0;
        for (const record of parsed.records.slice(0,160)) {
          let normalized=normalizeRecord(record,source,location,now); if (!normalized||!currentPublicRecord(normalized,now)) {rejected++;continue;}
          const place = normalized.address || normalized.locationName;
          const addressQuery=place && !/^(location not provided|not provided|unknown|online|virtual)$/i.test(place.trim())?`${place}, ${location.name}`:null;
          const cachedAddress=addressQuery?database.getGeocode(`${addressQuery.trim().toLowerCase()}|${location.name}`):null;
          if (normalized.latitude===null && addressQuery && (cachedAddress||geocoded<12)) {
            if(!cachedAddress && !attemptedAddresses.has(addressQuery)){geocoded++;attemptedAddresses.add(addressQuery);}
            const geoTask=cachedAddress?null:task('geocoding',`Locating ${place}`);
            try { const resolved=cachedAddress||await geocodingQueue.run(()=>geocoder.resolve(addressQuery,location)); if (resolved) normalized={...normalized,latitude:resolved.latitude,longitude:resolved.longitude,geometryType:'POINT',geometry:{type:'Point',coordinates:[resolved.longitude,resolved.latitude]},locationAccuracy:'approximate'};if(geoTask)done(geoTask,resolved?'Approximate coordinates found':'No location could be verified'); } catch(error) {if(geoTask)done(geoTask,String(error),true);log({stage:'geocoding',sourceId:source.sourceId,error:String(error)});}
          }
          if(!belongsToArea(normalized,source,location,settings.radiusMiles)){rejected++;continue;}
          records.push(normalized);
        }
        // A location change during a scan must never publish the old catalog into the new area.
        const current=database.getState().settings;
        if (!current.onboarded || current.demoMode || (current.location.key||current.location.name)!==locationKey) return;
        const result=database.ingest(records,locationKey);newCount+=result.inserted;updateCount+=result.updated;duplicates+=result.duplicates;
        if (document.status!==304) database.cacheDocument({url:source.url,body:JSON.stringify({...parsed,extractionVersion:3}),contentType:'application/vnd.whatsup.extraction+json',etag:document.etag,lastModified:document.lastModified,fetchedAt:now,expiresAt:new Date(Date.now()+7*86400000).toISOString()});
        const updated={...source,parserType:parsed.parserType,lastChecked:now,lastSuccessful:now,status:'healthy' as const,lastError:undefined,failureCount:0,etag:document.etag||source.etag,lastModified:document.lastModified||source.lastModified,unchangedChecks:document.status===304?(source.unchangedChecks||0)+1:0};
        updated.nextCheckAt=new Date(nextCheck(updated,Date.now(),updated.unchangedChecks)).toISOString();database.upsertSources([updated],locationKey);
        // Only same-domain advertised feeds/calendar/announcement links, bounded depth and budget.
        const depth=Number(source.notes?.match(/Depth (\d)/)?.[1]||0);
        const topicTerms=options.query?parseIntent(options.query).topics.flatMap(expandTopic):[];
        const linkScore=(link:typeof parsed.discoveredLinks[number])=>Number(topicTerms.some(term=>(link.name+' '+link.url).toLowerCase().includes(term)))*3+Number(link.parserType==='rss'||link.parserType==='ical')*2;
        if (depth<2) for (const link of parsed.discoveredLinks.sort((a,b)=>linkScore(b)-linkScore(a)).slice(0,options.query?16:8)) {
          let u;try{u=new URL(link.url);}catch{continue;}
          const sameDomain=u.hostname.replace(/^www\./,'')===new URL(document.url).hostname.replace(/^www\./,'');
          const advertisedCalendar=/calendar|events|programs|rss|feed|ical/i.test(link.name)&&/\/(events|calendar)|\.ics|\.xml/.test(u.pathname)&&/verified regional organization/i.test(source.notes||'');
          if ((!sameDomain&&!advertisedCalendar) || seen.has(u.href) || /\.(png|jpg|jpeg|webp|svg|gif|pdf|mp4|zip|css|js)$/i.test(u.pathname) || /logout|login|cart|account|search|wp-json|replytocom|\/confirm\b/i.test(u.href) || totalBudget<=0) continue;
          const child=sourceFromResult({title:`${source.name.split(' · ')[0]} · ${link.name.slice(0,90)}`,url:u.href,snippet:`Advertised by ${source.url}. Depth ${depth+1}. ${/verified regional organization/i.test(source.notes||'')?'Verified regional organization':''}`},location);
          child.type=source.type;child.reliability=source.reliability;child.parserType=link.parserType;child.checkFrequency=link.parserType==='rss'?1800:link.parserType==='ical'?21600:source.checkFrequency;
          seen.add(u.href);database.upsertSources([child],locationKey);queue.push(child);totalBudget--;
          database.intelligence.sourceLink({fromId:source.sourceId,toId:child.sourceId,url:u.href,kind:'advertised-link'},locationKey);
        }
        database.recordCheck({sourceId:source.sourceId,checkedAt:now,status:document.status===304?'not-modified':'success',httpStatus:document.status,recordsFound:records.length,durationMs:Date.now()-began,etag:document.etag,lastModified:document.lastModified,parser:parsed.parserType,extracted:parsed.records.length,rejected,inserted:result.inserted,updated:result.updated,duplicates:result.duplicates});
        database.updateJob(jobId,'completed');log({sourceId:source.sourceId,url:source.url,parser:parsed.parserType,status:document.status,records:records.length,rejected,...result});
        done(taskId,`${result.inserted} new · ${result.updated} updated · ${result.duplicates} merged`);
      } catch(error) {
        const current=database.getState().settings;if(!current.onboarded||current.demoMode||(current.location.key||current.location.name)!==locationKey)return;
        failures++;const message=String(error).slice(0,600);const updated={...source,lastChecked:now,failureCount:source.failureCount+1,status:/robots|restricted|403|401/.test(message)?'blocked' as const:'failed' as const,lastError:message};
        updated.nextCheckAt=new Date(nextCheck(updated,Date.now())).toISOString();database.upsertSources([updated],locationKey);
        database.recordCheck({sourceId:source.sourceId,checkedAt:now,status:updated.status==='blocked'?'blocked':'failed',httpStatus:document?.status,recordsFound:0,durationMs:Date.now()-began,error:message});database.updateJob(jobId,'failed',message);log({sourceId:source.sourceId,url:source.url,error:message});
        done(taskId,message,true);
      } finally {checked++;database.intelligence.updateRun(run.id,{sourcesChecked:checked,findings:newCount,updated:updateCount,duplicates,failures});status({pagesChecked:(previous.pagesChecked||0)+checked,newHappenings:newCount,updatedHappenings:updateCount,duplicatesMerged:duplicates,failures,sourcesFailed:failures,httpRequests:http.requests,queueSize:queue.length});}
    }
    await new Promise<void>(resolve=>{
      function pump() {
        const current=database.getState().settings;if(!current.onboarded||current.demoMode||(current.location.key||current.location.name)!==locationKey)queue.length=0;
        while (active<3) {queue.sort((a,b)=>priority(b)-priority(a));const index=queue.findIndex(s=>!domains.has(s.domain));if(index<0)break;const source=queue.splice(index,1)[0];domains.add(source.domain);active++;void collect(source).finally(()=>{domains.delete(source.domain);active--;pump();});}
        if(!queue.length&&!active)resolve();
      } pump();
    });
    const valid=()=>{const current=database.getSettings();return current.onboarded&&!current.demoMode&&(current.location.key||current.location.name)===locationKey;};
    if(!valid())return;
    if(mode==='deep'||mode==='refresh'){status({phase:'Checking event evidence'});database.intelligence.updateRun(run.id,{phase:'Checking event evidence'});await researchPublicRecords({db:database,http,engine:searchEngine(settings.scanning.searchEndpoint),posts,settings,key:locationKey,onBattery,valid,task,done,searchQueue,verificationQueue});}
    if(!valid())return;
    updateLocalIntelligence(database,locationKey);
    const state=database.getState();const complete=new Date().toISOString();const matches=state.radarMatches?.filter(m=>m.isNew).length||0;
    database.intelligence.updateRun(run.id,{status:'complete',completedAt:complete,phase:'Scan complete',currentActivity:null,radarMatches:matches});
    status({sourcesDiscovered:state.sources.length,sourcesHealthy:state.sources.filter(s=>s.status==='healthy').length,sourcesFailed:state.sources.filter(s=>s.status==='failed'||s.status==='blocked').length,lastScan:complete,nextScan:new Date(Date.now()+settings.scanning.intervalHours*3600000).toISOString(),phase:'Idle',currentlyChecking:null,queueSize:0});
    parentPort?.postMessage({type:'scan-complete',updated:updateCount,alerts:state.happenings.filter(h=>h.discoveredAt>=run.startedAt&&h.importance>=80).length});
    log({stage:'scan-completed',location:location.name,durationMs:Date.now()-started,newCount,updateCount,duplicates,checked,failures,httpRequests:http.requests});
  } catch(error) {database.intelligence.updateRun(run.id,{status:'failed',completedAt:new Date().toISOString(),phase:'Scan failed',currentActivity:null,error:String(error)});status({phase:'Idle',error:String(error),currentlyChecking:null});log({stage:'scan',error:String(error)});}
  finally {database.intelligence.closeTasks(run.id,'Scan ended before this task completed');if(database.intelligence.getRun(run.id)?.status==='running')database.intelligence.updateRun(run.id,{status:'interrupted',completedAt:new Date().toISOString(),currentActivity:null,phase:'Area changed',error:'The selected area or setup changed.'});scanning=false;status({scanning:false});if(pendingScan){const next=pendingScan;pendingScan=undefined;void scan(next);}}
}
parentPort?.on('message',async message=>{
  try {
    if(message.type==='rendered-page'){const request=browserRequests.get(message.id);if(request){clearTimeout(request.timer);browserRequests.delete(message.id);message.error?request.reject(Error(message.error)):request.resolve(message.html);}return;}
    if(message.type==='power'){onBattery=message.onBattery;return;}
    if(message.type==='scan'){void scan(message.options);return;}
    if(message.type==='resolve-location'){const location=await geocoder.resolve(message.query);if(!location)throw Error('Location not found. Add a city, state or country.');parentPort?.postMessage({type:'response',id:message.id,result:location});}
  } catch(error){parentPort?.postMessage({type:'response',id:message.id,error:String(error)});}
});
parentPort?.postMessage({type:'ready'});
