import type { ExtractionResult } from '../parsers/contracts';
import { parseFeed } from '../parsers/rss';
import { parseCalendar } from '../parsers/ical';
import { parseJsonLd, parseJsonLdValue } from '../parsers/jsonld';
import { parsePublicJson } from '../parsers/json';
import { parseHtml } from '../parsers/html';
export type { ExtractedRecord, ExtractionResult, DiscoveredLink } from '../parsers/contracts';

export function extract(body: string, url: string, contentType: string, now: string, timezone: string): ExtractionResult {
  if (body.length > 5_000_000) throw new Error('Document exceeds extraction size limit');
  if (/BEGIN:VCALENDAR/i.test(body.slice(0, 500)) || /text\/calendar/i.test(contentType)) return { records: parseCalendar(body, url, now, timezone), discoveredLinks: [], parserType: 'ical' };
  if (/<(?:rss|feed|rdf:RDF)\b/i.test(body.slice(0, 2000)) || /(?:rss|atom)\+xml/i.test(contentType)) return { records: parseFeed(body, url, timezone), discoveredLinks: [], parserType: 'rss' };
  if (/\bjson\b/i.test(contentType) || /^[\s]*[\[{]/.test(body)) {
    const structured = parseJsonLdValue(JSON.parse(body), url, timezone);
    return { records: structured.length ? structured : parsePublicJson(body, url, timezone), discoveredLinks: [], parserType: structured.length ? 'jsonld' : 'json' };
  }
  const structured = parseJsonLd(body, url, timezone); const html = parseHtml(body, url, timezone);
  return { records: structured.length ? structured : html.records, discoveredLinks: html.discoveredLinks, parserType: structured.length ? 'jsonld' : 'html' };
}
