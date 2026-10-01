import type { LocalDatabase } from '../database';
import type { PublicHttp } from '../collectors/http';
import type { SearchDiscoveryEngine } from '../discovery/search';
import { PublicPostProvider } from '../discovery/posts';
import { sourceFromResult } from '../discovery/directory';
import { extract } from '../extraction';
import { normalizeRecord } from '../normalization';
import { belongsToArea } from '../normalization/locality';
import { verificationQueries, matchingEvidenceRecord } from './verification';
import { WorkQueue } from '../scheduler/queue';
import type { AppSettings } from '../../shared/models';
import type { ScanTask } from '../../shared/intelligence';

interface ResearchContext {db:LocalDatabase;http:PublicHttp;engine:SearchDiscoveryEngine;posts:PublicPostProvider;settings:AppSettings;key:string;onBattery:boolean;valid:()=>boolean;task:(kind:ScanTask['kind'],label:string,url?:string)=>string;done:(id:string,result:string,failed?:boolean)=>void;searchQueue:WorkQueue;verificationQueue:WorkQueue}
export async function researchPublicRecords(c:ResearchContext){
  const {db,settings,key,task,done}=c;const area=settings.location;
  const areaName=area.discoveryName||area.name;
  const queries=[`${areaName.split(',')[0]} events`,...settings.interests.slice(0,2).map(interest=>`${areaName.split(',')[0]} ${interest}`)];
  for(const query of (settings.sourceTypes.includes('COMMUNITY')?queries.slice(0,c.onBattery?1:3):[])){
    if(!c.posts.available())break;
    if(!c.valid())return;const id=task('search',`Public posts · ${query}`);
    try{const records=await c.searchQueue.run(()=>c.posts.search(query));if(!c.valid())return;let accepted=0;
      for(const record of records){const source=sourceFromResult({title:'Public community post',url:record.sourceUrl!,snippet:'Public post; individual claims require corroboration.'},area);source.type='COMMUNITY';source.reliability=25;const normalized=normalizeRecord(record,source,area,new Date().toISOString());if(!normalized||!belongsToArea(normalized,source,area,settings.radiusMiles))continue;db.upsertSources([source],key);db.ingest([normalized],key);accepted++;}
      done(id,`${records.length} public posts returned · ${accepted} locally relevant claims stored`);
    }catch(error){done(id,String(error),true);}
  }
  const state=db.getState();const subjects=state.happenings.filter(h=>!h.isDemo&&(h.startTime||h.rawMetadata?.kind==='public-post')&&(h.sourceType==='COMMUNITY'||h.importance>=70||h.confidence<75)).sort((a,b)=>(Number(b.rawMetadata?.kind==='public-post')*100+b.importance)-(Number(a.rawMetadata?.kind==='public-post')*100+a.importance)).slice(0,c.onBattery?1:4);
  const visited=new Set<string>();
  for(const subject of subjects){
    if(!c.engine.available())break;
    let pages=0,matched=0;const id=task('verification',`Researching ${subject.title}`,subject.sourceUrl);
    try{for(const query of verificationQueries(subject,areaName)){
      if(!c.engine.available())break;
      if(!c.valid())return;const searchId=task('search',query);
      const messages:string[]=[];const results=await c.searchQueue.run(()=>c.engine.search({query,locationName:area.name,radiusMiles:settings.radiusMiles},key,(provider,status)=>messages.push(`${provider}: ${status}`)));
      done(searchId,`${results.length} candidate references · ${messages.join(' · ')}`,!results.length&&messages.some(text=>text.includes('Failed:')));
      for(const result of results){if(pages>=3)break;if(visited.has(result.url)||result.url===subject.sourceUrl)continue;visited.add(result.url);pages++;const pageId=task('verification',`Checking event reference · ${result.title}`,result.url);
        try{const document=await c.verificationQueue.run(()=>c.http.request(result.url));if(document.status!==200)throw Error(`HTTP ${document.status}`);if(!c.valid())return;
          const parsed=extract(document.body,document.url,document.contentType,new Date().toISOString(),area.timezone||'UTC');const source=sourceFromResult({title:result.title,url:document.url,snippet:'Research reference; search snippets were not accepted as event facts.'},area);
          const matches=parsed.records.slice(0,100).map(record=>normalizeRecord(record,source,area,new Date().toISOString())).filter(h=>h&&matchingEvidenceRecord(subject,h)&&(subject.startTime||belongsToArea(h,source,area,settings.radiusMiles)));
          if(matches.length){db.upsertSources([source],key);for(const record of matches)db.attachResearch(subject.id,record!,key);matched+=matches.length;}
          done(pageId,`${matches.length} matching records with published event details`);
        }catch(error){done(pageId,String(error),true);}
      }
      if(pages>=3)break;
    }done(id,`${pages} public pages checked · ${matched} matching references; unconfirmed details remain uncertain`);
    }catch(error){done(id,String(error),true);}
  }
}
