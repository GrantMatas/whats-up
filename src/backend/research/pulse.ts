import type { LocalDatabase } from '../database';
import { categories, type AppState, type Category, type Happening } from '../../shared/models';
import type { AreaCoverage, HappeningRelationship } from '../../shared/intelligence';
import { distanceMiles } from '../search/intent';

export function calculateCoverage(state:AppState,now=new Date().toISOString()):AreaCoverage{
  const recent=(at:string|null|undefined)=>!!at&&Date.parse(now)-Date.parse(at)<7*86400000;
  const values=categories.map(category=>{
    const records=state.happenings.filter(h=>h.category===category&&!h.isDemo);
    const ids=new Set(records.map(h=>h.sourceId));
    const hints:Partial<Record<Category,RegExp>>={weather:/weather|meteorolog/i,government:/council|government|city hall/i,traffic:/transport|traffic|highway/i,education:/school|university|library/i,community:/community|neighbou?rhood/i,music:/concert|music/i};
    const sources=state.sources.filter(source=>ids.has(source.sourceId)||!!hints[category]?.test(source.name));
    const healthy=sources.filter(source=>source.status==='healthy'&&recent(source.lastSuccessful)).length;
    const score=Math.round(Math.min(100,healthy*20+Math.min(20,records.length*2)));
    return {category,sources:sources.length,healthy,findings:records.length,score,label:healthy>=4?'Excellent' as const:healthy>=2?'Good' as const:healthy||sources.length?'Limited' as const:'Missing' as const};
  });
  return {score:Math.round(values.reduce((sum,row)=>sum+row.score,0)/values.length),categories:values,assessedAt:now,explanation:'Coverage measures known publishers reachable within seven days and their collected records. It does not measure all activity or establish that an area is quiet.'};
}
export function observedRelationships(records:Happening[]):HappeningRelationship[]{
  const links:HappeningRelationship[]=[];const dated=records.filter(h=>h.startTime).slice(0,300);
  for(let i=0;i<dated.length;i++)for(let j=i+1;j<dated.length;j++){
    const a=dated[i],b=dated[j];if(Math.abs(Date.parse(a.startTime!)-Date.parse(b.startTime!))>6*3600000)continue;
    const known=(place:string)=>place&&!/not provided|unknown|online/i.test(place);
    if(known(a.locationName)&&a.locationName.toLowerCase()===b.locationName.toLowerCase())links.push({fromId:a.id,toId:b.id,type:'same-venue',reason:'Same published venue within six hours; check times before planning.'});
    else if(a.latitude!==null&&a.longitude!==null&&b.latitude!==null&&b.longitude!==null&&distanceMiles(a.latitude,a.longitude,b.latitude,b.longitude)<1&&[a.category,b.category].some(category=>['traffic','construction','safety','public_safety','weather'].includes(category)))links.push({fromId:a.id,toId:b.id,type:'nearby-impact',reason:'Published disruption and event locations are within one mile and six hours. A possible impact, not a confirmed causal link.'});
    if(links.length>=500)return links;
  }return links;
}
export function updateLocalIntelligence(db:LocalDatabase,key:string){
  const state=db.getState();const now=new Date().toISOString();db.intelligence.coverage(calculateCoverage(state,now),key);db.intelligence.relationships(observedRelationships(state.happenings),key);
  const records=state.happenings.filter(h=>!h.isDemo&&(h.startTime&&Date.parse(h.startTime)>=Date.parse(now)&&Date.parse(h.startTime)<=Date.parse(now)+7*86400000||h.publishedAt&&Date.parse(h.publishedAt)>=Date.parse(now)-86400000));
  const counts:Partial<Record<Category,number>>={};for(const h of records)counts[h.category]=(counts[h.category]||0)+1;
  // A bounded observation index with a disclosed formula; baseline comparisons require history.
  const score=Math.min(100,Math.round(records.reduce((sum,h)=>sum+(h.category==='weather'||h.category==='safety'||h.category==='traffic'?3:1),0)*2));
  db.intelligence.snapshot({locationKey:key,at:now,count:records.length,score,categories:counts});
}
