import { useState } from 'react';
import type { Happening } from '../../shared/models';
import { categoryInfo } from '../ui';
import { isPreview } from '../bridge';
export function EventImage({item,eager=false}:{item:Happening;eager?:boolean}){
  const [failed,setFailed]=useState<string[]>([]);const url=item.images.find(url=>!failed.includes(url));const Icon=categoryInfo[item.category].icon;
  if(!url)return <div className={`event-image-placeholder art-${item.category}`} aria-label="No publisher image available"><Icon size={38} strokeWidth={1.4}/></div>;
  const src=isPreview?url:`whatsup://app/event-image?url=${encodeURIComponent(url)}`;
  return <img className="publisher-event-image" src={src} alt={`Publisher image for ${item.title}`} loading={eager?'eager':'lazy'} decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(previous=>[...previous,url])}/>;
}
