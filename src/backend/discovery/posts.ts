import type { ExtractedRecord } from '../parsers/contracts';
import { plainText,publicUrl,timestamp } from '../parsers/common';
import { PublicHttp } from '../collectors/http';
import type { IntelligenceStore } from '../database/intelligence';
/** Public AT Protocol search. Login, denial and challenge responses stop this provider. */
export class PublicPostProvider {
  readonly name='Bluesky public posts';private nextAttempt=0;
  constructor(private http:PublicHttp,private cache?:IntelligenceStore){}
  available(){return this.nextAttempt<=Date.now()&&!this.cache?.postQuery('provider-failure')?.error;}
  refresh(){this.nextAttempt=0;this.cache?.cachePosts('provider-failure',{records:[],expiresAt:0});}
  async search(query:string):Promise<ExtractedRecord[]> {
    const cached=this.cache?.postQuery(query);if(cached){if(cached.error)throw Error(cached.error);return cached.records;}
    const failure=this.cache?.postQuery('provider-failure');if(failure?.error)throw Error(failure.error);
    if(this.nextAttempt>Date.now())throw Error('Public-post provider cooling down after an access failure');
    const url=new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts');url.searchParams.set('q',query);url.searchParams.set('sort','latest');url.searchParams.set('limit','20');url.searchParams.set('since',new Date(Date.now()-30*86400000).toISOString());
    try{const response=await this.http.request(url.href,{},false);if(response.status!==200)throw Error(`Public posts unavailable (HTTP ${response.status}); no login or challenge bypass attempted`);const records=parsePublicPosts(JSON.parse(response.body));this.cache?.cachePosts(query,{records,expiresAt:Date.now()+6*3600000});return records;}
    catch(error){this.nextAttempt=Date.now()+30*60000;this.cache?.cachePosts('provider-failure',{records:[],error:String(error),expiresAt:this.nextAttempt});throw error;}
  }
}
export function parsePublicPosts(input:unknown):ExtractedRecord[] {
  const posts=(input as {posts?:unknown[]})?.posts;if(!Array.isArray(posts))return [];
  return posts.slice(0,20).flatMap(value=>{
    if(!value||typeof value!=='object')return [];const post=value as {uri?:string;record?:{text?:string;createdAt?:string};author?:{did?:string;handle?:string};embed?:{external?:{uri?:string}}};
    const text=plainText(post.record?.text,240);const publishedAt=timestamp(post.record?.createdAt,'UTC');
    const match=post.uri?.match(/^at:\/\/(did:[\w:.-]+)\/app\.bsky\.feed\.post\/([a-z0-9]+)$/i);
    if(!text||!publishedAt||!match||post.author?.did!==match[1])return [];
    const sourceUrl=`https://bsky.app/profile/${encodeURIComponent(match[1])}/post/${match[2]}`;
    return [{title:text.slice(0,160),summary:text,sourceUrl,publishedAt,category:'community' as const,tags:['public post'],rawMetadata:{format:'public-post',kind:'public-post',author:post.author?.handle,uid:post.uri,referenceUrl:publicUrl(post.embed?.external?.uri)||undefined}}];
  });
}
