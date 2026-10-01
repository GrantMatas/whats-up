import { createHash } from 'node:crypto';
import type { Location, Source } from '../../shared/models';
import type { WebDiscoveryProvider, DiscoveryQuery, DiscoveryResult } from './provider';
import { PublicHttp } from '../collectors/http';
import { distanceMiles } from '../search/intent';
import { load } from 'cheerio';

const excluded = /(^|\.)(wikipedia\.org|wikimedia\.org|wikimediafoundation\.org|wikidata\.org|toolforge\.org|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|archive\.org|google\.com|census\.gov|geonames\.org|doi\.org|jstor\.org|britannica\.com|worldcat\.org|nytimes\.com|amazon\.com|linkedin\.com|tiktok\.com|nationalmap\.gov|loc\.gov|nih\.gov|nsf\.gov|openlibrary\.org|nps\.gov|weatherbase\.com|noaa\.gov|federalregister\.gov|govinfo\.gov|usgs\.gov|usps\.com|stlouisfed\.org|slideshare\.net|researchgate\.net|semanticscholar\.org|statista\.com|imdb\.com|yelp\.com|tripadvisor\.com|isni\.org|viaf\.org|d-nb\.info|idref\.fr|bnf\.fr|librarything\.com|encyclopedia\.com)$/i;
const archiveHost = /(^|\.)(archive|archives|findingaids|uicarchives|books|tools|catalog|repository|digitalcollections|featuresblogs|blogs|data|infoweb|login|search)\./i;
const metadataHost = /(^|\.)(librarything\.com|newsbank\.com|nwsource\.com|proquest\.com|ebscohost\.com|crossref\.org|issn\.org|vimeo\.com|issuu\.com)$/i;
const useful = /calendar|events?|concert|festival|library|libraries|parks?|theat(?:er|re)|museum|arena|venue|transit|transport|government|public service|chamber|tourism|visitors|community center|visitor bureau/i;
const localNews = /news|journal|times|tribune|star|post|gazette|herald|reporter|current|fox\d|(?:^|\.)[kw][a-z]{3}\./i;
const archivePath = /(?:^|\/)(?:archive|archives|findingaids|history|historical|bibliography|research|citation|doi|geohack)(?:\/|\b)|\.(?:pdf|jpe?g|png|zip|mp4|epub)$/i;
const normalize = (value:string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const hostKey = (url:URL) => url.hostname.toLowerCase().replace(/^www\./,'');
const institution = /library|libraries|museum|arena|stadium|event center|theat(?:er|re)|park|university|college|school|transit|transportation authority|newspaper|festival|convention|center|centre|opera|symphony|county|city council/i;
const broadArticle = /^(?:interstate|u\.?s\.? route|state route|history of|list of|economy of|demographics of)|\b(?:highway|railroad|river|historic district)\b/i;

/** Extract organization sources, rather than turning an article's bibliography into a feed catalog. */
export function directoryLinks(html:string, title:string, pageUrl:string, geographicallyVerified = false):DiscoveryResult[] {
  const $ = load(html); const officialUrls = new Set<string>();
  $('.infobox tr').each((_,row) => {
    if (!/\bwebsite\b/i.test($(row).find('th').text())) return;
    $(row).find('a[href]').each((_,node) => { try { const target = new URL($(node).attr('href') || '',pageUrl); if (!/wikipedia\.org$/i.test(target.hostname)) officialUrls.add(target.href); } catch { /* Malformed article link. */ } });
  });
  const candidates:{result:DiscoveryResult;score:number}[] = [];
  $('a.external[href], .infobox a[href]').each((_,node) => {
    try {
      const original = new URL($(node).attr('href') || '',pageUrl); const target = new URL(original);
      if (target.protocol === 'http:') target.protocol = 'https:';
      if (target.protocol !== 'https:' || target.username || target.password || excluded.test(target.hostname) || archiveHost.test(target.hostname) || metadataHost.test(target.hostname) || archivePath.test(target.pathname)) return;
      const official = officialUrls.has(original.href);
      const text = $(node).closest('p,li,tr').text().slice(0,1000);
      const inReference = $(node).closest('.reference,.references,.reflist,.citation').length > 0;
      const news = localNews.test(target.hostname); const service = useful.test(target.hostname + ' ' + target.pathname);
      const advertised = !inReference && useful.test(text + ' ' + title);
      if (!official && !news && !service && !advertised) return;
      if (inReference && !news && !service && !official) return;
      // State/federal citations are not local source directories, even when cited by a city article.
      if (inReference && !official && /\.gov$/i.test(target.hostname)) return;
      target.hash = '';
      const datedArticle = /\/(?:19|20)\d{2}(?:\/|-)|\/articles?\/|\/story\//i.test(target.pathname);
      if (official || news || inReference || datedArticle) {
        target.pathname = '/'; target.search = '';
        if (news) target.hostname = target.hostname.replace(/^(?:archive|blogs)\./,'');
      }
      const score = (official ? 100 : 0) + (service ? 45 : 0) + (news ? 30 : 0) + (advertised ? 15 : 0) + (/calendar|events|feed|rss/i.test(target.pathname) ? 15 : 0);
      const trusted = geographicallyVerified && (official || advertised);
      candidates.push({score,result:{title:`${title} · ${official ? 'Official website' : target.hostname.replace(/^www\./,'')}`,url:target.href,snippet:`${trusted ? 'Verified regional organization. ' : ''}${official ? 'Website identified in the public directory' : 'Organization link listed in the public directory'} for ${title}; ${news ? 'regional news source candidate' : 'regional calendar or public-service candidate'}. Availability and current coverage must be checked.`}});
    } catch { /* Invalid links are not sources. */ }
  });
  const unique = new Map<string,DiscoveryResult>();
  for (const candidate of candidates.sort((a,b) => b.score-a.score)) { const key = hostKey(new URL(candidate.result.url)); if (!unique.has(key)) unique.set(key,candidate.result); }
  return [...unique.values()].slice(0,12);
}

function articleCoordinate(html:string):[number,number] | null {
  const $ = load(html); const numbers = $('.geo').first().text().trim().replaceAll('−','-').match(/(-?\d+(?:\.\d+)?)\s*;\s*(-?\d+(?:\.\d+)?)/);
  if (numbers && Math.abs(Number(numbers[1])) <= 90 && Math.abs(Number(numbers[2])) <= 180) return [Number(numbers[1]),Number(numbers[2])];
  const latitude = Number($('.latitude').first().text().trim()); const longitude = Number($('.longitude').first().text().trim());
  return $('.latitude').length && $('.longitude').length && Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude,longitude] : null;
}
function regionalArticles(html:string, region:string):string[] {
  const $ = load(html); const output:string[] = []; const normalizedRegion = normalize(region);
  $('.infobox a[href^="/wiki/"], .mw-parser-output p a[href^="/wiki/"]').each((_,node) => {
    let key:string; try { key = decodeURIComponent(($(node).attr('href') || '').slice(6)); } catch { return; } if (!key || key.includes(':') || key.includes('#')) return;
    const title = key.replaceAll('_',' '); const county = /\bcounty\b/i.test(title);
    const nearbyCity = key.includes(',') && normalizedRegion.length > 2 && normalize(title).includes(normalizedRegion) && !/university|battle|history|railroad|river|lake|township/i.test(title);
    if ((county || nearbyCity) && !output.includes(key)) output.push(key);
  });
  return output.sort((a,b) => Number(/county/i.test(b))-Number(/county/i.test(a))).slice(0,4);
}

/** Robots-respecting directory discovery. Generated URLs are article fallbacks, never fabricated event pages. */
export class WikipediaDirectory implements WebDiscoveryProvider {
  readonly name = 'Wikipedia public directory';
  private articles = new Map<string,Promise<{body:string;url:string} | null>>();
  private nearby = new Map<string,Location>();
  nearbyLocations():Location[] {return [...this.nearby.values()];}
  clearCache(){this.articles.clear();this.nearby.clear();}
  constructor(private http:PublicHttp) {}
  private article(key:string, signal?:AbortSignal) {
    signal?.throwIfAborted(); const canonical = key.replaceAll(' ','_'); const existing = this.articles.get(canonical); if (existing) return existing;
    const pending = this.http.request(`https://en.wikipedia.org/wiki/${encodeURIComponent(canonical)}`).then(response => response.status === 200 ? {body:response.body,url:response.url} : null).catch(() => null);
    this.articles.set(canonical,pending); return pending;
  }
  async discover(query:DiscoveryQuery, signal?:AbortSignal):Promise<DiscoveryResult[]> {
    signal?.throwIfAborted(); const nameParts = query.locationName.split(',').map(part => part.trim());
    const city = nameParts[0]; const cityKey = normalize(city); const region = nameParts[1] || '';
    const url = new URL('https://api.wikimedia.org/core/v1/wikipedia/en/search/page'); url.search = new URLSearchParams({q:query.query,limit:'6'}).toString();
    let pages:{key:string;title:string;excerpt?:string}[] = [];
    try {
      const response = await this.http.request(url.href);
      if (response.status === 200) { const parsed = JSON.parse(response.body); if (Array.isArray(parsed.pages)) pages = parsed.pages.filter((page:typeof pages[number]) => typeof page.key === 'string' && typeof page.title === 'string' && normalize(page.title + ' ' + (page.excerpt || '')).includes(cityKey) && !broadArticle.test(page.title) && (normalize(page.title.split(',')[0]) === cityKey || institution.test(page.title))).slice(0,6); }
    } catch { signal?.throwIfAborted(); /* A public city article remains a permitted fallback. */ }
    const fallbackKey = [city,region].filter(Boolean).join(', ');
    const output:DiscoveryResult[] = []; let cityArticle:{body:string;url:string} | null = null; let origin:[number,number] | null = null;
    const exactCityHits = pages.filter(page => normalize(page.title.split(',')[0]) === cityKey && (!region || normalize(page.title).includes(normalize(region))));
    for (const key of [...new Set([fallbackKey,...exactCityHits.map(page => page.key),city])]) {
      const candidate = await this.article(key,signal); if (!candidate) continue;
      const coordinate = articleCoordinate(candidate.body); const $ = load(candidate.body); const heading = $('#firstHeading,.mw-page-title-main').first().text().trim();
      const exactHeading = !heading || normalize(heading) === cityKey || normalize(heading) === normalize(fallbackKey) || (!region && normalize(heading.split(',')[0]) === cityKey);
      const regionalInfobox = !region || region.length <= 2 || normalize($('.infobox').text()).includes(normalize(region));
      // A generated title resolving to a disambiguation or wrong region provides no scoped sources.
      if (!coordinate || !exactHeading || !regionalInfobox) continue;
      cityArticle = candidate; origin = coordinate; break;
    }
    if (cityArticle) output.push(...directoryLinks(cityArticle.body,fallbackKey,cityArticle.url,true));
    let institutionsAccepted = 0;
    if (origin) for (const page of pages) {
      if (institutionsAccepted >= 3) break;
      const exactCity = normalize(page.title) === cityKey || normalize(page.title) === normalize(fallbackKey);
      if (exactCity || broadArticle.test(page.title) || !institution.test(page.title)) continue;
      const article = await this.article(page.key,signal); if (!article) continue; const coordinate = articleCoordinate(article.body);
      if (!coordinate || distanceMiles(origin[0],origin[1],coordinate[0],coordinate[1]) > Math.min(150,query.radiusMiles)) continue;
      output.push(...directoryLinks(article.body,page.title,article.url,true)); institutionsAccepted++;
    }
    if (cityArticle && origin && query.radiusMiles > 0) {
      let accepted = 0;
      for (const key of regionalArticles(cityArticle.body,region)) {
        if (accepted >= 2) break;
        const article = await this.article(key,signal); if (!article) continue; const coordinate = articleCoordinate(article.body);
        if (!coordinate || distanceMiles(origin[0],origin[1],coordinate[0],coordinate[1]) > Math.min(150,query.radiusMiles)) continue;
        const name=key.replaceAll('_',' ');this.nearby.set(name,{name,latitude:coordinate[0],longitude:coordinate[1]});
        output.push(...directoryLinks(article.body,name,article.url,true)); accepted++;
      }
    }
    const unique = new Map<string,DiscoveryResult>();
    for (const result of output.sort((a,b) => Number(/Official website/.test(b.title))-Number(/Official website/.test(a.title)) || Number(/Verified regional organization/.test(b.snippet))-Number(/Verified regional organization/.test(a.snippet)) || Number(/calendar|event|library|parks|transit/i.test(b.url))-Number(/calendar|event|library|parks|transit/i.test(a.url)))) { const key = hostKey(new URL(result.url)); if (!unique.has(key)) unique.set(key,result); }
    return [...unique.values()].slice(0,12);
  }
}

export function sourceFromResult(result:DiscoveryResult, location:Location):Source {
  const url = new URL(result.url); url.hash = ''; const official = url.hostname.endsWith('.gov') || /Official website/.test(result.title)&&/public directory/i.test(result.snippet);
  return {sourceId:createHash('sha256').update(url.href).digest('hex').slice(0,24),name:result.title.slice(0,200),url:url.href,domain:url.hostname,type:official ? 'OFFICIAL' : localNews.test(url.hostname) ? 'NEWS' : 'UNVERIFIED',region:location.name,lastChecked:null,lastSuccessful:null,checkFrequency:official ? 43200 : 21600,parserType:/\.ics|ical/i.test(url.href) ? 'ical' : /rss|\/feed\b|\.xml/i.test(url.href) ? 'rss' : 'html',reliability:official ? 85 : 50,failureCount:0,isDemo:false,enabled:true,locationKey:location.key || location.name,discoveredAt:new Date().toISOString(),status:'idle',notes:result.snippet};
}
export function discoveryQueries(location:Location, query?:string):string[] {
  const city = (location.discoveryName||location.name).split(',').slice(0,2).map(part => part.trim()).join(' ');
  if (!query?.trim()) return [city,`${city} library`,`${city} parks`,`${city} arena`,`${city} college`,`${city} transportation`,`${city} county government`,`${city} museum`,`${city} schools`,`${city} community calendar`,`${city} emergency management`,`${city} local news`];
  const topics = query.toLowerCase();
  const expanded = /music|concert|metal|jazz|rock|band/.test(topics) ? 'arena' : /furry|meetup|community|car meet/.test(topics) ? 'community center' : /food|restaurant|market|coffee/.test(topics) ? 'market' : /road|traffic|construction|transit/.test(topics) ? 'transportation' : /tech|cyber|software|student|workshop/.test(topics) ? 'college' : /art|museum|gallery/.test(topics) ? 'museum' : 'events';
  return [city,`${city} ${query.trim()}`,`${city} ${expanded}`,`${city} events`,`${city} library`,`${city} news`];
}
