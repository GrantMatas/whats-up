import { describe, expect, it } from 'vitest';
import { CachedGeocoder } from '../src/backend/geocoding';
import type { Location } from '../src/shared/models';
import type { PublicHttp } from '../src/backend/collectors/http';

describe('venue geocoding', () => {
  it('repairs a saved street area using its surrounding city without moving the map',async()=>{
    const location:Location={name:'Sample intersection, Example Street, Sampleton, Indiana, US',latitude:40,longitude:-86,key:'osm:N:123'};
    const cache=new Map<string,Location>();let requests=0;
    const http={async request(url:string){requests++;return {status:200,body:JSON.stringify(url.includes('/reverse')?{features:[{properties:{city:'Sampleton',state:'Indiana',countrycode:'us'},geometry:{coordinates:[-86,40]}}]}:{results:[{name:'Sampleton',latitude:40,longitude:-86,timezone:'America/Indiana/Indianapolis'}]})};}} as unknown as PublicHttp;
    const geocoder=new CachedGeocoder({getGeocode:key=>cache.get(key)||null,cacheGeocode:(key,value)=>{cache.set(key,value);}},http);
    const resolved=await geocoder.discoveryArea(location);
    expect(resolved).toMatchObject({...location,discoveryName:'Sampleton, Indiana, US',timezone:'America/Indiana/Indianapolis'});
    expect(await geocoder.discoveryArea(location)).toEqual(resolved);expect(requests).toBe(2);
  });
  it('uses the city and its time zone when the address provider returns a venue',async()=>{
    const http={async request(url:string){return {status:200,body:JSON.stringify(url.includes('photon')?{features:[{properties:{name:'Sample Academy',city:'Sampleton',state:'Indiana',countrycode:'us',osm_type:'W',osm_id:5},geometry:{coordinates:[-86,40]}}]}:new URL(url).searchParams.get('name')==='Sampleton'?{results:[{name:'Sampleton',latitude:40,longitude:-86,timezone:'America/Indiana/Indianapolis'}]}:{results:[]})};}} as unknown as PublicHttp;
    const resolved=await new CachedGeocoder({getGeocode:()=>null,cacheGeocode:()=>{}},http).resolve('Sampleton IN');
    expect(resolved).toMatchObject({discoveryName:'Sampleton, Indiana, US',timezone:'America/Indiana/Indianapolis',latitude:40,longitude:-86});
  });
  it('requires both the selected state and country to match a city search',async()=>{
    const http={async request(){return {status:200,body:JSON.stringify({results:[{name:'Sampleton',admin1:'Other State',country_code:'US',latitude:41,longitude:-85,id:1},{name:'Sampleton',admin1:'Indiana',country_code:'US',latitude:40,longitude:-86,id:2}]})};}} as unknown as PublicHttp;
    expect((await new CachedGeocoder({getGeocode:()=>null,cacheGeocode:()=>{}},http).resolve('Sampleton, IN, US'))?.key).toBe('geonames:2');
  });
  it('rejects nearby unrelated coordinates and caches a matching real venue', async () => {
    const bias: Location = { name: 'Seattle, Washington, US', latitude: 47.6, longitude: -122.33 };
    const cache = new Map<string,Location>(); let requests=0;
    const feature = (name: string) => ({ properties: { name, osm_type: 'W', osm_id: 123 }, geometry: { coordinates: [-122.354,47.622] } });
    const http = { request: async () => { requests++; return { status:200, body:JSON.stringify({features:[feature('Seattle'),feature('Climate Pledge Arena')]}) }; } } as unknown as PublicHttp;
    const geocoder = new CachedGeocoder({getGeocode:key=>cache.get(key)||null,cacheGeocode:(key,value)=>{cache.set(key,value);}},http);
    expect(await geocoder.resolve('Unrelated Venue, Seattle, Washington, US',bias)).toBeNull();
    const query='Climate Pledge Arena, Seattle, Washington, US';
    expect((await geocoder.resolve(query,bias))?.latitude).toBe(47.622);
    await geocoder.resolve(query,bias); expect(requests).toBe(2);
  });
});
