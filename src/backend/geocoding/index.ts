import type { Location } from '../../shared/models';
import { PublicHttp } from '../collectors/http';
import { distanceMiles } from '../search/intent';

export interface GeocodeCache { getGeocode(query: string): Location | null; cacheGeocode(query: string, location: Location): void }
export interface Geocoder { resolve(query: string, bias?: Location): Promise<Location | null> }
const stateNames: Record<string,string> = { in:'indiana', il:'illinois', ny:'new york', ca:'california', oh:'ohio', tx:'texas', wa:'washington', ma:'massachusetts', fl:'florida', co:'colorado', nc:'north carolina', tn:'tennessee', az:'arizona', pa:'pennsylvania', or:'oregon', ga:'georgia', mi:'michigan', mn:'minnesota', wi:'wisconsin', mo:'missouri', md:'maryland', va:'virginia' };
export class CachedGeocoder implements Geocoder {
  private misses=new Map<string,number>();
  constructor(private cache: GeocodeCache, private http: PublicHttp) {}
  private async cityTimezone(location:Location):Promise<string|undefined> {
    const name=(location.discoveryName||location.name).split(',')[0];
    const response=await this.http.request(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=30&language=en&format=json`);
    if(response.status!==200)return undefined;
    return JSON.parse(response.body).results?.find((city:Location&{name:string})=>city.name.toLowerCase()===name.toLowerCase()&&distanceMiles(location.latitude,location.longitude,city.latitude,city.longitude)<50)?.timezone;
  }
  async discoveryArea(location:Location):Promise<Location> {
    if(location.discoveryName || !location.key?.startsWith('osm:'))return location;
    const key=`discovery-area:${location.key}`;const cached=this.cache.getGeocode(key);if(cached)return {...location,discoveryName:cached.discoveryName,timezone:location.timezone||cached.timezone};
    const url=new URL('https://photon.komoot.io/reverse');url.search=new URLSearchParams({lat:String(location.latitude),lon:String(location.longitude),limit:'1'}).toString();
    const response=await this.http.request(url.href,{},false);if(response.status!==200)throw Error(`Area geocoder HTTP ${response.status}`);
    const feature=JSON.parse(response.body).features?.[0];const p=feature?.properties;const coordinates=feature?.geometry?.coordinates;
    const city=p?.city||(p?.osm_key==='place'&&/^(city|town|village|hamlet)$/.test(p.osm_value||p.type||'')?p.name:undefined);
    if(!city || !Array.isArray(coordinates) || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1]) || distanceMiles(location.latitude,location.longitude,coordinates[1],coordinates[0])>5)return location;
    const result={...location,discoveryName:[city,p.state,p.countrycode?.toUpperCase()||p.country].filter(Boolean).join(', ')};
    if(!result.timezone){try{result.timezone=await this.cityTimezone(result);}catch{/* Keep the selected coordinates if city lookup is unavailable. */}}
    this.cache.cacheGeocode(key,result);return result;
  }
  async resolve(query: string, bias?: Location): Promise<Location | null> {
    const key = `${query.trim().toLowerCase()}|${bias?.name || ''}`;
    const cached = this.cache.getGeocode(key); if (cached) return cached;
    if ((this.misses.get(key)||0)>Date.now()) return null;
    const parts = query.split(',').map(p=>p.trim());
    if (!bias) {try {
      const response = await this.http.request(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(parts[0])}&count=30&language=en&format=json`);
      if (response.status !== 200) throw Error(`Geocoder HTTP ${response.status}`);
      const results = JSON.parse(response.body).results || [];
      const qualifiers=parts.slice(1).map(part=>part.toLowerCase()).filter(Boolean);
      const candidates=results.filter((r:Record<string,string>)=>qualifiers.every(qualifier=>[r.admin1,r.country,r.country_code,r.admin2].some(v=>v&&v.toLowerCase()===(stateNames[qualifier]||qualifier))));
      candidates.sort((a:Record<string,string>,b:Record<string,string>)=>Number(b.name.toLowerCase()===parts[0].toLowerCase())-Number(a.name.toLowerCase()===parts[0].toLowerCase()));
      const result = candidates[0];
      if (result) {
        const location: Location = { name: [result.name,result.admin1,result.country_code].filter(Boolean).join(', '), latitude: result.latitude, longitude: result.longitude, timezone: result.timezone, countryCode: result.country_code, region: result.admin1, key: `geonames:${result.id}` };
        this.cache.cacheGeocode(key, location); return location;
      }
    }catch{/* The independent address API can still resolve the selected place. */}}
    const request = new URL('https://photon.komoot.io/api/'); request.searchParams.set('q',query); request.searchParams.set('limit','3');
    if (bias) { request.searchParams.set('lat',String(bias.latitude)); request.searchParams.set('lon',String(bias.longitude)); }
    // The operator explicitly permits bounded project use of this documented API:
    // https://github.com/komoot/photon#demo-server . Robots govern web indexing.
    const response = await this.http.request(request.href,{},false);
    if (response.status !== 200) throw Error(`Address geocoder HTTP ${response.status}`);
    const candidates = JSON.parse(response.body).features || [];
    const words = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(Boolean);
    const ignored = new Set([...words(bias?.name || ''), 'the', 'at', 'of', 'usa', 'us']);
    const requested = words(parts[0]).filter(word => !ignored.has(word));
    const match = candidates.find((f: any) => {
      const coordinates=f.geometry?.coordinates;
      if (!Array.isArray(coordinates) || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) return false;
      if (!bias) return true;
      if (Math.abs(coordinates[1]-bias.latitude)>=1.5 || Math.abs(coordinates[0]-bias.longitude)>=2) return false;
      // A nearby city centroid or unrelated business is not a venue/address match.
      const actual=new Set(words([f.properties?.name,f.properties?.street,f.properties?.housenumber].filter(Boolean).join(' ')));
      return requested.length>0 && requested.filter(word=>actual.has(word)).length/requested.length>=0.75;
    });
    if (!match) { this.misses.set(key,Date.now()+86400000); if(this.misses.size>100)this.misses.delete(this.misses.keys().next().value!); return null; }
    const p = match.properties;
    const city=p.city||(p.osm_key==='place'&&/^(city|town|village|hamlet)$/.test(p.osm_value||p.type||'')?p.name:undefined);
    const result: Location = { name: [p.name,p.street,p.city,p.state,p.country].filter(Boolean).join(', '), latitude:match.geometry.coordinates[1],longitude:match.geometry.coordinates[0],timezone:bias?.timezone,countryCode:p.countrycode?.toUpperCase(),region:p.state,key:`osm:${p.osm_type}:${p.osm_id}`, ...(!bias&&city?{discoveryName:[city,p.state,p.countrycode?.toUpperCase()||p.country].filter(Boolean).join(', ')}:{}) };
    if(!bias&&result.discoveryName){try{result.timezone=await this.cityTimezone(result);}catch{/* The address remains usable when the city API is unavailable. */}}
    this.cache.cacheGeocode(key,result); return result;
  }
}
