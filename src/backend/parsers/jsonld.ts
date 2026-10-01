import { load } from 'cheerio';
import type { ExtractedRecord } from './contracts';
import { list, number, plainText, publicUrl, timestamp, imageUrls } from './common';

export function parseJsonLd(body: string, url: string, timezone: string): ExtractedRecord[] {
  const $ = load(body); const values: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, element) => { try { values.push(JSON.parse($(element).text())); } catch { /* An invalid script must not suppress other valid blocks. */ } });
  return parseJsonLdValue(values, url, timezone);
}
export function parseJsonLdValue(input: unknown, url: string, timezone: string): ExtractedRecord[] {
  const nodes: Record<string, any>[] = [];
  const walk = (value: unknown, depth = 0) => {
    if (depth > 20 || !value || typeof value !== 'object' || nodes.length >= 2000) return;
    if (Array.isArray(value)) { value.forEach(item => walk(item, depth + 1)); return; }
    const object = value as Record<string, any>;
    if (object['@type']) nodes.push(object);
    Object.values(object).forEach(item => walk(item, depth + 1));
  };
  walk(input);
  return nodes.flatMap(node => {
    const types = list<string>(node['@type']).map(type => type.split(/[\/#]/).at(-1));
    const event = types.some(type => type?.endsWith('Event'));
    const article = types.some(type => ['NewsArticle', 'Article', 'GovernmentAnnouncement', 'SpecialAnnouncement'].includes(type ?? ''));
    if (!event && !article) return [];
    const title = plainText(node.name ?? node.headline, 400);
    const sourceUrl = publicUrl(node.url ?? node.mainEntityOfPage?.['@id'] ?? node.mainEntityOfPage ?? node['@id'], url) ?? publicUrl(url);
    if (!title || !sourceUrl) return [];
    const place = typeof node.location === 'object' ? list<Record<string, any>>(node.location)[0] : undefined;
    const geo = place?.geo ?? node.geo;
    const latitude = number(geo?.latitude); const longitude = number(geo?.longitude);
    const address = typeof place?.address === 'string' ? place.address : place?.address ? [place.address.streetAddress, place.address.addressLocality, place.address.addressRegion, place.address.postalCode].filter(Boolean).join(', ') : undefined;
    const record: ExtractedRecord = { sourceUrl, title, summary: plainText(node.description ?? node.abstract), images:imageUrls(node.image,url),
      startTime: event ? timestamp(node.startDate, timezone) : undefined, endTime: event ? timestamp(node.endDate, timezone) : undefined,
      publishedAt: timestamp(node.datePublished ?? node.dateModified, timezone), timezone, latitude, longitude,
      locationName: plainText(place?.name ?? (typeof node.location === 'string' ? node.location : ''), 400) || undefined,
      address: plainText(address, 500) || undefined, allDay: typeof node.startDate === 'string' && /^\d{4}-\d\d-\d\d$/.test(node.startDate),
      tags: [...(typeof node.keywords === 'string' ? node.keywords.split(',').map((tag: string) => plainText(tag, 80)).filter(Boolean) : list<string>(node.keywords).filter(tag => typeof tag === 'string')), ...list<string>(node.genre).filter(genre=>typeof genre==='string'), ...list<Record<string,any>>(node.performer).flatMap(performer=>list<string>(performer?.genre).filter(genre=>typeof genre==='string'))].slice(0,40),
      category: types.includes('GovernmentAnnouncement') ? 'government' : undefined,
      rawMetadata: { format: 'jsonld', types, eventStatus: node.eventStatus, organizer:plainText(typeof node.organizer==='string'?node.organizer:node.organizer?.name,200)||undefined, organizerUrl:publicUrl(node.organizer?.url,url)||undefined,venueUrl:publicUrl(place?.url,url)||undefined,price:node.offers?.price,doorTime:node.doorTime,performers:list<Record<string,any>>(node.performer).map(p=>plainText(p?.name,100)).filter(Boolean).slice(0,10) } };
    if (latitude !== undefined && longitude !== undefined) record.geometry = { type: 'Point', coordinates: [longitude, latitude] };
    return [record];
  });
}
