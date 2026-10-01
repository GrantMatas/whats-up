import { describe, expect, it } from 'vitest';
import { testHappenings, TEST_NOW } from './fixtures/test-records';
import { testSettings as defaultSettings } from './fixtures/test-records';
import { parseIntent } from '../src/backend/search/intent';
import { createDisplayContext, distance, distanceLabel, inTime, radarMatches, searchMatch, when } from '../src/renderer/ui';
import type { Happening, Radar } from '../src/shared/models';

const testCenter=defaultSettings.location;const testContext=createDisplayContext(defaultSettings,TEST_NOW);
const ids = (query: string) => testHappenings.filter(item => searchMatch(item, query,testContext)).map(item => item.id);
const metal = testHappenings.find(item => item.id === 'metal-foundry')!;
const sample = (changes: Partial<Happening>) => ({ ...metal, ...changes });
const radar: Radar = { id: 'test-radar', name: 'Furry weekends', query: 'Find furry meetups this weekend', radiusMiles: 50, enabled: true, createdAt: TEST_NOW };

describe('shared renderer discovery filters', () => {
  it('finds specific metal concerts without returning unrelated music', () => {
    expect(ids('Find metal concerts within 50 miles')).toEqual(['metal-foundry']);
    expect(ids('Find metal concert near my location')).toEqual(['metal-foundry']);
    expect(ids('Find metal concerts tonight')).toEqual([]);
  });

  it('honors a furry weekend query and the parsed radius', () => {
    expect(ids('Are there any furry meetups this weekend?')).toEqual(['furry-social']);
    expect(ids('Find furry meetups within 1 mile this weekend')).toEqual([]);
    expect(ids('Find furry meetups within 50 miles tonight')).toEqual([]);
  });

  it('leaves an empty search unrestricted and retains place names', () => {
    expect(ids('  ')).toHaveLength(testHappenings.length);
    expect(ids('Canal Walk')).toEqual(['canal-jazz']);
    expect(parseIntent('Find metal concerts radius 50 miles around my location')).toMatchObject({ topics: ['metal', 'concerts'], radiusMiles: 50 });
  });

  it('uses the demo clock for inclusive ongoing events and exclusive next-day starts', () => {
    const midnight = sample({ startTime: '2026-09-30T04:00:00.000Z', endTime: '2026-09-30T05:00:00.000Z' });
    expect(inTime(midnight, 'Tonight',testContext)).toBe(false);
    expect(inTime(midnight, 'Tomorrow',testContext)).toBe(true);
    expect(searchMatch(midnight, 'What is happening tonight?',testContext)).toBe(false);
    const ongoing = sample({ startTime: '2026-09-29T21:00:00.000Z', endTime: TEST_NOW });
    expect(inTime(ongoing, 'Now',testContext)).toBe(true);
    expect(searchMatch(ongoing, 'Show events now',testContext)).toBe(true);
    const monday = sample({ startTime: '2026-10-05T04:00:00.000Z', endTime: '2026-10-05T05:00:00.000Z' });
    expect(inTime(monday, 'Weekend',testContext)).toBe(false);
    expect(inTime(testHappenings.find(item => item.id === 'furry-social')!, 'Weekend',testContext)).toBe(true);
  });

  it('applies announcement freshness without turning the show instruction into a music category', () => {
    const recent = testHappenings.find(item => item.id === 'furry-social')!;
    const boundary = sample({ discoveredAt: new Date(Date.parse(TEST_NOW) - 86400000).toISOString() });
    const stale = sample({ discoveredAt: new Date(Date.parse(TEST_NOW) - 86400001).toISOString() });
    expect(searchMatch(recent, 'Show newly announced events since yesterday',testContext)).toBe(true);
    expect(searchMatch(boundary, 'Show events announced in the last 24 hours',testContext)).toBe(true);
    expect(searchMatch(stale, 'Show newly announced events',testContext)).toBe(false);
    expect(parseIntent('Show events announced since yesterday').categories).toEqual([]);
  });

  it('computes distances and enforces the search radius', () => {
    expect(distance(sample(testCenter),testContext)).toBe(0);
    const far = sample({ latitude: testCenter.latitude + 2, longitude: testCenter.longitude });
    expect(distance(far,testContext)).toBeGreaterThan(100);
    expect(searchMatch(far, 'metal concerts within 50 miles',testContext)).toBe(false);
    expect(searchMatch(far, 'metal concerts within 150 miles',testContext)).toBe(true);
  });

  it('matches Radars at the chosen location, respecting radius and relevance order', () => {
    const farSettings={...defaultSettings,location:{name:'New York',latitude:40.8,longitude:-74}};
    expect(radarMatches(testHappenings,radar,farSettings,createDisplayContext(farSettings,TEST_NOW))).toEqual([]);
    expect(radarMatches(testHappenings,radar,defaultSettings,testContext).map(h=>h.id)).toEqual(['furry-social']);
    expect(radarMatches(testHappenings,{...radar,enabled:false},defaultSettings,testContext)).toEqual([]);
    expect(radarMatches(testHappenings,{...radar,radiusMiles:1},defaultSettings,testContext)).toEqual([]);
    const second=sample({id:'second-metal',relevance:metal.relevance+1});
    expect(radarMatches([metal,second],{...radar,query:'metal concerts'},defaultSettings,testContext).map(h=>h.id)).toEqual(['second-metal','metal-foundry']);
  });

  it('uses the chosen location and real clock', () => {
    const settings = { ...defaultSettings,demoMode:false,location:{ name:'Seattle',latitude:47.6062,longitude:-122.3321,timezone:'America/Los_Angeles' } };
    const context = createDisplayContext(settings,'2027-01-15T20:00:00Z');
    expect(context).toMatchObject({ demoMode:false,now:'2027-01-15T20:00:00.000Z',timeZone:'America/Los_Angeles',location:settings.location });
    expect(distance(sample({ latitude:47.6062,longitude:-122.3321 }),context)).toBe(0);
    expect(distance(sample(testCenter),context)).toBeGreaterThan(1000);
    expect(when(sample({ startTime:'2027-01-16T03:30:00Z' }),context)).toBe('Fri, Jan 15 · 7:30 PM');
    const morning = sample({ startTime:'2027-01-15T17:00:00Z',endTime:'2027-01-15T18:00:00Z' });
    expect(inTime(morning,'Today',context)).toBe(true);
    expect(inTime(morning,'Tonight',context)).toBe(false);
  });

  it('shows missing metadata honestly and keeps undated text search discoverable', () => {
    const unknown = sample({ latitude:null,longitude:null,startTime:null,endTime:null,geometry:null,geometryType:null,isDemo:false });
    expect(distance(unknown,testContext)).toBeNull();
    expect(distanceLabel(unknown,testContext)).toBe('Distance unavailable');
    expect(when(unknown,testContext)).toBe('Time not provided');
    expect(inTime(unknown,'Now',testContext)).toBe(false);
    expect(searchMatch(unknown,'metal concerts',testContext)).toBe(true);
    expect(searchMatch(unknown,'metal concerts within 50 miles',testContext)).toBe(false);
    expect(distance(metal)).toBeNull();
  });

  it('uses local calendar boundaries across daylight saving changes', () => {
    const settings = { ...defaultSettings,demoMode:false,location:{ name:'New York',latitude:40.7128,longitude:-74.006,timezone:'America/New_York' } };
    const context = createDisplayContext(settings,'2026-11-01T05:30:00Z');
    const lateSunday = sample({ startTime:'2026-11-02T04:30:00Z',endTime:'2026-11-02T04:45:00Z' });
    expect(inTime(lateSunday,'Tonight',context)).toBe(true);
    expect(inTime(lateSunday,'Tomorrow',context)).toBe(false);
    const monday = sample({ startTime:'2026-11-02T05:00:00Z',endTime:'2026-11-02T06:00:00Z' });
    expect(inTime(monday,'Tonight',context)).toBe(false);
    expect(inTime(monday,'Tomorrow',context)).toBe(true);
  });
});
