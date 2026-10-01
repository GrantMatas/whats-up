import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
// Source-native brand mark. PNG-in-ICO is supported by current Windows shells.
const size=256, data=Buffer.alloc((size*4+1)*size);
const hex=[[128,31],[214,81],[214,175],[128,225],[42,175],[42,81]];
const compass=[[89,170],[110,87],[176,91],[152,171]];
function inside(x,y,polygon){let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const [a,b]=polygon[i],[c,d]=polygon[j];if((b>y)!=(d>y)&&x<(c-a)*(y-b)/(d-b)+a)hit=!hit;}return hit;}
function segment(x,y,a,b){const dx=b[0]-a[0],dy=b[1]-a[1];const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);}
function pixel(x,y){const radius=48;const cx=Math.max(radius,Math.min(size-radius,x)),cy=Math.max(radius,Math.min(size-radius,y));if(Math.hypot(x-cx,y-cy)>radius)return [0,0,0,0];const stroke=hex.some((p,i)=>segment(x,y,p,hex[(i+1)%6])<2.8);const dot=Math.hypot(x-128,y-128)<12;if(dot)return [29,38,33,255];if(stroke||inside(x,y,compass))return [228,236,222,255];return [29,38,33,255];}
for(let y=0;y<size;y++)for(let x=0;x<size;x++){const sum=[0,0,0,0];for(let sy=0;sy<2;sy++)for(let sx=0;sx<2;sx++){const rgba=pixel(x+(sx+.5)/2,y+(sy+.5)/2);rgba.forEach((n,i)=>sum[i]+=n/4);}const at=y*(size*4+1)+x*4+1;sum.forEach((n,i)=>data[at+i]=Math.round(n));}
function crc32(buffer){let crc=0xffffffff;for(const n of buffer){crc^=n;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,body){const name=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(body.length);crc.writeUInt32BE(crc32(Buffer.concat([name,body])));return Buffer.concat([len,name,body,crc]);}
const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(data)),chunk('IEND',Buffer.alloc(0))]);
const icoHeader=Buffer.alloc(22);icoHeader.writeUInt16LE(1,2);icoHeader.writeUInt16LE(1,4);icoHeader.writeUInt16LE(1,10);icoHeader.writeUInt16LE(32,12);icoHeader.writeUInt32LE(png.length,14);icoHeader.writeUInt32LE(22,18);
mkdirSync('assets',{recursive:true});writeFileSync('assets/app-icon.png',png);writeFileSync('assets/app-icon.ico',Buffer.concat([icoHeader,png]));
