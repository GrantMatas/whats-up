import type { Happening } from '../../shared/models';
import { distanceMiles } from '../search/intent';
const normalize = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function sameTitle(first: string, second: string): boolean {
  if (normalize(first) === normalize(second)) return true;
  const stop = new Set(['the', 'a', 'an', 'at', 'in', 'live', 'presents', 'show', 'event']);
  const words = (title: string) => new Set(normalize(title).split(' ').filter(w => w.length > 1 && !stop.has(w)));
  const a = words(first), b = words(second); const overlap = [...a].filter(w => b.has(w)).length;
  return overlap >= 2 && overlap / new Set([...a, ...b]).size >= 0.65;
}
// Deliberately conservative foundation: never merge nearby but distinct incidents.
export function deduplicate(happenings: Happening[], onMerge?: (removedId: string, retainedId: string) => void): Happening[] {
  const result: Happening[] = [];
  const indices=new Map<string,Happening[]>();const order=new Map<Happening,number>();
  const keys=(h:Happening)=>{const prefix=String(h.isDemo);const hour=h.startTime?Math.floor(Date.parse(h.startTime)/3600000):null;return [`${prefix}:id:${h.id}`,`${prefix}:url:${h.originalUrl}|${h.startTime}`,...(hour===null?[]:[-1,0,1].map(offset=>`${prefix}:hour:${h.category}:${hour+offset}`))];};
  for (const item of happenings) {
    const candidates=[...new Set(keys(item).flatMap(key=>indices.get(key)||[]))].sort((a,b)=>order.get(a)!-order.get(b)!);
    const duplicate = candidates.find(existing => existing.isDemo === item.isDemo && (existing.id === item.id || (existing.originalUrl && existing.originalUrl === item.originalUrl && existing.startTime === item.startTime) || (sameTitle(existing.title, item.title) && existing.category === item.category && existing.startTime && item.startTime && Math.abs(Date.parse(existing.startTime) - Date.parse(item.startTime)) < 3600000 && ((existing.latitude !== null && existing.longitude !== null && item.latitude !== null && item.longitude !== null && distanceMiles(existing.latitude, existing.longitude, item.latitude, item.longitude) < 0.1) || (normalize(existing.locationName) === normalize(item.locationName) && normalize(item.locationName).length > 4)))));
    if (!duplicate) { const retained=structuredClone(item);order.set(retained,result.length);result.push(retained);for(const key of keys(retained)){const list=indices.get(key)||[];list.push(retained);indices.set(key,list);}continue; }
    if (item.id !== duplicate.id) onMerge?.(item.id, duplicate.id);
    const sources = [...duplicate.relatedSources, ...item.relatedSources];
    if (item.sourceUrl !== duplicate.sourceUrl) sources.push({ name: item.sourceName, url: item.sourceUrl, type: item.sourceType });
    duplicate.relatedSources = sources.filter((source, index) => source.url !== duplicate.sourceUrl && sources.findIndex(other => other.url === source.url) === index);
    duplicate.images=[...new Set([...duplicate.images,...item.images])].slice(0,4);
  }
  return result;
}
