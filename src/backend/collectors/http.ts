import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const userAgent = 'WhatsUpLocal/0.4 (+public local information desktop reader)';
export function publicAddress(address: string) {
  if (isIP(address) === 4) {const octets=address.split('.').map(Number);return !/^(0|10|127|169\.254|172\.(1[6-9]|2\d|3[01])|192\.168|192\.0\.0|192\.0\.2|198\.18|198\.19|198\.51\.100|203\.0\.113)\./.test(address)&&octets[0]<224&&!(octets[0]===100&&octets[1]>=64&&octets[1]<=127);}
  return isIP(address) === 6 && !/^(::|::1$|fc|fd|fe[89ab]|ff|::ffff:)/i.test(address);
}
export async function validatePublicUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw Error('Only public HTTPS sources are allowed');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw Error('Private network sources are not permitted');
  return url;
}
export function robotsAllows(body: string, pathname: string) {
  const groups: { agents: string[]; rules: { allow: boolean; value: string }[] }[] = [];
  let group: typeof groups[number] | undefined;
  for (const line of body.split(/\r?\n/)) {
    const match = line.replace(/#.*/, '').trim().match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i);
    if (!match) continue;
    if (match[1].toLowerCase() === 'user-agent') {
      if (!group || group.rules.length) { group = { agents: [], rules: [] }; groups.push(group); }
      group.agents.push(match[2].toLowerCase());
    } else if (group && match[2]) group.rules.push({ allow: match[1].toLowerCase() === 'allow', value: match[2] });
  }
  const specific = groups.filter(g => g.agents.some(a => a !== '*' && userAgent.toLowerCase().includes(a)));
  const rules = (specific.length ? specific : groups.filter(g => g.agents.includes('*'))).flatMap(g => g.rules);
  const matches = rules.filter(r => { const anchored = r.value.endsWith('$'); const expression = r.value.replace(/\$$/, '').split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'); return new RegExp('^' + expression + (anchored ? '$' : '')).test(pathname); }).sort((a,b) => b.value.length - a.value.length || Number(b.allow) - Number(a.allow));
  return matches[0]?.allow ?? true;
}
export interface HttpDocument { url: string; body: string; contentType: string; status: number; etag?: string; lastModified?: string; bytes?:Uint8Array }
export class PublicHttp {
  private robots = new Map<string, { body: string; expires: number }>();
  private lastRequest = new Map<string, number>();
  requests = 0;
  async request(value: string, headers: Record<string,string> = {}, robots = true, redirects = 0, binary=false): Promise<HttpDocument> {
    if(redirects>5)throw Error('Too many redirects');
    let url = await validatePublicUrl(value);
    if (robots) {
      let policy = this.robots.get(url.origin);
      if (!policy || policy.expires < Date.now()) {
        const response = await this.request(url.origin + '/robots.txt', {}, false);
        if (response.status === 401 || response.status === 403 || response.status >= 500) throw Error('Robots policy unavailable or access restricted');
        policy = { body: response.status === 404 ? '' : response.body, expires: Date.now() + 86400000 };
        this.robots.set(url.origin, policy);
        if(this.robots.size>500)this.robots.delete(this.robots.keys().next().value!);
      }
      if (!robotsAllows(policy.body, url.pathname + url.search)) throw Error('Blocked by robots.txt');
    }
    for (let redirect = 0; redirect < 5; redirect++) {
      const pause = Math.max(0, 1100 - (Date.now() - (this.lastRequest.get(url.hostname) || 0)));
      if (pause) await new Promise(resolve => setTimeout(resolve, pause));
      this.lastRequest.set(url.hostname, Date.now()); this.requests++;
      if(this.lastRequest.size>1000)this.lastRequest.delete(this.lastRequest.keys().next().value!);
      let response: Response | undefined;
      for (let attempt=0;attempt<2;attempt++) {
        try {
          response = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json, application/rss+xml, application/atom+xml, text/calendar, text/html;q=0.9, */*;q=0.5', ...headers }, signal: AbortSignal.timeout(15000), redirect: 'manual' });
          if (attempt===1 || ![502,503,504].includes(response.status)) break;
          await response.body?.cancel();
        } catch(error) { if(attempt===1)throw error; }
        await new Promise(resolve=>setTimeout(resolve,1500));this.requests++;
        this.lastRequest.set(url.hostname,Date.now());
      }
      if (!response) throw Error('Source request failed');
      if (response.status >= 300 && response.status < 400 && response.status !== 304) {
        const target = response.headers.get('location'); if (!target) throw Error('Redirect missing destination');
        const next = new URL(target, url).href;
        // Check each destination's policy independently, including same-host path redirects.
        return this.request(next, headers, robots, redirects+1,binary);
      }
      if (Number(response.headers.get('content-length')) > 4_000_000) throw Error('Source document exceeds 4 MB limit');
      let size = 0; const chunks: Uint8Array[] = [];
      if (response.body) for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) { size += chunk.length; if (size > 4_000_000) throw Error('Source document exceeds 4 MB limit'); chunks.push(chunk); }
      const bytes=Buffer.concat(chunks);return { url: url.href, body: binary?'':bytes.toString('utf8'), ...(binary?{bytes}:{}),contentType: response.headers.get('content-type') || '', status: response.status, etag: response.headers.get('etag') || undefined, lastModified: response.headers.get('last-modified') || undefined };
    }
    throw Error('Too many redirects');
  }
}
