import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Music2, UsersRound, Construction, CloudSun, Landmark, Shield, Utensils, Cpu, Trophy, CalendarDays, HeartHandshake, Newspaper, Store, GraduationCap, Palette, CircleDot, ShieldAlert } from 'lucide-react';
import type { AppSettings, Category, Happening, Radar } from '../shared/models';
import { distanceMiles, matchesIntent, matchesTime, parseIntent, type TimeWindow } from '../backend/search/intent';
import { matchRadar } from '../backend/radar/matching';
export const categoryInfo = {
  music: { label: 'Music', icon: Music2, color: '#8b719e' }, community: { label: 'Community', icon: UsersRound, color: '#608879' },
  traffic: { label: 'Roads & transit', icon: Construction, color: '#c68a43' }, weather: { label: 'Weather', icon: CloudSun, color: '#5d8ca0' },
  government: { label: 'Civic', icon: Landmark, color: '#7b8390' }, safety: { label: 'Safety', icon: Shield, color: '#ad5c52' },
  food: { label: 'Food & drink', icon: Utensils, color: '#ae7459' }, technology: { label: 'Technology', icon: Cpu, color: '#638f98' }, sports: { label: 'Sports', icon: Trophy, color: '#728b54' },
  events: { label:'Events', icon:CalendarDays, color:'#8b719e' }, construction:{ label:'Construction', icon:Construction, color:'#c68a43' },
  public_service:{ label:'Public services', icon:HeartHandshake, color:'#608879' }, news:{ label:'Local news', icon:Newspaper, color:'#7b8390' },
  business:{ label:'Business', icon:Store, color:'#ae7459' }, education:{ label:'Education', icon:GraduationCap, color:'#638f98' },
  arts:{ label:'Arts & culture', icon:Palette, color:'#8b719e' }, other:{ label:'Other', icon:CircleDot, color:'#7b8390' }, public_safety:{ label:'Public safety', icon:ShieldAlert, color:'#ad5c52' },
} satisfies Record<Category, {label:string;icon:typeof Music2;color:string}> & Record<string,{label:string;icon:typeof Music2;color:string}>;
export interface DataDisplayContext {
  location: { latitude:number; longitude:number; name?:string } | null;
  demoMode:boolean;
  now:string;
  timeZone:string;
}
function validZone(timeZone?:string) {
  const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try { if (timeZone) { new Intl.DateTimeFormat('en-US',{timeZone}).format(); return timeZone; } } catch { /* Invalid imported timezone uses the device timezone. */ }
  return fallback;
}
export function createDisplayContext(settings:AppSettings, now:number|string = Date.now()):DataDisplayContext {
  const liveTime = new Date(now);
  const timeZone = 'timezone' in settings.location ? settings.location.timezone as string | undefined : undefined;
  return { location:settings.location, demoMode:false,
    now:(Number.isFinite(liveTime.valueOf()) ? liveTime.toISOString() : new Date().toISOString()),
    timeZone:validZone(timeZone) };
}
function defaultContext():DataDisplayContext { return { location:null, demoMode:false, now:new Date().toISOString(), timeZone:validZone() }; }
const DisplayContext = createContext<DataDisplayContext | null>(null);
export function DataDisplayProvider({settings,children,now}:{settings:AppSettings;children:ReactNode;now?:number|string}) {
  const [clock,setClock] = useState(Date.now());
  useEffect(() => {
    if (now !== undefined) return;
    const timer = window.setInterval(() => setClock(Date.now()),60_000);
    return () => window.clearInterval(timer);
  },[settings.demoMode,now]);
  return <DisplayContext.Provider value={createDisplayContext(settings,now ?? clock)}>{children}</DisplayContext.Provider>;
}
export function useDataDisplay() { return useContext(DisplayContext) ?? defaultContext(); }
export function distance(item:Happening, context:DataDisplayContext = defaultContext()):number|null {
  if (!context.location || item.latitude == null || item.longitude == null || !Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) return null;
  return distanceMiles(context.location.latitude,context.location.longitude,item.latitude,item.longitude);
}
export function distanceLabel(item:Happening, context?:DataDisplayContext) {
  const miles = distance(item,context);
  return miles === null ? 'Distance unavailable' : `${miles.toFixed(1)} mi`;
}
export type TimeFilter = 'Now'|'Today'|'Tonight'|'Tomorrow'|'Weekend'|'This week'|'All collected';
export const timeFilters: TimeFilter[] = ['Now','Today','Tonight','Tomorrow','Weekend','This week','All collected'];
const timeWindows: Record<TimeFilter, TimeWindow> = { Now:'now', Today:'today', Tonight:'tonight', Tomorrow:'tomorrow', Weekend:'weekend', 'This week':'week', 'All collected':'all' };
export function inTime(item:Happening,time:TimeFilter,context:DataDisplayContext = defaultContext()) {
  return matchesTime(item, timeWindows[time], context.now, context.timeZone);
}
export function when(item:Happening,context:DataDisplayContext = defaultContext()) {
  if (!item.startTime) return item.publishedAt ? 'Published '+new Date(item.publishedAt).toLocaleDateString('en-US',{timeZone:validZone(context.timeZone),month:'short',day:'numeric'}) : 'Time not provided';
  const date = new Date(item.startTime);
  if (!Number.isFinite(date.valueOf())) return 'Time not provided';
  const label=date.toLocaleDateString('en-US',{timeZone:validZone(context.timeZone),weekday:'short',month:'short',day:'numeric'});
  return label+' · '+(item.allDay?(item.rawMetadata?.format==='ical'?'All day':'Time not provided'):date.toLocaleTimeString('en-US',{timeZone:validZone(context.timeZone),hour:'numeric',minute:'2-digit'}));
}
export function searchMatch(item:Happening,query:string,context:DataDisplayContext = defaultContext()) {
  if (!query.trim()) return true;
  return matchesIntent(item, parseIntent(query), context.location, 150, context.now, context.timeZone);
}
export function radarMatches(items:Happening[],radar:Radar,settings:AppSettings,context:DataDisplayContext = createDisplayContext(settings)) {
  const location = { ...settings.location, ...(context.location ?? {}), timezone:context.timeZone };
  return matchRadar(radar,items,{...settings,location},context.now);
}
export function Brand({small=false}:{small?:boolean}) {
  return <div className={`brand ${small?'small':''}`}><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2 29 9.5v13L16 30 3 22.5v-13Z" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="m9 21 4-11 10 1-4 11Z" fill="currentColor"/><circle cx="16" cy="16" r="2.2" fill="var(--sidebar)"/></svg><span>what’s up<span className="brand-dot">.</span></span></div>;
}
