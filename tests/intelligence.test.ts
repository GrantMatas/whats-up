import { describe,it,expect } from 'vitest';
import { LocalDatabase } from '../src/backend/database';
import { testSettings as defaultSettings } from './fixtures/test-records';
import { settingsSchema } from '../src/shared/models';
import { automaticScanDue,chooseScanMode } from '../src/backend/scheduler/scans';
import type { ScanRun } from '../src/shared/intelligence';

describe('persistent research scans',()=>{
  it('adds daily defaults to old settings without changing their area or interests',()=>{
    const {scanning,tutorialCompleted,notifications,visibleCategories,mapStyle,timelineDensity,homeModules,confidenceWeights,...legacy}=defaultSettings;
    const migrated=settingsSchema.parse({...legacy,onboarded:true,interests:['Car meets']});
    expect(migrated.scanning.intervalHours).toBe(24);expect(migrated.scanning.enabled).toBe(true);
    expect(migrated.interests).toEqual(['Car meets']);expect(migrated.location).toEqual(defaultSettings.location);
  });
  it('stores real task completion and recovers interrupted scans',()=>{
    const db=new LocalDatabase(':memory:');db.saveSettings({...defaultSettings,onboarded:true});
    const key=defaultSettings.location.name;const run=db.intelligence.beginRun(key,'deep','manual');
    const task=db.intelligence.startTask(run.id,'search','Local events');
    expect(db.getState().intelligence!.scans[0]).toMatchObject({totalTasks:1,completedTasks:0,status:'running'});
    db.intelligence.finishTask(task.id,'3 results');db.intelligence.finishTask(task.id,'Repeated callback');
    expect(db.intelligence.getRun(run.id)!.completedTasks).toBe(1);
    db.intelligence.recoverScans();expect(db.intelligence.getRun(run.id)!.status).toBe('interrupted');db.close();
  });
  it('keeps history separate between areas and expires cached queries',()=>{
    const db=new LocalDatabase(':memory:');db.saveSettings({...defaultSettings,onboarded:true});
    db.intelligence.beginRun(defaultSettings.location.name,'quick','manual');
    db.intelligence.cacheSearch({key:'query-key',query:'events',provider:'test',locationKey:defaultSettings.location.name,results:[],expiresAt:'2026-10-01T00:00:00Z'});
    expect(db.intelligence.getSearch('query-key',Date.parse('2026-09-30T00:00:00Z'))).not.toBeNull();
    expect(db.intelligence.getSearch('query-key',Date.parse('2026-10-02T00:00:00Z'))).toBeNull();
    db.saveSettings({...db.getSettings(),location:{name:'Other',latitude:40,longitude:-84}});
    expect(db.getState().intelligence!.scans).toEqual([]);db.close();
  });
});
describe('research cadence',()=>{
  it('keeps research cadence and its history after many quick checks',()=>{const db=new LocalDatabase(':memory:');db.saveSettings(defaultSettings);const key=defaultSettings.location.name;const deep=db.intelligence.beginRun(key,'deep','scheduled');db.intelligence.updateRun(deep.id,{status:'complete',completedAt:new Date().toISOString()});for(let i=0;i<125;i++){const run=db.intelligence.beginRun(key,'quick','scheduled');db.intelligence.updateRun(run.id,{status:'complete',completedAt:new Date().toISOString()});}expect(db.intelligence.runs(key).some(run=>run.id===deep.id)).toBe(true);expect(db.getState().intelligence?.scans.some(run=>run.id===deep.id)).toBe(true);expect(automaticScanDue({...defaultSettings,onboarded:true},db.intelligence.runs(key))).toBe(false);db.close();});
  const now=Date.parse('2026-09-30T12:00:00Z');const settings={...defaultSettings,onboarded:true};
  const run=(mode:ScanRun['mode'],hoursAgo:number):ScanRun=>({id:mode,locationKey:'area',mode,origin:'scheduled',status:'complete',startedAt:new Date(now-hoursAgo*3600000).toISOString(),completedAt:new Date(now-hoursAgo*3600000).toISOString(),phase:'Complete',totalTasks:1,completedTasks:1,sourcesChecked:1,findings:0,updated:0,duplicates:0,radarMatches:0,failures:0,currentActivity:null,error:null});
  it('does not let quick feed checks defer daily research',()=>{
    const runs=[run('deep',25),run('refresh',30),run('quick',0.1)];
    expect(automaticScanDue(settings,runs,now)).toBe(true);expect(chooseScanMode('smart',settings,runs,now)).toBe('deep');
    expect(chooseScanMode('smart',settings,[run('refresh',2)],now)).toBe('quick');
  });
  it('runs research at a shorter configured interval instead of repeatedly scheduling quick checks',()=>{
    const sixHourly={...settings,scanning:{...settings.scanning,intervalHours:6}};
    const runs=[run('refresh',7),run('quick',0.1)];
    expect(automaticScanDue(sixHourly,runs,now)).toBe(true);
    expect(chooseScanMode('smart',sixHourly,runs,now)).toBe('deep');
    expect(automaticScanDue(sixHourly,[run('deep',0)],now)).toBe(false);
  });
  it('honors disabling automatic scans and explicit levels',()=>{
    expect(automaticScanDue({...settings,scanning:{...settings.scanning,enabled:false}},[],now)).toBe(false);
    expect(chooseScanMode('quick',settings,[],now)).toBe('quick');expect(chooseScanMode('smart',settings,[],now)).toBe('refresh');
  });
});
