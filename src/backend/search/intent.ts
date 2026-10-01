import type { Category, Happening, Location } from '../../shared/models';
export type TimeWindow = 'all' | 'now' | 'today' | 'tonight' | 'tomorrow' | 'weekend' | 'week';
export interface SearchIntent { query: string; topics: string[]; exclusions?: string[]; categories: Category[]; radiusMiles?: number; timeWindow: TimeWindow; newlyAnnounced: boolean; date?: string }
const categoryWords: Partial<Record<Category, RegExp>> = { music: /\b(music|concerts?|metal|jazz|rock|bands?|shows?)\b/i, community: /\b(community|furry|meetups?|festivals?|cars?|volunteer|library)\b/i, traffic: /\b(traffic|construction|closure|detour|roadwork)\b/i, weather: /\b(weather|rain|storm|forecast)\b/i, government: /\b(government|council|ordinance|development|public meeting)\b/i, safety: /\b(safety|emergency|preparedness|incidents?)\b/i, food: /\b(food|restaurants?|coffee|market|kitchens?)\b/i, technology: /\b(technology|tech|cybersecurity|software|coding|design)\b/i, sports: /\b(sports?|soccer|running|games?)\b/i, news: /\b(news|journalism)\b/i, business: /\b(business|opening|entrepreneur|commerce)\b/i, education: /\b(education|schools?|classes?|learning)\b/i, arts: /\b(arts?|gallery|theatre|theater|exhibition)\b/i };
const synonyms: Record<string, string[]> = { concert: ['concert', 'music', 'gig', 'performance', 'live'], show: ['concert', 'performance', 'music'], meetup: ['meetup', 'meeting', 'social', 'gathering', 'club'], tech: ['technology', 'software', 'computing'], technology: ['technology', 'software', 'computing', 'tech'], cybersecurity: ['cybersecurity', 'security', 'infosec', 'cyber'], metal: ['metal', 'metalcore', 'heavy', 'thrash'], restaurant: ['restaurant', 'food', 'dining', 'eatery'], traffic: ['traffic', 'road', 'detour', 'transportation'], construction: ['construction', 'roadwork', 'resurfacing', 'maintenance'], car: ['car', 'automotive', 'vehicle'], furry: ['furry', 'fursuit', 'anthro'], rock: ['rock', 'alternative', 'indie'], student: ['student', 'university', 'college', 'campus'] };
const stop = new Set('find show me my location around local nearby please looking are there any what whats is happening near within radius miles mile mi events event this now today tonight tomorrow weekend saturday sunday week for the a an of and in on at to why bad anything interesting announced newly new since yesterday last hours hour 24'.split(' '));
export function tokenize(value: string): string[] { return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean); }
export function expandTopic(topic: string): string[] { const singular = topic.replace(/s$/, ''); return [...new Set([topic, singular, ...(synonyms[singular] ?? [])])]; }
export function parseIntent(query: string): SearchIntent {
  const clean = query.trim().toLowerCase();
  const radius = clean.match(/(?:within|radius|near)\s+(\d{1,3})\s*(?:mi|miles?)\b/);
  const timeWindow: TimeWindow = /\b(weekend|saturday|sunday)\b/.test(clean) ? 'weekend' : /\btomorrow\b/.test(clean) ? 'tomorrow' : /\btonight\b/.test(clean) ? 'tonight' : /\btoday\b/.test(clean) ? 'today' : /\bthis week\b/.test(clean) ? 'week' : /\bnow\b/.test(clean) ? 'now' : 'all';
  const date = clean.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  const excluded:string[]=[];
  const subjectText=clean.replace(/\b(?:without|excluding|exclude)\s+(.+?)(?=\b(?:within|radius|today|tonight|tomorrow|this week|weekend)\b|$)/g,(_,text)=>{excluded.push(...tokenize(text));return '';}).replace(/(?:^|\s)-([a-z][a-z0-9]+)/g,(_,word)=>{excluded.push(word);return ' ';});
  const topics = [...new Set(tokenize(subjectText.replace(/\d{4}-\d{2}-\d{2}/g, '')).filter(word => word.length > 1 && !stop.has(word) && !/^\d+$/.test(word)))];
  const subject = clean.replace(/^show(?:\s+me)?\s+/, '');
  return { query, topics, exclusions:[...new Set(excluded.filter(word=>!stop.has(word)))], categories: (Object.keys(categoryWords) as Category[]).filter(category => categoryWords[category]!.test(subject)), radiusMiles: radius ? Math.min(150, Math.max(1, Number(radius[1]))) : undefined, timeWindow, newlyAnnounced: /\b(announced|since yesterday|last 24 hours)\b/.test(clean), ...(date ? { date } : {}) };
}
export function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radians = (x: number) => x * Math.PI / 180;
  const a = Math.sin(radians(lat2 - lat1) / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(radians(lng2 - lng1) / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}
function localParts(time: number, zone: string): Record<string, number> {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(time)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}
export function localMidnight(year: number, month: number, day: number, zone: string): number {
  const desired = Date.UTC(year, month - 1, day); let guess = desired;
  for (let i = 0; i < 4; i++) { const p = localParts(guess, zone); const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second); const shift = desired - represented; guess += shift; if (!shift) break; }
  return guess;
}
export function timeBounds(window: TimeWindow, now: string, timeZone = 'America/Indiana/Indianapolis', date?: string): [number, number] | null {
  const current = Date.parse(now); const p = localParts(current, timeZone);
  const localDay = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dayAt = (offset: number) => { const day = new Date(localDay.getTime() + offset * 86400000); return localMidnight(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), timeZone); };
  if (date) { const [y, m, d] = date.split('-').map(Number); return [localMidnight(y, m, d, timeZone), localMidnight(y, m, d + 1, timeZone)]; }
  if (window === 'all') return null;
  if (window === 'now') return [current, current];
  if (window === 'tomorrow') return [dayAt(1), dayAt(2)];
  if (window === 'week') return [current, dayAt(7)];
  if (window === 'weekend') { const day = localDay.getUTCDay(); const offset = day === 0 ? -1 : (6 - day + 7) % 7; return [dayAt(offset), dayAt(offset + 2)]; }
  if (window === 'today') return [dayAt(0), dayAt(1)];
  return [current, dayAt(1)];
}
export function matchesTime(h: Happening, window: TimeWindow, now: string, timeZone = 'America/Indiana/Indianapolis', date?: string): boolean {
  const bounds = timeBounds(window, now, timeZone, date); if (!bounds) return true;
  if (!h.startTime) {
    if (!h.publishedAt) return false;
    const published = Date.parse(h.publishedAt);
    if (window === 'week' && !date) return published >= Date.parse(now) - 7 * 86400000 && published <= Date.parse(now);
    return published >= bounds[0] && published < bounds[1];
  }
  const start = Date.parse(h.startTime); const end = Date.parse(h.endTime ?? h.startTime);
  return end >= bounds[0] && (bounds[0] === bounds[1] ? start <= bounds[1] : start < bounds[1]);
}
export function textCorpus(h: Happening): string { return [h.title, h.summary, h.category, h.subcategory, h.locationName, ...h.tags].join(' ').toLowerCase(); }
export function matchesIntent(h: Happening, intent: SearchIntent, origin: Pick<Location, 'latitude' | 'longitude'> | null | undefined, radius: number, now: string, timeZone = 'America/Indiana/Indianapolis'): boolean {
  if (origin && h.latitude !== null && h.longitude !== null && distanceMiles(origin.latitude, origin.longitude, h.latitude, h.longitude) > (intent.radiusMiles ?? radius)) return false;
  if (intent.radiusMiles && (h.latitude === null || h.longitude === null)) return false;
  if (!matchesTime(h, intent.timeWindow, now, timeZone, intent.date)) return false;
  if (intent.newlyAnnounced && Date.parse(h.publishedAt ?? h.discoveredAt) < Date.parse(now) - 86400000) return false;
  const words = new Set(tokenize(textCorpus(h)));
  if (intent.exclusions?.some(topic=>expandTopic(topic).some(term=>words.has(term)))) return false;
  return intent.topics.every(topic => expandTopic(topic).some(term => words.has(term))) && (!intent.categories.length || intent.categories.some(category => category === h.category) || intent.topics.length > 0);
}
export function searchHappenings(items: Happening[], query: string, origin: Location | null, radius: number, now: string, timeZone = origin?.timezone ?? 'America/Indiana/Indianapolis'): Happening[] {
  const intent = parseIntent(query); const docs = items.map(h => tokenize(textCorpus(h))); const avg = docs.reduce((sum, d) => sum + d.length, 0) / Math.max(1, docs.length);
  const score = (h: Happening) => { const words = docs[items.indexOf(h)]; return intent.topics.reduce((total, topic) => { const terms = expandTopic(topic); const frequency = words.filter(w => terms.includes(w)).length; const docFrequency = docs.filter(d => d.some(w => terms.includes(w))).length; const idf = Math.log(1 + (items.length - docFrequency + 0.5) / (docFrequency + 0.5)); return total + idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * words.length / Math.max(1, avg))); }, 0); };
  return items.filter(h => matchesIntent(h, intent, origin, radius, now, timeZone)).map(h => ({ h, score: score(h) })).sort((a, b) => b.score - a.score || b.h.relevance - a.h.relevance).map(x => x.h);
}
