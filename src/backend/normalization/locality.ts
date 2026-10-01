import type {Happening,Location,Source} from '../../shared/models';
import {distanceMiles} from '../search/intent';
export function belongsToArea(item:Happening,source:Source,location:Location,radius:number){
 if(item.latitude!==null&&item.longitude!==null)return distanceMiles(location.latitude,location.longitude,item.latitude,item.longitude)<=radius;
 if(source.url.startsWith('https://api.weather.gov/alerts/active?point='))return true;
 if(item.geometry){const points=item.geometry.type==='Point'?[item.geometry.coordinates]:item.geometry.type==='LineString'?item.geometry.coordinates:item.geometry.coordinates.flat();if(points.some(([lng,lat])=>distanceMiles(location.latitude,location.longitude,lat,lng)<=radius))return true;}
 const city=(location.discoveryName||location.name).split(',')[0].toLowerCase();const corpus=[item.title,item.summary,item.locationName,item.address].join(' ').toLowerCase();
 return /verified regional organization/i.test(source.notes||'')||corpus.includes(city);
}
export function currentPublicRecord(item:Happening,now:string){
 if(item.startTime)return Date.parse(item.endTime||item.startTime)>=Date.parse(now)-30*86400000;
 return !item.publishedAt||Date.parse(item.publishedAt)>=Date.parse(now)-90*86400000;
}
