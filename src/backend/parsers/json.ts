import { geometrySchema, type Category } from '../../shared/models';
import type { ExtractedRecord } from './contracts';
import { addressLike, list, number, plainText, publicUrl, timestamp, imageUrls } from './common';

function offsetDate(value: unknown, offset: unknown): unknown {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value) && typeof offset === 'string' && /^[+-]\d{4}$/.test(offset) ? value + offset.slice(0, 3) + ':' + offset.slice(3) : value;
}

export function parsePublicJson(body: string, url: string, timezone: string): ExtractedRecord[] {
  const root = JSON.parse(body);
  // NWS forecast periods are forecasts, not alerts or newly announced events.
  if (root?.properties?.periods) return [];
  const input = Array.isArray(root) ? root : root.features ?? root.events ?? root.items ?? root.results ?? root.data ?? [root];
  return list<Record<string, any>>(input).slice(0, 1000).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const fields = item.properties ?? item; const alert = Boolean(fields.event && (fields.severity || fields.areaDesc || fields.messageType));
    if (alert&&(fields.canceled === true || fields.cancelled === true)) return [];
    if (alert && (fields.status && fields.status !== 'Actual' || fields.messageType === 'Cancel')) return [];
    const title = plainText(fields.headline ?? fields.title ?? fields.name ?? (alert ? fields.event : undefined), 400);
    const sourceUrl = [fields.url, fields.web, fields.permaLinkUrl, fields.webLink, item.id, fields['@id']].map(value => publicUrl(value, url)).find(Boolean) ?? publicUrl(url);
    if (!title || !sourceUrl) return [];
    const parsedGeometry = geometrySchema.safeParse(item.geometry ?? fields.geometry);
    const geometry = parsedGeometry.success ? parsedGeometry.data : undefined;
    const latitude = geometry?.type === 'Point' ? geometry.coordinates[1] : number(fields.latitude ?? fields.lat ?? fields.location?.latitude);
    const longitude = geometry?.type === 'Point' ? geometry.coordinates[0] : number(fields.longitude ?? fields.lng ?? fields.lon ?? fields.location?.longitude);
    const locationName = plainText(fields.locationName ?? fields.location?.name ?? (typeof fields.location === 'string' ? fields.location : undefined) ?? fields.areaDesc, 400) || undefined;
    return [{ sourceUrl, title, summary: plainText(fields.description ?? fields.summary ?? fields.excerpt), images:imageUrls(fields.images??fields.image??fields.imageUrl??fields.eventImage?.url,url), category: alert ? 'weather' : fields.category as Category | undefined,
      subcategory: alert ? plainText(fields.event, 200) : undefined, startTime: timestamp(offsetDate(fields.startTime ?? fields.startDate ?? fields.startDateTime ?? (alert ? fields.onset ?? fields.effective : undefined), fields.startTimeZoneOffset), timezone),
      endTime: timestamp(offsetDate(fields.endTime ?? fields.endDate ?? fields.endDateTime ?? (alert ? fields.ends ?? fields.expires : undefined), fields.endTimeZoneOffset), timezone), publishedAt: timestamp(fields.publishedAt ?? fields.datePublished ?? fields.sent, timezone),
      locationName, address: plainText(fields.address ?? fields.location?.address ?? (locationName && addressLike(locationName) ? locationName : undefined), 500) || undefined, timezone, latitude, longitude, geometry,
      allDay: typeof fields.allDay === 'boolean' ? fields.allDay : undefined, tags: list<string>(fields.tags).filter(tag => typeof tag === 'string').slice(0, 40),
      rawMetadata: { format: 'json', kind: alert ? 'weather-alert' : 'record', uid: fields.eventID != null ? String(fields.eventID) : undefined, status:fields.canceled===true||fields.cancelled===true?'cancelled':fields.eventStatus||fields.status, severity: fields.severity, certainty: fields.certainty, urgency: fields.urgency, geometryUnavailable: alert && !geometry } }];
  });
}
