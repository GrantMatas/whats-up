import{describe,it,expect}from'vitest';
import{LocalDatabase}from'../src/backend/database';
import { testSettings as defaultSettings } from './fixtures/test-records';
import{testHappenings}from'./fixtures/test-records';
describe('bounded incremental intelligence work',()=>{
 it('retains a large catalog and updates one record without rewriting its history',()=>{const db=new LocalDatabase(':memory:');db.saveSettings({...defaultSettings,onboarded:true});const records=Array.from({length:1000},(_,i)=>({...testHappenings[0],id:`benchmark-${i}`,title:`District bulletin ${i}`,sourceUrl:`https://publisher.example/event/${i}`,originalUrl:`https://publisher.example/event/${i}`,isDemo:false,startTime:new Date(Date.UTC(2026,10,1)+i*3600000).toISOString(),endTime:null,images:[],rawMetadata:{uid:String(i),format:'jsonld'}}));let start=performance.now();db.ingest(records);const initialMs=performance.now()-start;start=performance.now();expect(db.ingest([{...records[500],summary:'Actual changed publisher description'}]).updated).toBe(1);const incrementalMs=performance.now()-start;expect(db.getState().happenings).toHaveLength(1000);expect(initialMs).toBeLessThan(20000);expect(incrementalMs).toBeLessThan(3000);console.info(`1000-record ingestion: ${Math.round(initialMs)}ms; one-record update: ${Math.round(incrementalMs)}ms`);db.close();},30000);
});
