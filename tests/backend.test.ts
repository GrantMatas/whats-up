import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDatabase } from '../src/backend/database';
import { testSettings as defaultSettings } from './fixtures/test-records';
import { defaultSettings as emptySettings } from '../src/shared/defaults';
import { testHappenings, testSources, TEST_NOW } from './fixtures/test-records';
import { happeningSchema, settingsSchema, radarSchema, httpsUrlSchema } from '../src/shared/models';
import { parseIntent, matchesIntent } from '../src/backend/search/intent';
import { matchRadar } from '../src/backend/radar/matching';
import { deduplicate } from '../src/backend/deduplication';
import { nextCheck, mayStartJob } from '../src/backend/scheduler/policy';

describe('local database', () => {
  it('round trips onboarding, records, settings, Radars and saved items after reopen', () => {
    const filename = join(mkdtempSync(join(tmpdir(), 'whatsup-test-')), 'local.sqlite');
    let db = new LocalDatabase(filename);
    expect(db.getState().happenings).toHaveLength(0);
    db.saveSettings({ ...defaultSettings, onboarded: true, theme: 'dark' }); db.ingest(testHappenings); db.upsertSources(testSources);
    db.toggleSaved(testHappenings[0].id);
    db.saveRadar({ id: 'metal', name: 'Metal shows', query: 'metal concerts', radiusMiles: 50, enabled: true, createdAt: TEST_NOW });
    db.close(); db = new LocalDatabase(filename);
    expect(db.getState().settings.theme).toBe('dark');
    expect(db.getState().happenings).toHaveLength(20);
    expect(db.getState().savedIds).toEqual([testHappenings[0].id]);
    expect(db.getState().radars[0].name).toBe('Metal shows');
    db.resetData(); db.close(); db = new LocalDatabase(filename);
    expect(db.getState()).toMatchObject({ settings: emptySettings, happenings: [], sources: [], savedIds: [], radars: [] });
    db.close();
  });
  it('rejects fictional records and mode activation without changing stored real data', () => {
    const db=new LocalDatabase(':memory:');db.saveSettings({...defaultSettings,onboarded:true});db.ingest([testHappenings[0]]);
    expect(()=>db.saveSettings({...defaultSettings,onboarded:true,demoMode:true})).toThrow();
    expect(()=>db.ingest([{...testHappenings[0],isDemo:true}])).toThrow();
    expect(db.getState().happenings.map(h=>h.id)).toEqual([testHappenings[0].id]);
    expect(()=>db.toggleSaved('not-an-event')).toThrow('does not exist');db.close();
  });
});
describe('validation boundary', () => {
  it('validates complete fixtures and rejects invalid settings, provenance and geometry', () => {
    testHappenings.forEach(item => expect(happeningSchema.safeParse(item).success).toBe(true));
    expect(settingsSchema.safeParse({ ...defaultSettings, radiusMiles: 0 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...defaultSettings, injected: true }).success).toBe(false);
    expect(happeningSchema.safeParse({ ...testHappenings[0], sourceUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(happeningSchema.safeParse({ ...testHappenings[0], geometryType: 'POLYGON' }).success).toBe(false);
    expect(radarSchema.safeParse({ id: 'bad', name: 'Bad', query: '', radiusMiles: 25, enabled: true, createdAt: TEST_NOW }).success).toBe(false);
    for (const url of ['file:///etc/passwd', 'http://example.org', 'https://user:pass@example.org']) expect(httpsUrlSchema.safeParse(url).success).toBe(false);
  });
});
describe('local discovery foundations', () => {
  it('parses natural language topics, radius, times and announcement filters', () => {
    expect(parseIntent('Find furry meetups within 50 miles this weekend')).toMatchObject({ topics: ['furry', 'meetups'], categories: ['community'], radiusMiles: 50, timeWindow: 'weekend' });
    expect(parseIntent('Show events announced since yesterday').newlyAnnounced).toBe(true);
    const query = parseIntent('Find metal concerts within 50 miles');
    const matches = testHappenings.filter(h => matchesIntent(h, query, defaultSettings.location, 25, TEST_NOW));
    expect(matches.map(h => h.id)).toEqual(['metal-foundry']);
  });
  it('Radar honors enabled state, topic and weekend timing', () => {
    const radar = { id: 'furry', name: 'Furry weekend', query: 'furry meetups this weekend', radiusMiles: 50, enabled: true, createdAt: TEST_NOW };
    expect(matchRadar(radar, testHappenings, defaultSettings, TEST_NOW).map(h => h.id)).toEqual(['furry-social']);
    expect(matchRadar({ ...radar, enabled: false }, testHappenings, defaultSettings, TEST_NOW)).toEqual([]);
  });
  it('deduplicates conservative same-event matches and preserves independent provenance', () => {
    const first = testHappenings[0];
    const second = { ...first, id: 'second', title: first.title.toUpperCase(), sourceName: 'Other sample calendar', sourceUrl: 'https://example.net/other' };
    const result = deduplicate([first, second, testHappenings[1]]);
    expect(result).toHaveLength(2); expect(result[0].relatedSources[0].url).toBe(second.sourceUrl); expect(first.relatedSources).toEqual([]);
  });
  it('backs off failed sources, throttles quiet sources, and caps work', () => {
    const now = Date.parse(TEST_NOW); const source = { ...testSources[0], lastChecked: TEST_NOW };
    expect(nextCheck({ ...source, failureCount: 3 }, now)).toBe(now + source.checkFrequency * 8 * 1000);
    expect(nextCheck(source, now, 8)).toBe(now + source.checkFrequency * 3 * 1000);
    expect(mayStartJob(3, 0, false, false)).toBe(false); expect(mayStartJob(0, 1, false, false)).toBe(false); expect(mayStartJob(0, 0, true, true)).toBe(false); expect(mayStartJob(0, 0, true, false)).toBe(true);
  });
});
