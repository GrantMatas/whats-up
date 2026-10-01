import {it,expect} from 'vitest';
import {belongsToArea,currentPublicRecord} from '../src/backend/normalization/locality';
import {testHappenings,testSources} from './fixtures/test-records';
const location={name:'Seattle, Washington, US',latitude:47.6062,longitude:-122.3321};
it('excludes distant events and unknown statewide records from a local feed',()=>{
 const item={...testHappenings[0],isDemo:false};expect(belongsToArea(item,testSources[0],location,25)).toBe(false);
 const unknown={...item,latitude:null,longitude:null,geometry:null,geometryType:null,summary:'An unrelated statewide event',title:'Community gathering',locationName:'Not provided',address:''};expect(belongsToArea(unknown,{...testSources[0],notes:'Statewide directory'},location,25)).toBe(false);
 expect(belongsToArea({...unknown,title:'Seattle community gathering'},testSources[0],location,25)).toBe(true);
 expect(belongsToArea(unknown,{...testSources[0],notes:'Verified regional organization.'},location,25)).toBe(true);
});
it('retains recent announcements without pretending old ones are current',()=>{
 const item={...testHappenings[0],startTime:null,endTime:null,publishedAt:'2020-01-01T00:00:00.000Z'};expect(currentPublicRecord(item,'2026-09-30T12:00:00.000Z')).toBe(false);expect(currentPublicRecord({...item,publishedAt:null},'2026-09-30T12:00:00.000Z')).toBe(true);
});
