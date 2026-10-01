import { createHash } from 'node:crypto';
import { categories, geometrySchema, happeningSchema, type Category, type Happening, type Location, type Source } from '../../shared/models';
import { distanceMiles } from '../search/intent';
import type { ExtractedRecord } from '../parsers/contracts';
import { number, plainText, publicUrl, timestamp, imageUrls } from '../parsers/common';

const topics: [Category, RegExp][] = [
  ['traffic', /\b(road closure|lane restriction|detour|roadwork|traffic)\b/i], ['weather', /\b(weather|storm|tornado|flood warning|heat advisory)\b/i],
  ['government', /\b(council|ordinance|public meeting|government|city hall)\b/i], ['public_safety', /\b(emergency|evacuation|public safety|preparedness)\b/i],
  ['music', /\b(concert|music|metal|jazz|band|gig)\b/i], ['technology', /\b(technology|cybersecurity|software|hackathon|coding)\b/i],
  ['food', /\b(restaurant|coffee|food|kitchen|farmers market)\b/i], ['sports', /\b(soccer|football|basketball|marathon|running)\b/i],
  ['education', /\b(school|university|college|lecture|classroom)\b/i], ['arts', /\b(art exhibition|gallery|theatre|theater|museum)\b/i],
  ['business', /\b(business|chamber of commerce|commerce|company opening)\b/i], ['community', /\b(furry|meetup|festival|volunteer|community|library)\b/i],
];
export function normalizeRecord(record: ExtractedRecord, source: Source, location: Location, now: string): Happening | null {
  const sourceUrl = publicUrl(record.sourceUrl); const title = plainText(record.title, 400);
  if (!sourceUrl || !title) return null;
  const summary = plainText(record.summary, 240);
  const zone = record.timezone || location.timezone || 'UTC';
  const startTime = timestamp(record.startTime, zone) ?? null; let endTime = timestamp(record.endTime, zone) ?? null;
  if (!startTime && /^(?:home|homepage|calendar|events|upcoming events|news|contact(?: us)?|about(?: us)?|search|our team)$/i.test(title)) return null;
  if (startTime && endTime && Date.parse(endTime) < Date.parse(startTime)) endTime = null;
  const publishedAt = timestamp(record.publishedAt, zone) ?? null;
  const geoResult = geometrySchema.safeParse(record.geometry); let geometry = geoResult.success ? geoResult.data : null;
  const lat = number(record.latitude); const lng = number(record.longitude);
  const latitude = lat !== undefined && Math.abs(lat) <= 90 ? lat : geometry?.type === 'Point' ? geometry.coordinates[1] : null;
  const longitude = lng !== undefined && Math.abs(lng) <= 180 ? lng : geometry?.type === 'Point' ? geometry.coordinates[0] : null;
  if (!geometry && latitude !== null && longitude !== null) geometry = { type: 'Point', coordinates: [longitude, latitude] };
  const corpus = `${title} ${summary} ${(record.tags ?? []).join(' ')}`;
  const category = record.category && categories.includes(record.category) ? record.category : topics.find(([, regex]) => regex.test(corpus))?.[0] ?? (startTime ? 'events' : source.type === 'NEWS' ? 'news' : 'other');
  const sourceType = source.type === 'CONFIRMED' ? 'ORGANIZATION' : source.type;
  const confidence = Math.min(sourceType === 'OFFICIAL' ? 95 : sourceType === 'NEWS' ? 80 : sourceType === 'ORGANIZATION' ? 75 : sourceType === 'COMMUNITY' ? 55 : 40, source.reliability);
  const ageDays = publishedAt ? Math.max(0, (Date.parse(now) - Date.parse(publishedAt)) / 86400000) : null;
  const freshness = ageDays === null ? 40 : Math.max(0, Math.round(100 - ageDays * 10));
  const proximity = latitude !== null && longitude !== null ? Math.max(0, 100 - distanceMiles(location.latitude, location.longitude, latitude, longitude) * 2) : 40;
  const id = 'live-' + createHash('sha256').update(`${sourceUrl}\n${startTime ?? ''}\n${record.rawMetadata?.uid ?? ''}`).digest('hex').slice(0, 24);
  const result = happeningSchema.safeParse({ id, title, summary, detailedSummary: summary, category, subcategory: plainText(record.subcategory, 400) || (record.rawMetadata?.kind === 'weather-alert' ? 'Weather alert' : startTime ? 'Event' : 'Announcement'),
    startTime, endTime, publishedAt, discoveredAt: now, updatedAt: now, lastVerifiedAt: now, latitude, longitude, geometry, geometryType: geometry ? geometry.type.toUpperCase() : null,
    locationName: plainText(record.locationName, 400) || 'Location not provided', address: plainText(record.address, 500),
    sourceId: source.sourceId, sourceName: source.name, sourceType, sourceUrl, originalUrl: sourceUrl, confidence,
    importance: category === 'safety' || category === 'public_safety' || record.rawMetadata?.severity === 'Extreme' ? 85 : category === 'weather' || category === 'traffic' ? 65 : 45,
    freshness, relevance: Math.round(proximity * 0.5 + confidence * 0.3 + freshness * 0.2), images: imageUrls(record.images,sourceUrl),
    tags: [...new Set((record.tags ?? []).map(tag => plainText(tag, 80)).filter(Boolean))].slice(0, 40), relatedSources: [], isDemo: false,
    allDay: record.allDay ?? false, timezone: zone, rawMetadata: record.rawMetadata ?? {}, locationAccuracy: geometry ? geometry.type === 'Point' ? 'exact' : 'region' : 'unknown', locationKey: source.locationKey ?? location.key });
  return result.success ? result.data : null;
}
export function normalizeRecords(records: ExtractedRecord[], source: Source, location: Location, now: string): Happening[] {
  return records.map(record => normalizeRecord(record, source, location, now)).filter((record): record is Happening => record !== null);
}
