import { createHash } from 'node:crypto';
import { plainText, publicUrl } from '../parsers/common';
import type { DiscoveryQuery, DiscoveryResult } from './provider';
import type { SearchCache, SearchResult } from '../../shared/intelligence';
import type { Location, Radar } from '../../shared/models';
import { PublicHttp } from '../collectors/http';
import { distanceMiles } from '../search/intent';

export interface SearchDiscoveryProvider {
  readonly name:string;
  search(query:DiscoveryQuery,signal?:AbortSignal):Promise<DiscoveryResult[]>;
}
export function parseSearchResults(input:unknown):DiscoveryResult[] {
  const data=input as {results?:unknown[]};const rows=Array.isArray(input)?input:Array.isArray(data?.results)?data.results:[];
  const text=(value:unknown)=>Array.isArray(value)?value.map(item=>typeof item==='object'&&item?String((item as {value?:unknown}).value||''):'').join(''):typeof value==='string'?value:'';
  return rows.slice(0,30).flatMap(value=>{
    if(!value||typeof value!=='object')return [];const row=value as Record<string,unknown>;const url=publicUrl(typeof row.url==='string'?row.url:'');
    const title=plainText(text(row.title),300),snippet=plainText(text(row.content??row.extract??row.snippet),240);
    if(!url||!title||/\/(?:login|signin|account|checkout)(?:\/|$)/i.test(new URL(url).pathname))return [];
    return [{title,url,snippet}];
  }).filter((result,index,array)=>array.findIndex(other=>canonicalUrl(other.url)===canonicalUrl(result.url))===index);
}
export function canonicalUrl(value:string):string {const url=new URL(value);url.hash='';for(const key of [...url.searchParams.keys()])if(/^utm_|^(fbclid|gclid|ref)$/i.test(key))url.searchParams.delete(key);return url.href;}
export class MwmblSearchProvider implements SearchDiscoveryProvider {
  readonly name='Mwmbl public web index';constructor(private http:PublicHttp){}
  async search(query:DiscoveryQuery,signal?:AbortSignal) {
    signal?.throwIfAborted();const url=new URL('https://api.mwmbl.org/api/v2/search/');url.searchParams.set('q',query.query);
    // Published unauthenticated application API, not HTML/search-page scraping.
    const response=await this.http.request(url.href,{},false);signal?.throwIfAborted();
    if(response.status!==200)throw Error(`Mwmbl search unavailable (HTTP ${response.status})`);
    return parseSearchResults(JSON.parse(response.body));
  }
}
export class SearxngSearchProvider implements SearchDiscoveryProvider {
  readonly name:string;constructor(private http:PublicHttp,private endpoint:string){this.name=`SearXNG · ${new URL(endpoint).host}${new URL(endpoint).pathname}`;}
  async search(query:DiscoveryQuery,signal?:AbortSignal) {
    signal?.throwIfAborted();const url=new URL(this.endpoint);url.pathname=url.pathname.replace(/\/?(?:search)?\/?$/,'/')+'search';url.search='';url.searchParams.set('q',query.query);url.searchParams.set('format','json');url.searchParams.set('safesearch','1');
    const response=await this.http.request(url.href,{},false);signal?.throwIfAborted();
    if(response.status!==200)throw Error(`Configured search API unavailable (HTTP ${response.status}); the instance must permit JSON requests.`);
    return parseSearchResults(JSON.parse(response.body));
  }
}
export interface SearchCacheStore { getSearch(key:string,now?:number):SearchCache|null;cacheSearch(value:SearchCache):void }
export class SearchDiscoveryEngine {
  private cooldown=new Map<string,number>();private pending=new Map<string,Promise<SearchResult[]>>();
  constructor(private providers:SearchDiscoveryProvider[],private cache:SearchCacheStore){}
  async search(query:DiscoveryQuery,key:string,onProvider?:(name:string,status:string)=>void,signal?:AbortSignal):Promise<SearchResult[]> {
    const output:SearchResult[]=[];
    for(const provider of this.providers){
      signal?.throwIfAborted();const cacheKey=createHash('sha256').update(`${provider.name}|${key}|${query.radiusMiles}|${query.query.trim().toLowerCase()}`).digest('hex');
      const cached=this.cache.getSearch(cacheKey);
      if(cached){onProvider?.(provider.name,cached.error?`Cached failure: ${cached.error}`:`${cached.results.length} cached results`);output.push(...cached.results);continue;}
      if((this.cooldown.get(provider.name)||0)>Date.now()){onProvider?.(provider.name,'Cooling down after an access/network failure');continue;}
      let work=this.pending.get(cacheKey);
      if(!work){work=(async()=>{try{
        onProvider?.(provider.name,'Searching');const now=new Date().toISOString();const results=(await Promise.resolve().then(()=>provider.search(query,signal))).map(row=>({...row,url:canonicalUrl(row.url),provider:provider.name,query:query.query,foundAt:now}));
        this.cache.cacheSearch({key:cacheKey,query:query.query,provider:provider.name,locationKey:key,results,expiresAt:new Date(Date.now()+6*3600000).toISOString()});onProvider?.(provider.name,`${results.length} results`);return results;
      }catch(error){signal?.throwIfAborted();const message=String(error).slice(0,500);this.cooldown.set(provider.name,Date.now()+15*60000);this.cache.cacheSearch({key:cacheKey,query:query.query,provider:provider.name,locationKey:key,results:[],error:message,expiresAt:new Date(Date.now()+15*60000).toISOString()});onProvider?.(provider.name,message);return [];}finally{this.pending.delete(cacheKey);}})();this.pending.set(cacheKey,work);}
      output.push(...await work);
    }
    return output.filter((item,index,array)=>array.findIndex(other=>other.url===item.url)===index).slice(0,30);
  }
}
const facets=['events today','events this weekend','community events','concert','festival','road closure','construction','police news','fire department','public notices','city council','traffic','meetup','things happening','breaking news','local events','new business','market','convention','live music'];
export function webDiscoveryQueries(location:Location,radars:Radar[],interests:string[],nearby:Location[]=[],query?:string,category?:string):string[] {
  const area=location.name.split(',').slice(0,2).join(', ');const queries:string[]=[];
  if(query?.trim())queries.push(`${area} ${query.trim()}`,`"${location.name.split(',')[0]}" ${query.trim()} organizer`,`${area} ${query.trim()} event calendar`);
  for(const radar of radars.filter(r=>r.enabled).sort((a,b)=>({high:2,normal:1,low:0}[b.priority||"normal"])-({high:2,normal:1,low:0}[a.priority||"normal"])).slice(0,8))queries.push(`${area} ${radar.query}`);
  for(const interest of interests.slice(0,6))queries.push(`${area} ${interest}`);
  for(const facet of category?[`${category} announcements`,`${category} events`,`${category} public posts`,...facets]:facets)queries.push(`${area} ${facet}`);
  for(const place of nearby.slice(0,4))for(const facet of ['events this weekend','community calendar','local news'])queries.push(`${place.name} ${facet}`);
  return [...new Set(queries.map(q=>q.replace(/\s+/g,' ').trim()))].slice(0,50);
}
export function intersectingWatchLocations(location:Location,radius:number,areas:{location:Location}[]):Location[]{return areas.map(area=>area.location).filter(place=>place.name!==location.name&&distanceMiles(location.latitude,location.longitude,place.latitude,place.longitude)<=radius);}
export function interactiveSearchUrl(provider:'google'|'bing'|'brave',query:string):string {const url=new URL(provider==='google'?'https://www.google.com/search':provider==='bing'?'https://www.bing.com/search':'https://search.brave.com/search');url.searchParams.set('q',query);return url.href;}
