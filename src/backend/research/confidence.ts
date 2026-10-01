import { defaultConfidenceWeights, type ConfidenceAssessment, type ConfidenceFactor, type ConfidenceWeights, type Contradiction, type Evidence } from '../../shared/intelligence';
import type { Happening } from '../../shared/models';

const words=(text:string)=>new Set(text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu,' ').split(' ').filter(word=>(word.length>2||/^\d+$/.test(word))&&!['the','and','with','for','from','event','events','live'].includes(word)));
const normalize=(text:string)=>text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function indexResearchSubjects(values:Happening[]){const index=new Map<string,Happening[]>();for(const h of values)for(const key of [`title:${normalize(h.title)}`,...[...words(h.title)].map(word=>`word:${word}`)]){const rows=index.get(key)||[];rows.push(h);index.set(key,rows);}return (h:Happening)=>[...new Set([`title:${normalize(h.title)}`,...[...words(h.title)].map(word=>`word:${word}`)].flatMap(key=>index.get(key)||[]))].filter(other=>other.id!==h.id&&sameResearchSubject(h,other));}
export function sameResearchSubject(a:Pick<Happening,'title'|'startTime'|'locationName'|'sourceUrl'> & Partial<Pick<Happening,'rawMetadata'>>,b:Pick<Happening,'title'|'startTime'|'locationName'|'sourceUrl'> & Partial<Pick<Happening,'rawMetadata'>>):boolean {
  if(a.startTime&&b.startTime&&Math.abs(Date.parse(a.startTime)-Date.parse(b.startTime))>12*3600000)return false;
  const aw=words(a.title),bw=words(b.title);const overlap=[...aw].filter(word=>bw.has(word)).length;
  const exact=normalize(a.title)===normalize(b.title);const post=a.rawMetadata?.kind==='public-post'?a:b.rawMetadata?.kind==='public-post'?b:null;const event=post===a?b:a;
  const explicitPostReference=!!post&&!!event.startTime&&words(event.title).size>=3&&normalize(event.title).length>=15&&normalize(post.title).includes(normalize(event.title));
  const matching=exact||explicitPostReference||!!a.startTime&&!!b.startTime&&overlap>=2&&overlap/Math.max(1,new Set([...aw,...bw]).size)>=.7;
  if(!matching)return false;
  const known=(value:string)=>!/^(?:location not provided|unknown|online|not provided)$/i.test(value)&&value.length>3;
  if(a.startTime&&b.startTime&&a.startTime.slice(0,10)===b.startTime.slice(0,10)&&normalize(a.title)===normalize(b.title))return true;
  return !(known(a.locationName)&&known(b.locationName)&&normalize(a.locationName)!==normalize(b.locationName));
}
function activeEvidence(values:Evidence[]):Evidence[] {
  const unique=new Map<string,Evidence>();
  for(const item of values){const prior=unique.get(item.sourceUrl);if(!prior||Date.parse(item.observedAt)>Date.parse(prior.observedAt))unique.set(item.sourceUrl,item);}
  return [...unique.values()];
}
export function assessConfidence(happeningId:string,values:Evidence[],now=new Date().toISOString(),configured:Partial<ConfidenceWeights>={},successfulChecks=0):ConfidenceAssessment {
  const weights={...defaultConfidenceWeights,...configured};const evidence=activeEvidence(values);const factors:ConfidenceFactor[]=[],uncertainties:string[]=[],contradictions:Contradiction[]=[];
  const add=(key:keyof ConfidenceWeights,label:string,explanation:string,points=weights[key])=>factors.push({key,label,points,explanation});
  const official=evidence.find(e=>e.sourceType==='OFFICIAL');const organization=evidence.find(e=>e.sourceType==='ORGANIZATION');const news=evidence.find(e=>e.sourceType==='NEWS');
  if(official)add('official','Official publisher','A government or directory-identified official publisher supplied this record. This does not independently verify every detail.');
  else if(organization)add('organization','Organization publisher','An identified organization published the record.');
  else if(news)add('news','News publisher','The record comes from a news publisher.');
  else if(evidence.length)add('community','Public community reference','A public post or unclassified publisher is the starting claim; corroboration remains necessary.');
  if(evidence.some(e=>e.structured))add('structured','Structured event metadata','At least one original source publishes machine-readable event metadata.');
  const recent=evidence.filter(e=>e.publishedAt&&Date.parse(e.publishedAt)<=Date.parse(now)+3600000&&Date.parse(now)-Date.parse(e.publishedAt)<=7*86400000);
  if(recent.length)add('recent','Recent publication','A source provides a publication date within the past seven days. Retrieval time is not treated as publication time.');
  if(!evidence.some(e=>e.publishedAt))uncertainties.push('Publication recency is unknown; a new fetch does not establish a new announcement.');
  if(evidence.some(e=>e.role==='organizer'))add('organizer','Organizer channel','The page is on the same domain as the event’s explicitly advertised organizer URL.');
  else uncertainties.push('No explicit organizer-channel confirmation was found.');
  if(evidence.some(e=>e.role==='venue'))add('venue','Venue channel','The event’s advertised venue URL and the original publisher have the same domain.');
  else uncertainties.push('No explicit venue-calendar confirmation was found.');
  const times=evidence.filter(e=>e.startTime&&!e.allDay);const uniqueTimes=new Set(times.map(e=>e.startTime));
  if(uniqueTimes.size>1)contradictions.push({field:'time',description:'Sources disagree about the start time. Check the organizer before making plans.',claims:times.map(e=>({value:e.startTime!,sourceName:e.sourceName,sourceUrl:e.sourceUrl}))});
  if(evidence.some(e=>e.cancelled)&&evidence.some(e=>!e.cancelled))contradictions.push({field:'status',description:'A cancellation report conflicts with an active event listing.',claims:evidence.map(e=>({value:e.cancelled?'Cancelled':'Listed as active',sourceName:e.sourceName,sourceUrl:e.sourceUrl}))});
  const places=evidence.filter(e=>!/^(?:location not provided|unknown|not provided)$/i.test(e.locationName));
  if(new Set(places.map(e=>normalize(e.locationName))).size>1)contradictions.push({field:'location',description:'Published venue names disagree; this may be a renamed or changed location.',claims:places.map(e=>({value:e.locationName,sourceName:e.sourceName,sourceUrl:e.sourceUrl}))});
  const groups=new Set(evidence.map(e=>e.independentGroup));
  if(groups.size>=2&&uniqueTimes.size===1&&times.length>=2&&!contradictions.length)add('independent','Matching references on distinct domains','At least two distinct source domains agree on the event time. Shared ownership and copied reports cannot always be detected.');
  else uncertainties.push('Matching independent references are not yet established.');
  if(uniqueTimes.size===1&&places.length&&contradictions.length===0)add('consistent','Available time and place','An explicit event time and named venue are present, with no observed disagreement.');
  if(!times.length)uncertainties.push('The event time has not been established; a date-only listing does not establish a clock time.');
  if(!places.length)uncertainties.push('The venue/location has not been established.');
  if(successfulChecks>=3)add('history','Publisher availability history','The source has been reachable on at least three recorded checks. Availability does not prove factual accuracy.');
  if(contradictions.length)add('conflict','Conflicting published details',contradictions.map(c=>c.description).join(' '));
  if(evidence.some(e=>e.cancelled))add('cancelled','Cancellation reported','The event may no longer be taking place. Open the cancellation source.');
  if(evidence.length&&evidence.every(e=>e.publishedAt&&Date.parse(now)-Date.parse(e.publishedAt)>30*86400000))add('stale','Stale publication','All known publication dates are more than 30 days old.');
  const sum=factors.reduce((total,factor)=>total+factor.points,0);const score=Math.round(Math.max(0,Math.min(groups.size<2?80:100,sum)));
  if(score!==sum)factors.push({key:'bounds',label:groups.size<2&&sum>80?'Single-domain confidence limit':'Score bounds',points:score-sum,explanation:groups.size<2&&sum>80?'Evidence from one domain cannot score above 80.':'The final score is bounded between zero and 100.'});
  return {happeningId,score,label:score>=75?'High':score>=45?'Moderate':'Low',assessedAt:now,factors,uncertainties,contradictions,evidence};
}
export function meaningfulChanges(before:Happening,after:Happening):{field:string;before:string;after:string}[] {
  const fields=['title','summary','startTime','endTime','locationName','address'] as const;
  const changes:{field:string;before:string;after:string}[]=fields.filter(field=>before[field]!==after[field]).map(field=>({field,before:before[field]||'Not provided',after:after[field]||'Not provided'}));
  const status=(h:Happening)=>String(h.rawMetadata?.status||h.rawMetadata?.eventStatus||'');
  if(status(before)!==status(after))changes.push({field:'status',before:status(before)||'No status published',after:status(after)||'No status published'});
  if(JSON.stringify(before.images)!==JSON.stringify(after.images))changes.push({field:'images',before:before.images.length?`${before.images.length} publisher images`:'No publisher images',after:after.images.length?`${after.images.length} publisher images`:'No publisher images'});
  return changes;
}
export function samePublisherIdentity(before:Happening,after:Happening):boolean {
  if(before.sourceId!==after.sourceId||before.sourceUrl!==after.sourceUrl)return false;
  const uid=before.rawMetadata?.uid,otherUid=after.rawMetadata?.uid;
  if(uid&&uid===otherUid){if(before.rawMetadata?.recurring||after.rawMetadata?.recurring)return String(before.rawMetadata?.recurrenceId||before.startTime).slice(0,10)===String(after.rawMetadata?.recurrenceId||after.startTime).slice(0,10);return true;}
  return normalize(before.title)===normalize(after.title)&&(!before.startTime&&!after.startTime||!!before.startTime&&!!after.startTime&&Math.abs(Date.parse(before.startTime)-Date.parse(after.startTime))<=2*86400000);
}
