import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const paths = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ls', '--omit=dev', '--all', '--parseable'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim().split(/\r?\n/);
const notices = ['Third-party software notices', 'Publisher content and images retain their original rights.'];
for (const directory of [...new Set(paths)].filter(path => resolve(path) !== process.cwd()).sort()) {
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  notices.push(`\n${pkg.name} ${pkg.version}\nLicense: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license || 'See package notices')}`);
  for (const filename of readdirSync(directory).filter(name => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name))) {
    try { notices.push(readFileSync(join(directory, filename), 'utf8')); } catch { /* Some packages use a directory for licenses. */ }
  }
}
mkdirSync('dist', { recursive: true });
writeFileSync('dist/THIRD-PARTY-NOTICES.txt', notices.join('\n\n'));
