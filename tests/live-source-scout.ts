// Opt-in diagnostic: never runs as part of the offline test suite.
import { PublicHttp } from '../src/backend/collectors/http';
import { extract } from '../src/backend/extraction';
import { load } from 'cheerio';

const http = new PublicHttp();
for (const url of process.argv.slice(2)) {
  try {
    const document = await http.request(url);
    const result = document.status === 200 ? extract(document.body, document.url, document.contentType, new Date().toISOString(), 'America/Los_Angeles') : null;
    const $ = load(document.body);
    const calendarLinks = $('a[href],iframe[src]').map((_, node) => ({ url: $(node).attr('href') ?? $(node).attr('src'), title: $(node).text().trim().slice(0, 80) })).get().filter(link => /\.ics|ical|trumba|calendar/i.test(link.url ?? '')).slice(0, 12);
    const raw = /json/.test(document.contentType) ? JSON.parse(document.body) : null;
    const jsonFirst = Array.isArray(raw) ? raw[0] : raw?.events?.[0];
    console.log(JSON.stringify({ url: document.url, status: document.status, parser: result?.parserType, records: result?.records.length, first: result?.records.slice(0, 2).map(record => ({ title: record.title, sourceUrl: record.sourceUrl, startTime: record.startTime, locationName: record.locationName, address: record.address })), links: result?.discoveredLinks.slice(0, 15), calendarLinks, jsonKeys: jsonFirst ? Object.keys(jsonFirst) : undefined, jsonFacts: jsonFirst ? Object.fromEntries(Object.entries(jsonFirst).filter(([key]) => /date|time|url|link|loc|id|fields/i.test(key))) : undefined }));
  } catch (error) { console.log(JSON.stringify({ url, error: error instanceof Error ? error.message : String(error) })); }
}
