import type { AppSettings } from './models';
import { defaultScanning, defaultConfidenceWeights } from './intelligence';
import { categories } from './models';
export const defaultSettings: AppSettings = {
  onboarded: false, location: { name: 'Choose an area', latitude: 0, longitude: 0, timezone: 'UTC' }, radiusMiles: 25,
  interests: [], theme: 'light', density: 'comfortable', motion: true, demoMode: false, defaultView: 'overview',
  sourceTypes:['OFFICIAL','CONFIRMED','NEWS','ORGANIZATION','COMMUNITY','UNVERIFIED'],chartDays:7,
  scanning: {...defaultScanning}, tutorialCompleted:false, notifications:{enabled:false,radar:true,alerts:true,changes:true}, visibleCategories:[...categories], mapStyle:'streets', timelineDensity:'day', homeModules:['pulse','activity','coverage','discoveries'], confidenceWeights:{...defaultConfidenceWeights},
};
