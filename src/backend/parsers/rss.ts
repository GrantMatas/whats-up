import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { load } from 'cheerio';
import type { ExtractedRecord } from './contracts';
import { list, plainText, publicUrl, timestamp, imageUrls } from './common';

export function parseFeed(body: string, url: string, timezone: string): ExtractedRecord[] {
  if (XMLValidator.validate(body) !== true) throw new Error('Invalid RSS/Atom XML');
  const root = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', processEntities: false }).parse(body);
  const entries = root.rss?.channel?.item ?? root.feed?.entry ?? root['rdf:RDF']?.item;
  return list<Record<string, any>>(entries).flatMap(entry => {
    const atomLink = list<Record<string, any>>(entry.link).find(link => typeof link === 'object' && (!link['@rel'] || link['@rel'] === 'alternate'));
    const sourceUrl = publicUrl(typeof entry.link === 'string' ? entry.link : atomLink?.['@href'], url) ?? publicUrl(entry.guid?.['#text'] ?? entry.guid ?? entry.id, url);
    const title = plainText(typeof entry.title === 'object' ? entry.title?.['#text'] : entry.title, 400);
    if (!sourceUrl || !title) return [];
    const summary = entry.description ?? entry.summary ?? entry['content:encoded'] ?? entry.content;
    const text=typeof summary==='object'?summary?.['#text']:summary;const $=load(typeof text==='string'?text:'');
    const images=imageUrls([...list<Record<string,any>>(entry['media:content']??entry['media:thumbnail']??entry.enclosure).map(image=>image['@url']),...list<Record<string,any>>(entry.link).filter(link=>link['@rel']==='enclosure'&&/^image\//.test(link['@type']||'')).map(link=>link['@href']),...$('img').toArray().slice(0,2).map(image=>$(image).attr('src'))],url);
    return [{ sourceUrl, title, summary: plainText(text), images, publishedAt: timestamp(entry.pubDate ?? entry.published ?? entry.updated ?? entry['dc:date'], timezone),
      tags: list(entry.category).map(category => plainText(typeof category === 'object' ? category['@term'] ?? category['#text'] : category, 80)).filter(Boolean), rawMetadata: { format: root.feed ? 'atom' : 'rss' } }];
  });
}
