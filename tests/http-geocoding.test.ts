import {describe,it,expect} from 'vitest';
import {publicAddress,robotsAllows,PublicHttp,validatePublicUrl} from '../src/backend/collectors/http';
import {CachedGeocoder} from '../src/backend/geocoding';
import type {Location} from '../src/shared/models';
describe('public source boundaries',()=>{
 it('rejects private, local, reserved and mapped addresses',()=>{for(const address of ['127.0.0.1','10.5.2.1','172.16.0.1','192.168.0.1','169.254.1.2','100.64.0.1','224.0.0.1','::1','::ffff:127.0.0.1','fd00::1'])expect(publicAddress(address)).toBe(false);expect(publicAddress('8.8.8.8')).toBe(true);});
 it('applies matching groups, longest rules and explicit allow exceptions',()=>{const body='User-agent: OtherBot\nDisallow: /\nUser-agent: *\nDisallow: /search\nAllow: /search/public\nDisallow: /private*secret$';expect(robotsAllows(body,'/calendar')).toBe(true);expect(robotsAllows(body,'/search?q=events')).toBe(false);expect(robotsAllows(body,'/search/public')).toBe(true);expect(robotsAllows(body,'/private/foo/secret')).toBe(false);});
 it('rejects URLs without making a network request',async()=>{for(const url of ['https://127.0.0.1/x','http://example.com','https://user:pass@example.com','https://example.com:1234/'])await expect(validatePublicUrl(url)).rejects.toThrow();});
});
describe('cached geocoding',()=>{
 it('reuses exact address lookups and respects region qualification',async()=>{
  const values=new Map<string,Location>();let requests=0;
  const cache={getGeocode:(key:string)=>values.get(key)||null,cacheGeocode:(key:string,value:Location)=>{values.set(key,value);}};
  const http={async request(){requests++;return {status:200,body:JSON.stringify({results:[{id:1,name:'Springfield',admin1:'Illinois',country:'United States',country_code:'US',latitude:39,longitude:-89,timezone:'America/Chicago'},{id:2,name:'Springfield',admin1:'Massachusetts',country:'United States',country_code:'US',latitude:42,longitude:-72,timezone:'America/New_York'}]})};}} as unknown as PublicHttp;
  const geocoder=new CachedGeocoder(cache,http);const result=await geocoder.resolve('Springfield, Massachusetts');expect(result?.latitude).toBe(42);expect(await geocoder.resolve('Springfield, Massachusetts')).toEqual(result);expect(requests).toBe(1);
 });
});
