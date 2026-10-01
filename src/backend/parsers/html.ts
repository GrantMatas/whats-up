import { load } from 'cheerio';
import type { DiscoveredLink, ExtractedRecord } from './contracts';
import { number, plainText, publicUrl, timestamp, imageUrls } from './common';

export function parseHtml(body: string, url: string, timezone: string): { records: ExtractedRecord[]; discoveredLinks: DiscoveredLink[] } {
  const $ = load(body); const links = new Map<string, DiscoveredLink>();
  const host = new URL(url).hostname.replace(/^www\./, '');
  const samePublisher = (link: string) => new URL(link).hostname.replace(/^www\./, '') === host;
  const feedType = (pathname: string, type = '') => /(?:rss|atom)\+xml/i.test(type) || /(?:^|\/)(?:rss|feed|feeds)(?:\/|$)|\.(?:rss|atom|xml)$/i.test(pathname) ? 'rss' : /text\/calendar/i.test(type) || /\.ics$/i.test(pathname) ? 'ical' : /\.json$/i.test(pathname) ? 'json' : 'html';
  const addLink = (link: DiscoveredLink) => {
    links.set(link.url, link);
    // Trumba documents JSON as another public feed of a published calendar.
    const parsed = new URL(link.url);
    if (link.parserType === 'ical' && /^(?:www\.)?trumba\.com$/i.test(parsed.hostname) && /^\/(?:calendars|service)\/[\w-]+\.ics$/i.test(parsed.pathname)) {
      parsed.pathname = parsed.pathname.replace(/\.ics$/i, '.json');
      links.set(parsed.href, { url: parsed.href, parserType: 'json', name: 'Published calendar: Trumba public JSON feed' });
    }
  };
  $('link[rel="alternate"],a[href]').each((_, element) => {
    const node = $(element); const link = publicUrl(node.attr('href')?.replace(/^webcal:/i, 'https:'), url); if (!link || link === publicUrl(url)) return;
    if (/\/(?:comments?|author|tag)(?:\/|$)|replytocom=/i.test(link) || /comments?\s*(?:feed|counts?)/i.test(node.attr('title') ?? node.text())) return;
    const type = node.attr('type') ?? ''; const label = plainText(node.attr('title') ?? node.text(), 200);
    const pathname = new URL(link).pathname;
    const parserType = feedType(pathname, type);
    const contentLink = node.closest('article,[itemtype*="Event"],[itemtype*="Article"],.event-card,.event-item,.announcement').length > 0;
    const externalCalendar = /\/(?:events?|calendars?)(?:\/|$)/i.test(pathname) && /programs?\s*(?:&|and)?\s*events?|all\s+events|calendar/i.test(label);
    if ((parserType !== 'html' || contentLink || /\/(?:events?|calendars?|news|announcements?|meetings?)(?:\/|$)/i.test(pathname)) && (parserType !== 'html' || samePublisher(link) || externalCalendar)) addLink({ url: link, parserType, name: label || pathname });
  });
  // Some publishers print subscription URLs as text instead of anchors.
  const visible = $('body').clone(); visible.find('script,style,nav,footer,aside').remove();
  for (const match of visible.text().matchAll(/\b(?:https:\/\/|webcal:\/\/|www\.)[^\s<>"']+?\.(?:ics|rss|atom|xml|json)(?:\?[^\s<>"']*)?/gi)) {
    const advertised = match[0].replace(/^webcal:/i, 'https:').replace(/^www\./i, 'https://www.');
    const link = publicUrl(advertised, url); if (!link || /\/comments?\//i.test(link)) continue;
    const parserType = feedType(new URL(link).pathname);
    if (parserType !== 'html') addLink({ url: link, parserType, name: 'Published calendar/feed subscription' });
  }
  $('script,style,nav,footer,aside,.related-posts,.related-post,.related-articles,.advertisement,.advert,.ad-container,.widget,.sidebar,.comments,[id="comments"]').remove();
  const records: ExtractedRecord[] = [];
  $('article,[itemtype*="Event"],[itemtype*="Article"],.event-card,.event-item,.announcement').each((_, element) => {
    const node = $(element);
    // Outer wrappers containing other semantic cards are containers, not records.
    if (node.find('article,.event-card,.event-item,.announcement').length) return;
    const heading = node.find('[itemprop="name"],[itemprop="headline"],h1,h2,h3').first();
    const title = plainText(heading.attr('content') ?? heading.text(), 400);
    if (/^(?:related\s+(?:posts?|articles?|stories)|recent\s+posts?|latest\s+(?:news|posts)|advertisement|sponsored|comments?|leave\s+a\s+(?:reply|comment)|sign\s+up|share\s+this|read\s+more|more\s+(?:stories|news))\s*[:!]?$/i.test(title)) return;
    const link = heading.find('a[href]').first().attr('href') ?? heading.closest('a[href]').attr('href') ?? node.find('a[itemprop="url"]').first().attr('href');
    const sourceUrl = publicUrl(link, url) ?? publicUrl(url);
    if (!sourceUrl || !samePublisher(sourceUrl) || (link && !publicUrl(link, url))) return;
    const dateNode = node.find('[itemprop="startDate"],time,.event-date,.date').first();
    const dateText = dateNode.attr('content') ?? dateNode.attr('datetime') ?? dateNode.text();
    const date = timestamp(dateText, timezone);
    const summary = plainText(node.find('[itemprop="description"],.summary,.excerpt,p').first().text());
    if (!title || (!date && summary.length < 30) || (!link && !date && heading.prop('tagName') !== 'H1')) return;
    const isEvent = /event/i.test(node.attr('itemtype') ?? node.attr('class') ?? '') || node.find('[itemprop="startDate"]').length > 0;
    const endNode = node.find('[itemprop="endDate"]').first();
    const latNode = node.find('[itemprop="latitude"]').first(); const lngNode = node.find('[itemprop="longitude"]').first();
    const latitude = number(latNode.attr('content') ?? latNode.text()); const longitude = number(lngNode.attr('content') ?? lngNode.text());
    const imageSelector=isEvent?'[itemprop="image"],.event-image img,img':'[itemprop="image"]';
    const pageImages=heading.prop('tagName')==='H1'&&sourceUrl===publicUrl(url)?imageUrls($('meta[property="og:image"],meta[name="twitter:image"]').map((_,image)=>$(image).attr('content')).get(),url):[];
    const images=pageImages.length?pageImages:imageUrls(node.find(imageSelector).toArray().slice(0,4).map(image=>$(image).attr('content')||$(image).attr('data-src')||$(image).attr('src')),url);
    records.push({ sourceUrl, title, summary, images, startTime: isEvent ? date : undefined, endTime: isEvent ? timestamp(endNode.attr('content') ?? endNode.attr('datetime') ?? endNode.text(), timezone) : undefined,
      publishedAt: isEvent ? undefined : date, timezone, latitude, longitude, allDay: isEvent && /^\d{4}-\d{2}-\d{2}$/.test(dateText.trim()),
      geometry: latitude !== undefined && longitude !== undefined ? { type: 'Point', coordinates: [longitude, latitude] } : undefined,
      locationName: plainText(node.find('[itemprop="location"],.location,.venue').first().text(), 400) || undefined,
      address: plainText(node.find('[itemprop="address"],.address').first().text(), 500) || undefined, rawMetadata: { format: 'html', semanticRegion: element.tagName, kind: isEvent ? 'event' : 'article' } });
  });
  // A standalone announcement may use main rather than article; require its explicit publication metadata.
  if (!records.length) {
    const published = timestamp($('meta[property="article:published_time"]').attr('content') ?? $('main time[datetime]').first().attr('datetime'), timezone);
    const title = plainText($('main h1').first().text(), 400);
    if (published && title) records.push({ sourceUrl: publicUrl($('link[rel="canonical"]').attr('href'), url) ?? url, title, summary: plainText($('main p').first().text()), publishedAt: published, rawMetadata: { format: 'html', kind: 'article' } });
  }
  // Some public venue builders use plain headings instead of semantic event cards.
  // Require a single-event URL and one explicit complete date; never infer its year.
  if (!records.length && /\/(?:events?|shows?)\/[^/]+\/?$/.test(new URL(url).pathname)) {
    const readable=$('body').clone();readable.find('h1,h2,h3,h4,div,p,span,li,br').append(' ');
    const content=plainText(readable.text(),12000);
    const dates=[...content.matchAll(/\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*|\s+)\d{4})\b/g)].map(m=>m[1]);
    const unique=[...new Set(dates)];
    const title=plainText($('h1,h2,h3').first().text(),400);
    const clock=content.match(/\b\d{1,2}:\d{2}\s*[AP]M\b/i)?.[0];
    const date=unique.length===1?timestamp(unique[0]+(clock?' '+clock:''),timezone):undefined;
    if(title && date && !/upcoming|newsletter|contact|subscribe/i.test(title)) {
      const address=content.match(/\b\d{1,6}\s+[^,\n]{2,65}?\b(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Lane|Ln|Parkway|Pkwy)\b/i)?.[0];
      const venue=plainText($('meta[property="og:site_name"]').attr('content'),400)||undefined;
      records.push({title,sourceUrl:url,startTime:date,timezone,allDay:!clock,locationName:venue,address,summary:plainText($('meta[property="og:description"],meta[name="description"]').first().attr('content')),rawMetadata:{format:'html',kind:'event',extraction:'explicit single-event page date'}});
    }
  }
  if(records.length===1&&publicUrl(records[0].sourceUrl)===publicUrl(url)&&!records[0].images?.length)records[0].images=imageUrls($('meta[property="og:image"],meta[name="twitter:image"]').map((_,node)=>$(node).attr('content')).get(),url);
  return { records, discoveredLinks: [...links.values()].slice(0, 100) };
}
