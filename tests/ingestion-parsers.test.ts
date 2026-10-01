import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extract } from '../src/backend/extraction';
import { normalizeRecord, normalizeRecords } from '../src/backend/normalization';
import { timestamp } from '../src/backend/parsers/common';
import { sourceSchema, type Location } from '../src/shared/models';

const now = '2026-09-30T16:00:00.000Z';
const timezone = 'America/New_York';
const location: Location = { name: 'Indianapolis', latitude: 39.7684, longitude: -86.1581, timezone, key: 'us-indianapolis' };
const source = sourceSchema.parse({ sourceId: 'city-source', name: 'Original City Announcements', url: 'https://city.example/events', domain: 'city.example', type: 'OFFICIAL', region: 'Indianapolis', parserType: 'html', reliability: 90, failureCount: 0, lastChecked: null, lastSuccessful: null, checkFrequency: 3600, isDemo: false, locationKey: location.key });
const fixture = (name: string) => readFileSync(new URL(`./fixtures/ingestion/${name}`, import.meta.url), 'utf8');

describe('public-source extraction', () => {
  it('rejects navigation pages with CMS publication metadata without rejecting dated events', () => {
    const page={title:'Home',summary:'',sourceUrl:source.url,publishedAt:now};
    expect(normalizeRecord(page,source,location,now)).toBeNull();
    expect(normalizeRecord({...page,startTime:now},source,location,now)?.title).toBe('Home');
  });
  it('extracts explicit dates from single-event pages while refusing incomplete years', () => {
    const body='<html><head><meta property="og:site_name" content="Public Arena"></head><body><h3>Evening performance</h3><div>Saturday, October 3, 2026</div><h3>8:00 PM</h3></body></html>';
    const result=extract(body,'https://venue.example/event/performance/','text/html',now,'America/Chicago');
    expect(result.records[0].startTime).toBe('2026-10-04T01:00:00.000Z');
    expect(result.records[0].locationName).toBe('Public Arena');
    expect(extract(body.replace(', 2026',''),'https://venue.example/event/performance/','text/html',now,timezone).records).toEqual([]);
  });
  it('discovers real published subscription text and parses its saved ICS and public JSON counterparts', () => {
    const publisherUrl = 'https://www.shoreline.edu/calendars/mobile-devices.aspx';
    const calendarUrl = 'https://www.trumba.com/calendars/sccevents.ics';
    const jsonUrl = 'https://www.trumba.com/calendars/sccevents.json';
    const zone = 'America/Los_Angeles';
    const publisher = extract(fixture('shoreline-calendar-publisher-live.html'), publisherUrl, 'text/html', now, zone);
    expect(publisher.records).toEqual([]);
    expect(publisher.discoveredLinks).toEqual(expect.arrayContaining([expect.objectContaining({ url: calendarUrl, parserType: 'ical' }), expect.objectContaining({ url: jsonUrl, parserType: 'json' })]));
    const calendar = extract(fixture('shoreline-calendar-live.ics'), calendarUrl, 'text/calendar', now, zone);
    const json = extract(fixture('shoreline-calendar-live.json'), jsonUrl, 'application/json', now, zone);
    expect(calendar.records).toHaveLength(1); expect(json.records).toHaveLength(1);
    for (const record of [calendar.records[0], json.records[0]]) expect(record).toMatchObject({ title: 'Fall 2026 Welcome Week', startTime: '2026-09-23T16:00:00.000Z', endTime: '2026-09-30T22:00:00.000Z', allDay: false, locationName: 'Maple Student Center, QDR, Cedar, Alder Residence Hall, and yehaw.' });
    expect(json.records[0].sourceUrl).toBe('https://www.shoreline.edu/calendars/events.aspx?trumbaEmbed=view%3Devent%26eventid%3D209437381');
    expect(json.records[0].rawMetadata?.uid).toBe('209437381');
    const seattle = { name: 'Seattle', latitude: 47.6062, longitude: -122.3321, timezone: zone, key: 'seattle' };
    const live = normalizeRecords(json.records, { ...source, sourceId: 'shoreline-calendar', name: 'Shoreline Community College calendar', url: jsonUrl, domain: 'www.trumba.com', region: 'Shoreline, Washington', type: 'ORGANIZATION', locationKey: seattle.key }, seattle, now);
    expect(live[0]).toMatchObject({ sourceId: 'shoreline-calendar', isDemo: false, latitude: null, longitude: null, sourceUrl: json.records[0].sourceUrl, startTime: '2026-09-23T16:00:00.000Z' });
    expect(live[0].summary.length).toBeLessThanOrEqual(240);
    const athletics = extract('<a href="/calendars/athletics.aspx">Athletics</a><a href="webcal://calendar.example/public.ics">Calendar subscription</a>', publisherUrl, 'text/html', now, zone);
    expect(athletics.discoveredLinks).toEqual(expect.arrayContaining([expect.objectContaining({ url: 'https://www.shoreline.edu/calendars/athletics.aspx', parserType: 'html' }), expect.objectContaining({ url: 'https://calendar.example/public.ics', parserType: 'ical' })]));
  });
  it('parses saved real library RSS and venue JSON-LD excerpts with their original attribution', () => {
    const feed = extract(fixture('hamilton-east-library-live.xml'), 'https://hamiltoneastpl.org/feed/', 'application/rss+xml', now, timezone);
    expect(feed.records).toHaveLength(1);
    expect(feed.records[0]).toMatchObject({ title: 'OverDrive PIN Requirement', sourceUrl: 'https://hamiltoneastpl.org/overdrive-pin-requirement/', publishedAt: '2026-09-28T11:00:58.000Z' });
    expect(feed.records[0].summary.length).toBeLessThanOrEqual(240);
    const url = 'https://fisherseventcenter.com/event/gavin-adcock%3a-the-day-i-hang-it-up-tour-2026/13/';
    const venue = extract(fixture('fishers-event-center-live.html'), url, 'text/html', now, timezone);
    expect(venue.records).toHaveLength(1);
    expect(venue.records[0]).toMatchObject({ sourceUrl: url, title: 'Gavin Adcock: The Day I Hang It Up Tour 2026', startTime: '2026-10-22T04:00:00.000Z', allDay: true, latitude: 39.9475562, longitude: -86.0039439, locationName: 'Fishers Event Center', address: '11000 Stockdale Street, Fishers IN 46037, IN' });
    const live = normalizeRecord(venue.records[0], { ...source, name: 'Fishers Event Center', type: 'ORGANIZATION' }, location, now)!;
    expect(live.category).toBe('music'); expect(live.isDemo).toBe(false); expect(live.sourceType).toBe('ORGANIZATION');
  });
  it('reads RSS and Atom attribution, publication dates, and only short plain-text summaries', () => {
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Council &amp; residents</title><link>https://city.example/notices/council</link><pubDate>Wed, 30 Sep 2026 09:00:00 -0400</pubDate><description><![CDATA[<p>A public meeting notice.</p><script>unsafe()</script>]]></description></item></channel></rss>`;
    const result = extract(rss, source.url, 'application/rss+xml', now, timezone);
    expect(result.records[0]).toMatchObject({ title: 'Council & residents', sourceUrl: 'https://city.example/notices/council', summary: 'A public meeting notice.', publishedAt: '2026-09-30T13:00:00.000Z' });
    expect(result.records[0].startTime).toBeUndefined();
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Park cleanup</title><link rel="self" href="https://city.example/api/1"/><link rel="alternate" href="/news/cleanup"/><updated>2026-09-30T10:00:00-04:00</updated><summary>Residents are invited to help maintain the park.</summary><category term="volunteer"/></entry></feed>`;
    expect(extract(atom, source.url, 'application/atom+xml', now, timezone).records[0]).toMatchObject({ sourceUrl: 'https://city.example/news/cleanup', tags: ['volunteer'], publishedAt: '2026-09-30T14:00:00.000Z' });
  });

  it('handles nested JSON-LD events, news, and government announcements despite another broken script', () => {
    const result = extract(fixture('structured-events.html'), source.url, 'text/html', now, timezone);
    expect(result.parserType).toBe('jsonld'); expect(result.records).toHaveLength(3);
    expect(result.records[0]).toMatchObject({ title: 'Heavy music showcase', startTime: '2026-10-03T00:00:00.000Z', geometry: { type: 'Point', coordinates: [-86.15, 39.76] }, address: '10 Main Street, Indianapolis, IN' });
    expect(result.records[1]).toMatchObject({ sourceUrl: 'https://news.example/library-workshops', publishedAt: '2026-09-30T12:00:00.000Z' });
    expect(result.records[1].startTime).toBeUndefined();
    expect(result.records[2].category).toBe('government');
    const json = { '@context': 'https://schema.org', '@graph': [{ '@type': 'Event', name: 'Public workshop', url: 'https://city.example/workshop', startDate: '2026-10-01T18:00:00-04:00' }] };
    expect(extract(JSON.stringify(json), source.url, 'application/ld+json', now, timezone)).toMatchObject({ parserType: 'jsonld', records: [expect.objectContaining({ title: 'Public workshop', startTime: '2026-10-01T22:00:00.000Z' })] });
  });

  it('extracts semantic static cards and discovers feeds without manufacturing navigation events', () => {
    const result = extract(fixture('semantic-events.html'), source.url, 'text/html', now, timezone);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({ sourceUrl: 'https://city.example/events/makers-night', startTime: '2026-10-03T22:30:00.000Z', locationName: 'Central Public Library' });
    expect(result.records[1].startTime).toBeUndefined();
    expect(result.discoveredLinks).toEqual(expect.arrayContaining([expect.objectContaining({ url: 'https://city.example/feed.xml', parserType: 'rss' }), expect.objectContaining({ url: 'https://city.example/events.ics', parserType: 'ical' })]));
    expect(extract('<main><h1>Welcome to our city</h1><p>Read about services and departments.</p><a href="/events">Calendar</a></main>', source.url, 'text/html', now, timezone).records).toEqual([]);
    const textDate = '<article class="event-card"><h2><a href="/event/talk">Neighborhood talk</a></h2><span class="event-date">October 3, 2026 at 7pm</span><p>A discussion with neighbors at the community center.</p></article>';
    expect(extract(textDate, source.url, 'text/html', now, timezone).records[0].startTime).toBe('2026-10-03T23:00:00.000Z');
    const noise = '<link rel="alternate" type="application/rss+xml" title="Comments Feed" href="/comments/feed/"><article><h2>Related posts:</h2><p>Links to more stories and promotional articles appear below.</p></article><article><h2><a href="https://advertiser.example/business">Sponsored checking account</a></h2><time datetime="2026-09-30"></time><p>Open a new account with our external banking advertiser.</p></article><article><header><h2><a href="/news/library">Library publishes a workshop schedule</a></h2></header><time datetime="2026-09-30"></time><p>The public library has published its autumn workshop schedule.</p></article>';
    const filtered = extract(noise, source.url, 'text/html', now, timezone);
    expect(filtered.records.map(item => item.title)).toEqual(['Library publishes a workshop schedule']);
    expect(filtered.discoveredLinks.some(link => /advertiser|comments/.test(link.url))).toBe(false);
  });

  it('expands calendar recurrences with exclusions, exclusive all-day ends, and local DST within 30 days', () => {
    const calendar = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:weekly-library', 'SUMMARY:Library meetup', 'DTSTART;TZID=America/New_York:20261031T100000', 'DTEND;TZID=America/New_York:20261031T110000', 'RRULE:FREQ=WEEKLY;COUNT=10', 'EXDATE;TZID=America/New_York:20261114T100000', 'URL:https://library.example/meetup', 'END:VEVENT', 'BEGIN:VEVENT', 'UID:all-day', 'SUMMARY:Community day', 'DTSTART;VALUE=DATE:20261031', 'DTEND;VALUE=DATE:20261101', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const result = extract(calendar, 'https://library.example/calendar.ics', 'text/calendar', '2026-10-30T12:00:00.000Z', timezone);
    const weekly = result.records.filter(item => item.title === 'Library meetup');
    expect(weekly.map(item => item.startTime)).toEqual(['2026-10-31T14:00:00.000Z', '2026-11-07T15:00:00.000Z', '2026-11-21T15:00:00.000Z', '2026-11-28T15:00:00.000Z']);
    expect(result.records.find(item => item.title === 'Community day')).toMatchObject({ allDay: true, startTime: '2026-10-31T04:00:00.000Z', endTime: '2026-11-01T04:00:00.000Z' });
  });

  it('retains NWS geometry and unknown geolocation; forecast periods and test/cancel alerts stay excluded', () => {
    const geometries = [{ type: 'Point', coordinates: [-86, 39] }, { type: 'LineString', coordinates: [[-86, 39], [-86.1, 39.1]] }, { type: 'Polygon', coordinates: [[[-86, 39], [-85, 39], [-85, 40], [-86, 39]]] }, null];
    const features = geometries.map((geometry, i) => ({ id: `https://api.weather.gov/alerts/${i}`, type: 'Feature', geometry, properties: { event: 'Flood Warning', headline: 'Flood warning for county', severity: 'Severe', status: 'Actual', messageType: 'Alert', description: 'Avoid flooded roads.', areaDesc: 'County region', sent: now, onset: now, expires: '2026-10-01T16:00:00Z' } }));
    const result = extract(JSON.stringify({ type: 'FeatureCollection', features }), 'https://api.weather.gov/alerts/active', 'application/geo+json', now, timezone);
    expect(result.records.map(item => item.geometry?.type ?? null)).toEqual(['Point', 'LineString', 'Polygon', null]);
    expect(result.records[3].latitude).toBeUndefined(); expect(result.records.every(item => item.category === 'weather')).toBe(true);
    expect(extract(JSON.stringify({ properties: { periods: [{ name: 'Tonight', detailedForecast: 'Cloudy' }] } }), source.url, 'application/json', now, timezone).records).toEqual([]);
    expect(extract(JSON.stringify({ features: [{ ...features[0], properties: { ...features[0].properties, status: 'Test' } }] }), source.url, 'application/json', now, timezone).records).toEqual([]);
  });

  it('preserves explicit calendar street addresses and canceled recurrence status', () => {
    const calendar = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:weekly', 'SUMMARY:Neighborhood meetup', 'DTSTART;TZID=America/New_York:20261003T100000', 'DTEND;TZID=America/New_York:20261003T110000', 'RRULE:FREQ=WEEKLY;COUNT=3', 'LOCATION:Community Hall\\, 123 Main Street\\, Indianapolis', 'END:VEVENT', 'BEGIN:VEVENT', 'UID:weekly', 'RECURRENCE-ID;TZID=America/New_York:20261010T100000', 'DTSTART;TZID=America/New_York:20261010T100000', 'DTEND;TZID=America/New_York:20261010T110000', 'STATUS:CANCELLED', 'SUMMARY:Canceled meetup', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const records = extract(calendar, 'https://city.example/events.ics', 'text/calendar', now, timezone).records;
    expect(records.map(item => item.startTime)).toEqual(['2026-10-03T14:00:00.000Z', '2026-10-10T14:00:00.000Z', '2026-10-17T14:00:00.000Z']);
    expect(records[1].rawMetadata?.status).toBe('CANCELLED');
    expect(records[0].address).toBe('Community Hall, 123 Main Street, Indianapolis');
    expect(records[0].latitude).toBeUndefined();
  });

  it('rejects malformed feeds, unsafe links, incomplete dates and excessive input', () => {
    expect(() => extract('<rss><channel>', source.url, 'application/rss+xml', now, timezone)).toThrow('Invalid RSS/Atom XML');
    expect(timestamp('2026', timezone)).toBeUndefined();
    expect(timestamp('not a date', timezone)).toBeUndefined();
    expect(timestamp('October 3 at 7pm', timezone)).toBeUndefined();
    expect(() => extract('x'.repeat(5_000_001), source.url, 'text/html', now, timezone)).toThrow('size limit');
    expect(extract('<rss><channel><item><title>Unsafe</title><link>javascript:alert(1)</link></item></channel></rss>', source.url, 'application/rss+xml', now, timezone).records).toEqual([]);
  });
});

describe('honest live normalization', () => {
  it('preserves original attribution, unknown coordinates and unknown event dates for news', () => {
    const item = normalizeRecord({ sourceUrl: 'https://news.example/article', title: '<b>Library announces workshops</b>', summary: '<p>' + 'A short description. '.repeat(80) + '</p><script>unsafe()</script>', publishedAt: now }, { ...source, type: 'NEWS' }, location, now)!;
    expect(item).toMatchObject({ sourceId: source.sourceId, sourceName: source.name, sourceType: 'NEWS', sourceUrl: 'https://news.example/article', originalUrl: 'https://news.example/article', startTime: null, endTime: null, latitude: null, longitude: null, geometry: null, geometryType: null, isDemo: false, locationAccuracy: 'unknown', locationName: 'Location not provided', discoveredAt: now, lastVerifiedAt: now });
    expect(item.summary.length).toBeLessThanOrEqual(240); expect(item.detailedSummary).toBe(item.summary);
    expect(item.summary).not.toContain('<'); expect(item.title).toBe('Library announces workshops');
  });

  it('uses stable per-occurrence IDs, validates source HTTPS, and never infers confirmation', () => {
    const record = { sourceUrl: 'https://venue.example/event', title: 'Metal concert', summary: 'A local metal show.', startTime: '2026-10-03T20:00:00-04:00', endTime: '2026-10-03T21:00:00-04:00', latitude: 39.76, longitude: -86.15 };
    const item = normalizeRecord(record, { ...source, type: 'CONFIRMED' }, location, now)!;
    expect(item.category).toBe('music'); expect(item.sourceType).toBe('ORGANIZATION'); expect(item.confidence).toBeLessThanOrEqual(75);
    expect(item.geometry).toEqual({ type: 'Point', coordinates: [-86.15, 39.76] });
    expect(normalizeRecord(record, source, location, '2026-10-01T16:00:00.000Z')?.id).toBe(item.id);
    const announcement = { ...record, startTime: undefined, endTime: undefined };
    expect(normalizeRecord({ ...announcement, title: 'Updated concert announcement' }, source, location, now)?.id).toBe(normalizeRecord(announcement, source, location, now)?.id);
    expect(normalizeRecord({ ...record, startTime: '2026-10-04T20:00:00-04:00' }, source, location, now)?.id).not.toBe(item.id);
    expect(normalizeRecord({ ...record, sourceUrl: 'http://venue.example/event' }, source, location, now)).toBeNull();
    expect(normalizeRecord({ ...record, latitude: 999, longitude: 999 }, source, location, now)).toMatchObject({ latitude: null, longitude: null, geometry: null });
    expect(normalizeRecord({ ...record, endTime: '2026-10-01T20:00:00Z' }, source, location, now)?.endTime).toBeNull();
  });

  it('normalizes all saved semantic records without turning publication time into event time', () => {
    const records = extract(fixture('structured-events.html'), source.url, 'text/html', now, timezone).records;
    const items = normalizeRecords(records, source, location, now);
    expect(items).toHaveLength(3); expect(items[1].startTime).toBeNull(); expect(items[1].publishedAt).toBe('2026-09-30T12:00:00.000Z');
    expect(normalizeRecord({ sourceUrl: 'https://city.example/workshop', title: 'Weekend workshop', summary: '', startTime: '2026-10-03T18:00:00-04:00' }, source, location, now)?.category).toBe('events');
    expect(normalizeRecord({ sourceUrl: 'https://city.example/emergency', title: 'Public safety preparedness notice', summary: '' }, source, location, now)?.category).toBe('public_safety');
  });
});
