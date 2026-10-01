import { describe, expect, it } from 'vitest';
import { CachedGeocoder } from '../src/backend/geocoding';
import type { Location } from '../src/shared/models';
import type { PublicHttp } from '../src/backend/collectors/http';

describe('venue geocoding', () => {
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
