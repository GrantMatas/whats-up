import { build } from 'esbuild';
import { rmSync } from 'node:fs';
await import('./generate-icon.mjs');
for(const path of ['dist/shared/fixtures.cjs','dist/backend/worker.cjs.map','dist/main/index.cjs.map','dist/preload/index.cjs.map'])rmSync(path,{force:true});
await Promise.all([
  build({ entryPoints: ['src/backend/worker.ts'], outfile: 'dist/backend/worker.cjs', platform: 'node', target: 'node24', format: 'cjs', bundle: true, external: ['node:sqlite'] }),
  build({ entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.cjs', platform: 'node', target: 'node24', format: 'cjs', bundle: true, external: ['electron', 'node:sqlite'] }),
  build({ entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.cjs', platform: 'node', target: 'node24', format: 'cjs', bundle: true, external: ['electron'] }),
]);
await import('./licenses.mjs');
