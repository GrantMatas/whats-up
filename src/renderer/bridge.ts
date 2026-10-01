import { settingsSchema, type AppState, type WhatsUpBridge } from '../shared/models';
import { defaultSettings } from '../shared/defaults';
import { matchesIntent, parseIntent } from '../backend/search/intent';
declare global { interface Window { whatsup?: WhatsUpBridge } }
const key='whatsup-browser-preview-v2';
function initial():AppState {try{const cached=localStorage.getItem(key);if(cached){const parsed=JSON.parse(cached);return {...parsed,settings:settingsSchema.parse(parsed.settings)};}}catch{}return {settings:structuredClone(defaultSettings),happenings:[],radars:[],savedIds:[],sources:[]};}
let state=initial();
const listeners=new Set<(state:AppState)=>void>();
function persist(){localStorage.setItem(key,JSON.stringify(state));const result=structuredClone(state);for(const callback of listeners)callback(result);return result;}
const preview:WhatsUpBridge={
async getState(){return structuredClone(state);},
async scanDetails(id){const run=state.intelligence?.scans.find(run=>run.id===id);if(!run)throw Error('Scan not found');return {run,tasks:state.intelligence?.tasks.filter(task=>task.runId===id)||[]};},
async sourceHistory(){return [];},
async saveSettings(settings){state.settings=settingsSchema.parse(settings);return persist();},
async toggleSaved(id){state.savedIds=state.savedIds.includes(id)?state.savedIds.filter(x=>x!==id):[...state.savedIds,id];return persist();},
async saveRadar(radar){state.radars=[...state.radars.filter(x=>x.id!==radar.id),radar];return persist();},
async deleteRadar(id){state.radars=state.radars.filter(x=>x.id!==id);return persist();},
async resetData(){localStorage.removeItem(key);state={settings:structuredClone(defaultSettings),happenings:[],sources:[],radars:[],savedIds:[]};return persist();},
async resetSetup(){state.settings={...structuredClone(defaultSettings),theme:state.settings.theme};return persist();},
async addSource(){throw Error('Source analysis runs in the desktop application.');},
async saveWatchArea(area){state.intelligence??=emptyIntelligence();state.intelligence.watchAreas=[...state.intelligence.watchAreas.filter(a=>a.id!==area.id),area];return persist();},
async deleteWatchArea(id){if(state.intelligence)state.intelligence.watchAreas=state.intelligence.watchAreas.filter(a=>a.id!==id);return persist();},
async switchWatchArea(id){const area=state.intelligence?.watchAreas.find(a=>a.id===id);if(!area)throw Error('Watch area not found');state.settings={...state.settings,location:area.location,radiusMiles:area.radiusMiles,interests:area.interests,scanning:area.scanning};return persist();},
async feedback(id,relevant){state.intelligence??=emptyIntelligence();state.intelligence.feedback=[...state.intelligence.feedback.filter(f=>f.happeningId!==id),{happeningId:id,relevant,at:new Date().toISOString(),locationKey:state.settings.location.key||state.settings.location.name}];return persist();},
async openExternal(url){const parsed=new URL(url);if(parsed.protocol!=='https:')throw Error('Only public HTTPS links are supported.');window.open(url,'_blank','noopener,noreferrer');},
async scan(){throw Error('Run the desktop application for the local ingestion worker. Browser previews cannot crawl public sources.');},
async resolveLocation(){throw Error('Location lookup runs in the desktop application.');},
async search(query){return state.happenings.filter(h=>matchesIntent(h,parseIntent(query),state.settings.location,state.settings.radiusMiles,new Date().toISOString()));},
onStateChanged(callback){listeners.add(callback);return()=>listeners.delete(callback);},
};
export const bridge=window.whatsup??preview;
export const isPreview=!window.whatsup;
function emptyIntelligence():NonNullable<AppState['intelligence']>{return {scans:[],tasks:[],assessments:[],history:[],watchAreas:[],feedback:[],coverage:{score:0,categories:[],assessedAt:new Date().toISOString(),explanation:'Desktop source checks are required.'},relationships:[],sourceRelationships:[],pulse:[]};}
