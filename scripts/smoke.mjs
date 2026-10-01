import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electron from 'electron';
const isolated = mkdtempSync(join(tmpdir(), 'whatsup-smoke-'));
const output = resolve('artifacts/smoke');
mkdirSync(output, { recursive: true });
// Never accept a report from an earlier run if the launcher exits before the app starts.
rmSync(join(output, 'report.json'), { force: true });
const env = { ...process.env, WHATSUP_DATA_DIR: isolated, WHATSUP_SMOKE_DIR: output };
delete env.ELECTRON_RUN_AS_NODE; delete env.WHATSUP_DEV_URL;
const executable = process.argv[2] || electron;
const args = process.argv[2] ? ['--smoke-test'] : ['.', '--smoke-test'];
args.push('--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--user-data-dir='+isolated);
const child = spawn(executable, args, { env, stdio: 'inherit', windowsHide: true });
const timeout = setTimeout(() => { child.kill(); console.error('Desktop smoke timed out after 60 seconds'); process.exitCode = 1; }, 60000);
child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
child.on('exit', code => {
  clearTimeout(timeout);
  const reportFile = join(output, 'report.json');
  if (!existsSync(reportFile)) { console.error('No desktop smoke report was generated'); process.exitCode = 1; return; }
  const report = JSON.parse(readFileSync(reportFile, 'utf8'));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = code === 0 && report.passed ? 0 : 1;
});
