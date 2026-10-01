import ICAL from 'ical.js';
import { DateTime } from 'luxon';
import type { ExtractedRecord } from './contracts';
import { addressLike, list, number, plainText, publicUrl, imageUrls } from './common';

export function parseCalendar(body: string, url: string, now: string, timezone: string): ExtractedRecord[] {
  const calendar = new ICAL.Component(ICAL.parse(body));
  if (calendar.name !== 'vcalendar') throw new Error('Expected an iCalendar calendar');
  const components = calendar.getAllSubcomponents('vevent');
  const records: ExtractedRecord[] = [];
  const convert = (time: ICAL.Time, tzid?: string): string | undefined => {
    if (time.zone?.tzid === 'UTC') return time.toJSDate().toISOString();
    if (time.zone?.component) return time.toJSDate().toISOString();
    return DateTime.fromObject({ year: time.year, month: time.month, day: time.day, hour: time.hour, minute: time.minute, second: time.second }, { zone: tzid || timezone }).toUTC().toISO() ?? undefined;
  };
  const from = Date.parse(now); const until = from + 30 * 86400000;
  for (const component of components.slice(0, 1000)) {
    if (!component.hasProperty('dtstart')) continue;
    const event = new ICAL.Event(component);
    if (event.isRecurrenceException()) continue;
    for (const exception of components.filter(other => other.hasProperty('recurrence-id') && other.getFirstPropertyValue('uid') === event.uid)) event.relateException(exception);
    const tzid = component.getFirstProperty('dtstart')?.getParameter('tzid') as string | undefined;
    const append = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time) => {
      const occurrenceTz = item.component.getFirstProperty('dtstart')?.getParameter('tzid') as string | undefined ?? tzid;
      const startTime = convert(start, occurrenceTz); const endTime = convert(end, occurrenceTz);
      if (!startTime || Date.parse(startTime) >= until || Date.parse(endTime ?? startTime) < from) return;
      const title = plainText(item.summary, 400); if (!title) return;
      const sourceUrl = publicUrl(item.component.getFirstPropertyValue('url'), url) ?? publicUrl(url);
      if (!sourceUrl) return;
      const geo = item.component.getFirstPropertyValue('geo') as unknown;
      const coords = Array.isArray(geo) ? geo : typeof geo === 'object' && geo ? [(geo as any).lat, (geo as any).lon] : [];
      const latitude = number(coords[0]); const longitude = number(coords[1]);
      const hasEnd = item.component.hasProperty('dtend') || item.component.hasProperty('duration') || start.isDate;
      const locationName = plainText(item.location, 400) || undefined;
      records.push({ sourceUrl, title, summary: plainText(item.description), images:imageUrls(item.component.getAllProperties('attach').map(property=>property.getFirstValue()),url),startTime, endTime: hasEnd ? endTime : undefined,
        timezone: occurrenceTz || timezone, allDay: start.isDate, locationName, address: locationName && addressLike(locationName) ? locationName : undefined, latitude, longitude,
        geometry: latitude !== undefined && longitude !== undefined ? { type: 'Point', coordinates: [longitude, latitude] } : undefined,
        tags: list(item.component.getFirstPropertyValue('categories') as string | string[]).map(tag => plainText(tag, 80)).filter(Boolean),
        rawMetadata: { format: 'ical', uid: event.uid, recurring: event.isRecurring(), recurrenceId: start.toString(), status:item.component.getFirstPropertyValue('status')||undefined } });
    };
    if (!event.isRecurring()) { append(event, event.startDate, event.endDate); continue; }
    // Bound recurrence work even for hostile or very old secondly rules.
    const iterator = event.iterator();
    for (let count = 0; count < 10000 && records.length < 1000; count++) {
      const occurrence = iterator.next(); if (!occurrence) break;
      const date = convert(occurrence, tzid); if (date && Date.parse(date) >= until) break;
      const detail = event.getOccurrenceDetails(occurrence);
      append(detail.item, detail.startDate, detail.endDate);
    }
  }
  return records.sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
}
