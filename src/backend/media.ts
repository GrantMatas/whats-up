import { PublicHttp } from './collectors/http';
import { WorkQueue } from './scheduler/queue';
interface ImageAsset {bytes:Uint8Array;contentType:string;expiresAt:number}
/** Public publisher assets only; no cookies, SVG, full-size galleries or private hosts. */
export class PublisherImages {
  private cache=new Map<string,ImageAsset>();private failures=new Map<string,number>();private pending=new Map<string,Promise<ImageAsset>>();private queue=new WorkQueue('Publisher images',2,30);private bytes=0;
  constructor(private http=new PublicHttp()){}
  private generation=0;
  clear(){this.generation++;this.cache.clear();this.failures.clear();this.pending.clear();this.bytes=0;}
  async get(url:string):Promise<ImageAsset>{
    const cached=this.cache.get(url);if(cached&&cached.expiresAt>Date.now())return cached;
    if((this.failures.get(url)||0)>Date.now())throw Error('Publisher image is temporarily unavailable');
    const pending=this.pending.get(url);if(pending)return pending;
    const generation=this.generation;const work=this.queue.run(async()=>{try{const response=await this.http.request(url,{},true,0,true);const type=response.contentType.split(';')[0].trim().toLowerCase();if(response.status!==200||!/^image\/(jpeg|png|webp|avif|gif)$/.test(type)||!response.bytes?.length)throw Error('No supported public publisher image');
      const asset={bytes:response.bytes,contentType:type,expiresAt:Date.now()+24*3600000};if(generation!==this.generation)return asset;const old=this.cache.get(url);if(old)this.bytes-=old.bytes.byteLength;this.cache.delete(url);this.cache.set(url,asset);this.bytes+=asset.bytes.byteLength;
      while(this.cache.size>48||this.bytes>24*1024*1024){const key=this.cache.keys().next().value!;this.bytes-=this.cache.get(key)!.bytes.byteLength;this.cache.delete(key);}return asset;
    }catch(error){if(generation===this.generation)this.failures.set(url,Date.now()+30*60000);if(this.failures.size>200)this.failures.delete(this.failures.keys().next().value!);throw error;}});const tracked=work.finally(()=>{if(this.pending.get(url)===tracked)this.pending.delete(url);});this.pending.set(url,tracked);return tracked;
  }
}
