import { listPackage, extractFile } from '@electron/asar';
import { readFileSync, writeFileSync, statSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, sep } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const archive = 'release/win-unpacked/resources/app.asar';
const entries = listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, ''));
const failures = [];
// Match private workstation paths without embedding the developer's identity in release tooling.
const forbiddenText = [/[A-Z]:[\\/]Users[\\/](?!Public(?:[\\/]|$)|Default(?:[\\/]|$))[^\s"'<>]+/i, /\/Users\/[^\s"'<>]+/, /\.codex[\\/]attachments/i, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/, /Jazz along the canal|Iron Meridian · heavy music showcase|whats-up-demo|whatsup-demo/];
for (const path of entries) {
  if (/(?:^|\/)(?:tests?|fixtures|artifacts|\.git|profiles?|user-data|\.env(?:\.[^/]*)?|.*\.(?:sqlite(?:-wal|-shm)?|db(?:-wal|-shm)?|log|map)|.*\.(?:test|spec)\.[^/]+)$/i.test(path)) failures.push(`Excluded content: ${path}`);
  if (!/^(?:dist\/.*\.(?:cjs|js|css|html|txt|json)|package\.json|LICENSE)$/.test(path)) continue;
  const contents = extractFile(archive, path.replaceAll('/', sep)).toString('utf8');
  if (forbiddenText.some(pattern => pattern.test(contents))) failures.push(`Private or sample content: ${path}`);
}
for (const required of ['LICENSE', 'dist/THIRD-PARTY-NOTICES.txt', 'dist/main/index.cjs', 'dist/backend/worker.cjs']) {
  if (!entries.includes(required)) failures.push(`Missing ${required}`);
}
if (process.env.USERPROFILE) {
  const markers = [process.env.USERPROFILE, process.env.USERPROFILE.replaceAll('\\', '/')].flatMap(value => [Buffer.from(value), Buffer.from(value, 'utf16le')]);
  for (const file of [archive, "release/win-unpacked/What's Up.exe"]) {
    const bytes = readFileSync(file);
    if (markers.some(marker => bytes.includes(marker))) failures.push('Private workstation path found in compiled package');
  }
}
if (failures.length) throw new Error(failures.join('\n'));
const assets = [`What's Up Setup ${pkg.version}.exe`, `What's Up ${pkg.version}.exe`].map(name => {
  const path = join('release', name);
  const downloadName = name.replace("What's Up", 'Whats-Up').replaceAll(' ', '-');
  copyFileSync(path, join('release', downloadName));
  return { name: downloadName, bytes: statSync(path).size, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
});
writeFileSync('release/SHA256SUMS.txt', assets.map(asset => `${asset.sha256}  ${asset.name}`).join('\n') + '\n');
const report = { version: pkg.version, passed: true, applicationArchiveEntries: entries.length, checks: ['No databases, logs, profiles, test fixtures, or source maps', 'No private workstation paths, credential patterns, or legacy sample payloads in application files', 'Application and dependency licenses included'], assets };
writeFileSync('release/PRIVACY-AUDIT.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
