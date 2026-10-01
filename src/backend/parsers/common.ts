import { load } from 'cheerio';
import { DateTime } from 'luxon';

export const list = <T>(value: T | T[] | undefined | null): T[] => value == null ? [] : Array.isArray(value) ? value : [value];
export function plainText(value: unknown, limit = 240): string {
  if (typeof value !== 'string') return '';
  let text = value;
  for (let pass = 0; pass < 2; pass++) {
    const $ = load(text, {}, false);
    $('script,style,nav,noscript').remove();
    text = $.root().text();
    if (!/<\/?[a-z][^>]*>/i.test(text)) break;
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, limit);
}
export function publicUrl(value: unknown, base?: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    url.hash = '';
    return url.href;
  } catch { return undefined; }
}
export function imageUrls(value:unknown,base:string):string[]{
  const values=list<unknown>(value as unknown[]).flatMap(item=>typeof item==='string'?[item]:item&&typeof item==='object'?[String((item as Record<string,unknown>).contentUrl||(item as Record<string,unknown>).url||'')]:[]);
  return [...new Set(values.map(item=>publicUrl(item,base)).filter((url):url is string=>!!url&&url.length<=2048&&!/^(localhost|.*\.localhost|127\.|10\.|192\.168\.|\[::)/i.test(new URL(url).hostname)))].slice(0,4);
}
export function timestamp(value: unknown, timezone: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const text = value.trim();
  // Reject vague prose and incomplete dates instead of guessing a year/time.
  let date = /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(text) ? DateTime.fromISO(text, { zone: timezone, setZone: true }) : DateTime.invalid('Incomplete ISO date');
  if (!date.isValid && /\d{4}/.test(text)) date = DateTime.fromRFC2822(text, { zone: timezone });
  if (!date.isValid && /\b\d{4}\b/.test(text)) {
    const normalized = text.replace(/\b(at)\b/gi, '').replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/g, '$1').replace(/(\d)(am|pm)\b/gi, '$1 $2').replace(/\s+/g, ' ').trim();
    for (const format of ['MMMM d, yyyy h:mm a', 'MMMM d, yyyy h a', 'MMM d, yyyy h:mm a', 'MMM d, yyyy h a', 'MMMM d, yyyy HH:mm', 'MMM d, yyyy HH:mm', 'MMMM d, yyyy', 'MMM d, yyyy', 'd MMMM yyyy HH:mm', 'd MMMM yyyy', 'M/d/yyyy h:mm a', 'M/d/yyyy h a', 'M/d/yyyy']) {
      date = DateTime.fromFormat(normalized, format, { zone: timezone, locale: 'en-US' });
      if (date.isValid) break;
    }
  }
  return date.isValid ? date.toUTC().toISO() ?? undefined : undefined;
}
export function addressLike(value: string): boolean {
  return /\b\d{1,6}\s+[^,\n]{1,80}\b(?:street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|way|court|ct|highway|hwy|parkway|pkwy|place|pl)\b/i.test(value);
}
export function number(value: unknown): number | undefined {
  if (value === '' || value == null) return undefined;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
