import { describe,expect,it } from 'vitest';
import { directoryLinks,discoveryQueries,WikipediaDirectory,sourceFromResult } from '../src/backend/discovery/directory';
import type { PublicHttp } from '../src/backend/collectors/http';

const cityHtml = `<h1 id="firstHeading">Sampleton, Indiana</h1><table class="infobox"><tr><th>State</th><td>Indiana</td></tr><tr><th>Website</th><td><a class="external" href="https://sampleton.gov/about">Official site</a></td></tr><tr><th>County</th><td><a href="/wiki/Sample_County,_Indiana">Sample County</a></td></tr></table><span class="geo">40; -86</span><div class="mw-parser-output"><p>Community calendar <a class="external" href="https://sample-library.org/calendar">Public library events</a></p><div class="reflist"><a class="external" href="https://geohack.toolforge.org/geohack.php">Coordinates</a><a class="external" href="https://findingaids.library.uic.edu/archive.xml">University library history</a><a class="external" href="https://federalregister.gov/documents/2020/notice">Federal notice</a><a class="external" href="https://sampletimes.com/2020/01/01/old-story">Local newspaper</a><a class="external" href="https://www.sampletimes.com/2021/02/old-story">Another article</a></div></div>`;
const institution = (name:string,coordinate:string,host:string) => `<h1 id="firstHeading">${name}</h1><span class="geo">${coordinate}</span><table class="infobox"><tr><th>Website</th><td><a class="external" href="https://${host}/">Website</a></td></tr></table>`;

describe('regional public-directory discovery',() => {
  it('keeps useful organization sites and excludes archival/federal/tool pollution',() => {
    const result = directoryLinks(cityHtml,'Sampleton, Indiana','https://en.wikipedia.org/wiki/Sampleton,_Indiana',true);
    expect(result.map(row => row.url)).toEqual(['https://sampleton.gov/','https://sample-library.org/calendar','https://sampletimes.com/']);
    expect(result[0].snippet).toContain('Verified regional organization');
    expect(result[2].snippet).not.toContain('Verified regional organization');
    expect(sourceFromResult(result[2],{name:'Sampleton',latitude:40,longitude:-86}).type).toBe('NEWS');
  });
  it('falls back to the public city article when the structured search is unavailable',async () => {
    const requests:string[] = [];
    const http = { async request(url:string) { requests.push(url); if (url.includes('api.wikimedia.org')) throw Error('API unavailable'); return {status:200,url,body:url.includes('Sample_County') ? institution('Sample County','40.03; -86.02','samplecounty.gov') : cityHtml}; } } as unknown as PublicHttp;
    const directory = new WikipediaDirectory(http);
    const rows = await directory.discover({query:'Sampleton events',locationName:'Sampleton, Indiana',radiusMiles:20});
    expect(rows.some(row => row.url === 'https://sampleton.gov/')).toBe(true);
    expect(rows.some(row => row.url === 'https://samplecounty.gov/')).toBe(true);
    expect(requests).toHaveLength(3);
    await directory.discover({query:'Sampleton library',locationName:'Sampleton, Indiana',radiusMiles:20});
    expect(requests).toHaveLength(4); // Only the different structured query; articles are reused.
  });
  it('rejects broad highway search hits and out-of-radius organizations',async () => {
    const pages = [{key:'Interstate_69_in_Indiana',title:'Interstate 69 in Indiana',excerpt:'near Sampleton'}, {key:'Sampleton_Museum',title:'Sampleton Museum'}];
    const requests:string[] = [];
    const http = { async request(url:string) { requests.push(url); return {status:200,url,body:url.includes('api.wikimedia.org') ? JSON.stringify({pages}) : url.includes('Sampleton_Museum') ? institution('Sampleton Museum','42; -86','far-museum.org') : url.includes('Sample_County') ? institution('Sample County','42; -86','farcounty.gov') : cityHtml}; } } as unknown as PublicHttp;
    const rows = await new WikipediaDirectory(http).discover({query:'Sampleton transportation',locationName:'Sampleton, Indiana',radiusMiles:20});
    expect(rows.some(row => /far-museum|farcounty/.test(row.url))).toBe(false);
    expect(requests.some(url => url.includes('Interstate_69'))).toBe(false);
  });
  it('passes a disambiguation page and unrelated second hit to find a verified nearby venue',async () => {
    const pages = [{key:'Sampleton,_Indiana',title:'Sampleton, Indiana'},{key:'Sampleton_Freight',title:'Sampleton Freight'},{key:'Sampleton_Event_Center',title:'Sampleton Event Center'}];
    const http = { async request(url:string) { return {status:200,url,body:url.includes('api.wikimedia.org') ? JSON.stringify({pages}) : url.endsWith('/Sampleton') ? '<h1 id="firstHeading">Sample</h1><p>Disambiguation</p>' : url.includes('Event_Center') ? institution('Sampleton Event Center','40.02; -86.01','sample-events.org') : url.includes('Sample_County') ? institution('Sample County','40.03; -86.02','samplecounty.gov') : cityHtml}; } } as unknown as PublicHttp;
    const result = await new WikipediaDirectory(http).discover({query:'Sampleton Indiana',locationName:'Sampleton',radiusMiles:20});
    expect(result.find(row => row.url === 'https://sample-events.org/')?.snippet).toContain('Verified regional organization');
    expect(result.some(row => row.url === 'https://sampleton.gov/')).toBe(true);
  });
  it('expands an intent into six generic regional directory queries',() => {
    const location = {name:'Sampleton, Indiana, US',latitude:40,longitude:-86};
    expect(discoveryQueries(location,'metal concerts')).toHaveLength(6);
    expect(discoveryQueries(location,'metal concerts')).toContain('Sampleton Indiana arena');
    expect(discoveryQueries(location,'cybersecurity workshops')).toContain('Sampleton Indiana college');
  });
});
