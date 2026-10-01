import type { AppSettings } from '../../shared/models';
import type { ScanMode, ScanRun } from '../../shared/intelligence';
export function chooseScanMode(requested:ScanMode,settings:AppSettings,runs:ScanRun[],now=Date.now(),hasRecords=true):ScanMode {
  if(requested!=='smart')return requested;
  if(!hasRecords)return 'refresh';
  const complete=runs.filter(run=>run.status==='complete');
  const last=(modes:ScanMode[])=>Math.max(0,...complete.filter(run=>modes.includes(run.mode)).map(run=>Date.parse(run.completedAt!)));
  if(now-last(['refresh'])>=settings.scanning.rediscoveryHours*3600000)return 'refresh';
  if(now-last(['deep','refresh'])>=Math.min(settings.scanning.discoveryHours,settings.scanning.intervalHours)*3600000)return 'deep';
  return 'quick';
}
export function automaticScanDue(settings:AppSettings,runs:ScanRun[],now=Date.now()):boolean {
  if(!settings.onboarded||settings.demoMode||!settings.scanning.enabled||runs.some(run=>run.status==='running'))return false;
  // Frequent lightweight feed checks must not postpone the daily research run.
  const recent=runs.filter(run=>run.mode!=='quick'&&(run.status==='complete'||run.status==='failed'));
  const last=Math.max(0,...recent.map(run=>Date.parse(run.completedAt||run.startedAt)));
  return now-last>=settings.scanning.intervalHours*3600000;
}
