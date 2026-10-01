import { describe,it,expect } from 'vitest';
import { LocalDatabase } from '../src/backend/database';
import { SearchDiscoveryEngine,parseSearchResults,webDiscoveryQueries,canonicalUrl,interactiveSearchUrl } from '../src/backend/discovery/search';
import { testSettings as defaultSettings } from './fixtures/test-records';
import { WorkQueue } from '../src/backend/scheduler/queue';
import { sourceFromResult } from '../src/backend/discovery/directory';

describe('independent public search providers',()=>{
  it('survives provider failures, caches queries, and keeps URLs unique',async()=>{
    const db=new LocalDatabase(':memory:');let calls=0;
    const engine=new SearchDiscoveryEngine([{name:'Unavailable',async search(){throw Error('HTTP 403');}},{name:'Accessible',async search(){calls++;return [{title:'City calendar',url:'https://city.example/events?utm_source=search',snippet:'Published calendar'}];}}],db.intelligence);
    const query={query:'City events',locationName:'City',radiusMiles:25};
    expect(await engine.search(query,'city')).toHaveLength(1);expect(await engine.search(query,'city')).toHaveLength(1);expect(calls).toBe(1);
    await engine.search(query,'other-area');expect(calls).toBe(2);db.close();
  });
  it('reads documented JSON shapes without turning snippets into event facts',()=>{
    expect(parseSearchResults([{url:'https://venue.example/calendar',title:[{value:'Venue ',is_bold:false},{value:'calendar',is_bold:true}],extract:[{value:'Tonight'}]}])).toEqual([{url:'https://venue.example/calendar',title:'Venue calendar',snippet:'Tonight'}]);
    expect(parseSearchResults({results:[{url:'javascript:alert(1)',title:'Unsafe'},{url:'https://example.org/login',title:'Login'}]})).toEqual([]);
    expect(canonicalUrl('https://example.org/event?utm_source=a&id=2#section')).toBe('https://example.org/event?id=2');
  });
  it('expands place, interests, active Radars and news/transport/community queries',()=>{
    const queries=webDiscoveryQueries(defaultSettings.location,[{id:'radar',name:'Music',query:'metal concerts',enabled:true,radiusMiles:25,createdAt:new Date().toISOString()}],['Furry meetups'],[{name:'Nearby City',latitude:39.8,longitude:-86.1}]);
    expect(queries.some(q=>q.includes('road closure'))).toBe(true);expect(queries.some(q=>q.includes('metal concerts'))).toBe(true);expect(queries.some(q=>q.includes('Nearby City'))).toBe(true);
    expect(new URL(interactiveSearchUrl('google','Fishers music')).searchParams.get('q')).toBe('Fishers music');
  });
  it('does not trust an official-sounding title supplied by search results',()=>{
    expect(sourceFromResult({title:'Official website',url:'https://unknown.example',snippet:'Search result'},defaultSettings.location).type).toBe('UNVERIFIED');
  });
});
describe('bounded independent work lanes',()=>{
  it('serializes work and releases its slot after a synchronous failure',async()=>{
    const queue=new WorkQueue('verification',1,2);let active=0,max=0;
    await expect(queue.run(()=>{throw Error('Broken task');})).rejects.toThrow('Broken');
    const work=()=>queue.run(async()=>{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,10));active--;return true;});
    expect(await Promise.all([work(),work()])).toEqual([true,true]);expect(max).toBe(1);
  });
});
