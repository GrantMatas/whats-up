import type { Source } from '../../shared/models';
export function nextCheck(source: Source, now: number, unchangedChecks = 0): number {
  const failures = Math.min(source.failureCount, 8);
  const adaptive = Math.min(4, 1 + Math.max(0, unchangedChecks) / 4);
  const interval = Math.min(86400, source.checkFrequency * adaptive * 2 ** failures);
  const last = source.lastChecked ? Date.parse(source.lastChecked) : now - interval * 1000;
  return Math.max(now, last + interval * 1000);
}
export function mayStartJob(activeGlobal: number, activeDomain: number, onBattery: boolean, expensive: boolean): boolean {
  return activeGlobal < 3 && activeDomain < 1 && !(onBattery && expensive);
}
