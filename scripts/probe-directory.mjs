import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
mkdirSync('artifacts/live',{recursive:true});
await build({entryPoints:['src/backend/discovery/directory.ts'],outfile:'artifacts/live/directory.cjs',bundle:true,platform:'node',format:'cjs'});
const {WikipediaDirectory}=createRequire(import.meta.url)('../artifacts/live/directory.cjs');
await build({entryPoints:['src/backend/collectors/http.ts'],outfile:'artifacts/live/http.cjs',bundle:true,platform:'node',format:'cjs'});
const {PublicHttp}=createRequire(import.meta.url)('../artifacts/live/http.cjs');
const provider=new WikipediaDirectory(new PublicHttp());
for(const location of ['Fishers Indiana','Chicago Illinois','Seattle Washington']){
const results=await provider.discover({query:location,locationName:location.split(' ')[0],radiusMiles:25});writeFileSync('artifacts/live/'+location.split(' ')[0]+'-directory.json',JSON.stringify(results,null,2));console.log(JSON.stringify({location,sources:results.length,sample:results.slice(0,8)}));
}
