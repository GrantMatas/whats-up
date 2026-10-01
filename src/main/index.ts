import { app, BrowserWindow, ipcMain, protocol, net, shell, session, powerMonitor, Notification, type IpcMainInvokeEvent } from 'electron';
import { Worker } from 'node:worker_threads';
import { join, resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { LocalDatabase } from '../backend/database';
import { IPC, settingsSchema, radarSchema, idSchema, httpsUrlSchema, scanSchema, type ScanRequest } from '../shared/models';
import { watchAreaSchema } from '../shared/intelligence';
import { automaticScanDue } from '../backend/scheduler/scans';
import { sourceFromResult } from '../backend/discovery/directory';
import { validatePublicUrl, userAgent } from '../backend/collectors/http';
import { PublisherImages } from '../backend/media';

protocol.registerSchemesAsPrivileged([{ scheme: 'whatsup', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const devUrl = process.env.WHATSUP_DEV_URL;
if (devUrl && !/^http:\/\/127\.0\.0\.1:\d{2,5}\/?$/.test(devUrl)) throw new Error('Development origin must be a loopback Vite server');
const appUrl = devUrl || 'whatsup://app/index.html';
const dataDirectory = process.env.WHATSUP_DATA_DIR || app.getPath('userData');
const publisherImages=new PublisherImages();
let database: LocalDatabase;
let window: BrowserWindow | undefined;
let worker: Worker;
let requestId = 0;
const requests = new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
function scan(options: ScanRequest = {}) { worker?.postMessage({type:'scan',options}); return database.getState(); }
function resolveLocation(query: string) {
  return new Promise((resolve,reject)=>{const id=++requestId;const timer=setTimeout(()=>{requests.delete(id);reject(Error('Location lookup timed out. Try again when connected.'));},45000);requests.set(id,{resolve,reject,timer});worker.postMessage({type:'resolve-location',id,query});});
}
let browserActive=false;
async function renderPublicPage(url:string){
  if(browserActive||powerMonitor.isOnBatteryPower())throw Error('Browser fallback deferred to conserve resources');
  await validatePublicUrl(url);browserActive=true;
  const isolated=new BrowserWindow({show:false,webPreferences:{partition:`crawl-${Date.now()}`,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,webviewTag:false,backgroundThrottling:true}});
  const crawlSession=isolated.webContents.session;
  crawlSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));crawlSession.setPermissionCheckHandler(()=>false);
  crawlSession.on('will-download',event=>event.preventDefault());
  crawlSession.webRequest.onBeforeRequest((details,callback)=>{if(details.url==='about:blank')return callback({cancel:false});void validatePublicUrl(details.url).then(()=>callback({cancel:false}),()=>callback({cancel:true}));});
  isolated.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  isolated.webContents.on('will-navigate',(event,target)=>{if(target!==url)event.preventDefault();});
  const timer=setTimeout(()=>{if(!isolated.isDestroyed())isolated.destroy();},18000);
  try{await isolated.loadURL(url,{userAgent});await new Promise(resolve=>setTimeout(resolve,1200));return String(await isolated.webContents.executeJavaScript('document.documentElement.outerHTML')).slice(0,4_000_000);}
  finally{clearTimeout(timer);if(!isolated.isDestroyed())isolated.destroy();await crawlSession.clearStorageData();browserActive=false;}
}
let preloadSecurity = { sandbox: false, contextIsolation: false };
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org; connect-src 'self' https://tile.openstreetmap.org https://*.tile.openstreetmap.org; worker-src 'self' blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-src 'none'; form-action 'none'";
export function isAllowedSender(event: IpcMainInvokeEvent): boolean {
  if (!window || event.sender !== window.webContents || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame) return false;
  const senderUrl = new URL(event.senderFrame.url);
  return devUrl ? senderUrl.origin === new URL(devUrl).origin : senderUrl.protocol === 'whatsup:' && senderUrl.hostname === 'app';
}
function registerIpc() {
  ipcMain.on('whatsup:preload-security', (event, value) => {
    const parsed = z.object({ sandbox: z.boolean(), contextIsolation: z.boolean() }).strict().safeParse(value);
    if (window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && parsed.success) preloadSecurity = parsed.data;
  });
  function handle(channel: string, schema: z.ZodType, action: (value: never) => unknown) {
    ipcMain.handle(channel, (event, value) => {
      if (!isAllowedSender(event)) throw new Error('Untrusted IPC sender');
      return action(schema.parse(value) as never);
    });
  }
  handle(IPC.getState, z.undefined(), () => database.getState());
  handle(IPC.scanDetails,idSchema,value=>{const settings=database.getSettings();return database.intelligence.runDetails(value,settings.location.key||settings.location.name);});
  handle(IPC.sourceHistory,idSchema,value=>database.getSourceHistory(value));
  handle(IPC.saveSettings, settingsSchema, value => { const previous=database.getState().settings;const state=database.saveSettings(value);if(state.settings.onboarded&&!state.settings.demoMode&&(!previous.onboarded||previous.demoMode||previous.location.name!==state.settings.location.name||previous.radiusMiles!==state.settings.radiusMiles)) scan();return state; });
  handle(IPC.toggleSaved, idSchema, value => database.toggleSaved(value));
  handle(IPC.saveRadar, radarSchema, value => {const radar=radarSchema.parse(value);const state=database.saveRadar(radar);if(!state.settings.demoMode&&state.settings.onboarded&&radar.enabled)scan({query:radar.query});return state;});
  handle(IPC.deleteRadar, idSchema, value => database.deleteRadar(value));
  handle(IPC.resetData, z.undefined(), async () => {const state=database.resetData();publisherImages.clear();await session.defaultSession.clearCache();return state;});
  handle(IPC.resetSetup,z.undefined(),()=>database.resetSetup());
  handle(IPC.addSource,httpsUrlSchema,async value=>{await validatePublicUrl(value);const settings=database.getSettings();const source=sourceFromResult({title:new URL(value).hostname,url:value,snippet:'Added by you. Region, advertised feeds and event metadata will be checked; this does not establish trust.'},settings.location);database.upsertSources([source]);scan({mode:'quick'});return database.getState();});
  handle(IPC.saveWatchArea,watchAreaSchema,value=>{database.intelligence.saveWatchArea(value);return database.getState();});
  handle(IPC.deleteWatchArea,idSchema,value=>{database.intelligence.deleteWatchArea(value);return database.getState();});
  handle(IPC.switchWatchArea,idSchema,value=>{const area=database.intelligence.watchAreas().find(a=>a.id===value);if(!area)throw Error('Watch area not found');const state=database.saveSettings({...database.getSettings(),location:area.location,radiusMiles:area.radiusMiles,interests:area.interests,scanning:area.scanning});scan({mode:'smart'});return state;});
  handle(IPC.feedback,z.object({id:idSchema,relevant:z.boolean()}).strict(),value=>{const input=value as {id:string;relevant:boolean};const state=database.getState();if(!state.happenings.some(h=>h.id===input.id))throw Error('Happening not found');database.intelligence.feedback({happeningId:input.id,relevant:input.relevant,at:new Date().toISOString(),locationKey:state.settings.location.key||state.settings.location.name});return database.getState();});
  handle(IPC.openExternal, httpsUrlSchema, async value => { await shell.openExternal(value); });
  handle(IPC.scan, scanSchema.optional(), value => scan(value));
  handle(IPC.resolveLocation, z.string().trim().min(2).max(300), value => resolveLocation(value));
  handle(IPC.search, z.string().trim().max(600), value => database.search(value));
}
async function installProtocol() {
  const root = resolve(__dirname, '../renderer');
  protocol.handle('whatsup', async request => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'app' || request.method !== 'GET') return new Response('Forbidden', { status: 403 });
      const pathname = decodeURIComponent(url.pathname);
      if(pathname==='/event-image'){const imageUrl=url.searchParams.get('url');if(!imageUrl||!database.hasImageUrl(imageUrl))return new Response('Image unavailable',{status:404});try{const image=await publisherImages.get(imageUrl);return new Response(image.bytes as BodyInit,{headers:{'Content-Type':image.contentType,'X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=86400'}});}catch{return new Response('Image unavailable',{status:404});}}
      const target = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!target.startsWith(root + sep) || pathname.includes('\0') || pathname.includes('\\')) return new Response('Forbidden', { status: 403 });
      const response = await net.fetch(pathToFileURL(target).href);
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', csp);
      headers.set('X-Content-Type-Options', 'nosniff');
      const mime: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
      if (mime[extname(target)]) headers.set('Content-Type', mime[extname(target)]);
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response('Asset unavailable', { status: 404 }); }
  });
}
async function captureSmoke(browserWindow:BrowserWindow){
  for(let attempt=0;attempt<3;attempt++){
    await new Promise(resolve=>setTimeout(resolve,500));
    try{return await browserWindow.webContents.capturePage();}catch(error){if(attempt===2)throw error;}
  }
  throw Error('Smoke capture unavailable');
}
async function runSmoke(browserWindow:BrowserWindow,rendererErrors:string[]){
  const output=process.env.WHATSUP_SMOKE_DIR||join(dataDirectory,'smoke');mkdirSync(output,{recursive:true});
  try{browserWindow.webContents.setBackgroundThrottling(false);const state=database.getState();const renderer=await browserWindow.webContents.executeJavaScript(`(async()=>{const initial=await window.whatsup.getState();let rejectsDemo=false;try{await window.whatsup.saveSettings({...initial.settings,demoMode:true});}catch{rejectsDemo=true;}return {noNode:typeof window.require==='undefined',onboarding:!!document.querySelector('.onboarding'),noDemoCapability:!('setDemoMode' in window.whatsup),rejectsDemo};})()`);
    writeFileSync(join(output,'desktop-onboarding.png'),(await captureSmoke(browserWindow)).toPNG());
    const cleanPreferences=state.settings.location.latitude===0&&state.settings.location.longitude===0&&!state.settings.interests.length;
    const report={...renderer,...preloadSecurity,cleanPreferences,initialEmpty:!state.happenings.length&&!state.sources.length&&!state.radars.length,rendererErrors,origin:browserWindow.webContents.getURL(),passed:cleanPreferences&&renderer.noNode&&renderer.onboarding&&renderer.noDemoCapability&&renderer.rejectsDemo&&preloadSecurity.sandbox&&preloadSecurity.contextIsolation&&!state.happenings.length&&rendererErrors.length===0};writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));app.exit(report.passed?0:1);
  }catch(error){writeFileSync(join(output,'report.json'),JSON.stringify({passed:false,error:String(error),rendererErrors},null,2));app.exit(1);}
}
async function runRealSmoke(browserWindow:BrowserWindow,rendererErrors:string[]){
  const output=process.env.WHATSUP_SMOKE_DIR||join(dataDirectory,'real-smoke');mkdirSync(output,{recursive:true});
  browserWindow.webContents.setBackgroundThrottling(false);
  browserWindow.webContents.on('render-process-gone',(_event,details)=>rendererErrors.push('Renderer exited: '+details.reason));
  const evaluate=async(code:string)=>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([browserWindow.webContents.executeJavaScript(code),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('Smoke renderer response timed out')),30000);})]);}finally{if(timer)clearTimeout(timer);}};
  const capture=async(name:string)=>{await new Promise(resolve=>setTimeout(resolve,650));writeFileSync(join(output,name+'.png'),(await captureSmoke(browserWindow)).toPNG());};
  const ready=async(selector:string)=>evaluate(`new Promise((resolve,reject)=>{const start=Date.now();function check(){if(document.querySelector(${JSON.stringify(selector)}))requestAnimationFrame(()=>requestAnimationFrame(resolve));else if(Date.now()-start>15000)reject(Error('UI unavailable: '+${JSON.stringify(selector)}));else setTimeout(check,80);}check();})`);
  try{
    if(!process.env.WHATSUP_QA_REUSE){
    await ready('.onboarding');
    const location=await resolveLocation(process.env.WHATSUP_SMOKE_LOCATION||'Fishers, Indiana');
    const initial=database.getState();database.saveSettings({...initial.settings,onboarded:true,demoMode:false,tutorialCompleted:true,location:location as never,radiusMiles:25});scan({force:true});
    await browserWindow.loadURL(appUrl);await ready('.app-shell');
    await ready('button[aria-label="Open active scan"]');await evaluate(`document.querySelector('button[aria-label="Open active scan"]').click()`);await ready('.scan-dialog');await capture('scan-overlay');await evaluate(`document.querySelector('.scan-heading button').click()`);
    const started=Date.now();let began=false;
    while(Date.now()-started<240000){const state=database.getState();began ||= !!state.engine?.scanning;if(began&&!state.engine?.scanning)break;await new Promise(resolve=>setTimeout(resolve,500));}
    }else await ready('.app-shell');
    console.log('Real smoke: collection complete');
    const state=database.getState();if(!state.happenings.length||state.happenings.some(h=>h.isDemo))throw Error('Real feed is empty or contains fixtures');
    if(!state.happenings.some(h=>h.latitude!==null&&h.longitude!==null))throw Error('No real coordinates collected');
    await ready('[data-map-ready="true"]');
    const sample=state.happenings.find(h=>h.latitude!==null)!;const results=database.search(sample.category);const radar={id:'smoke-radar',name:sample.category,query:sample.category,radiusMiles:25,enabled:true,createdAt:new Date().toISOString()};database.saveRadar(radar);browserWindow.webContents.send(IPC.stateChanged);
    await capture('overview');
    for(const view of ['Map','Discover','Radar','Reports','Sources','Settings']){
      await evaluate(`document.querySelector('button[aria-label="${view}"]').click()`);await ready('.view-'+view.toLowerCase());
      if(['Map','Discover','Reports'].includes(view))await evaluate(`Array.from(document.querySelectorAll('.time-tabs button')).find(button=>button.textContent==='All collected')?.click();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      if(view==='Map')await ready('[data-map-ready="true"]');await capture(view.toLowerCase());
    }
    await evaluate(`document.querySelector('button[aria-label="Discover"]').click()`);await ready('.view-discover');
    await evaluate(`Array.from(document.querySelectorAll('.time-tabs button')).find(button=>button.textContent==='All collected')?.click();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    await evaluate(`document.querySelector('.card-content')?.click()`);await ready('.detail-panel');await capture('detail');
    await evaluate(`document.querySelector('button[aria-label="Close detail"]').click()`);
    const imageRecords=state.happenings.filter(h=>h.images.length);let imageLoaded=false,imageFallback=true;
    if(imageRecords.length){
      const title=imageRecords[0].title;await evaluate(`Array.from(document.querySelectorAll('.event-image-open')).find(button=>button.getAttribute('aria-label')===${JSON.stringify('Open '+title)})?.click()`);await ready('.detail-panel');
      await evaluate(`new Promise(resolve=>{const started=Date.now();function check(){const img=document.querySelector('.detail-event-media img');if(!img||img.complete||Date.now()-started>35000)resolve();else setTimeout(check,100);}check();})`);
      imageLoaded=await evaluate(`Boolean(document.querySelector('.detail-event-media img')?.naturalWidth)`);await capture('publisher-image-detail');
      // Exercise a failed asset through the actual renderer error path without changing stored publisher records.
      for(let attempt=0;attempt<5;attempt++){await evaluate(`(()=>{const img=document.querySelector('.detail-event-media img');if(img)img.src='whatsup://app/event-image?url='+encodeURIComponent('https://example.com/unpublished-qa-image.png');})()`);await new Promise(resolve=>setTimeout(resolve,250));}
      imageFallback=await evaluate(`Boolean(document.querySelector('.detail-event-media .event-image-placeholder'))`);await capture('publisher-image-fallback');await evaluate(`document.querySelector('button[aria-label="Close detail"]').click()`);
    }
    const imageChecks={recordsWithImages:imageRecords.length,detailImageLoaded:imageLoaded,failedAssetPlaceholder:imageFallback};
    const modes=['Feed','Timeline','Calendar','Heatmap','Changes','Topics','Collections','Graph'];
    for(const theme of ['light','dark']){
      const preferences=database.getSettings();database.saveSettings({...preferences,theme:theme as 'light'|'dark'});browserWindow.webContents.send(IPC.stateChanged);await new Promise(resolve=>setTimeout(resolve,350));
      for(const mode of modes){await evaluate(`document.querySelector('button[aria-label="Timeline"]').click()`);await ready('.exploration-modes');await evaluate(`Array.from(document.querySelectorAll('.exploration-modes button')).find(button=>button.textContent===${JSON.stringify(mode)}).click()`);await ready('.view-'+mode.toLowerCase());if(mode==='Heatmap')await ready('[data-map-ready="true"]');await capture(theme+'-'+mode.toLowerCase());}
      for(const mode of ['Overview','Discover','Map','Radar','Reports','Sources','Settings']){await evaluate(`document.querySelector('button[aria-label="${mode}"]').click()`);await ready('.view-'+mode.toLowerCase());await capture(theme+'-'+mode.toLowerCase());}
      await evaluate(`document.querySelector('.scan-history-row').click()`);await ready('.scan-dialog');await capture(theme+'-scan-complete');await evaluate(`document.querySelector('.scan-heading button').click()`);
      await evaluate(`document.querySelector('button[aria-label="Search your area"]').click()`);await ready('.command-dialog');await capture(theme+'-commands');await evaluate(`document.querySelector('button[aria-label="Close palette"]').click()`);
      await evaluate(`document.querySelector('button[aria-label="Sources"]').click()`);await ready('.view-sources .engine-details');await evaluate(`document.querySelector('.engine-details').open=true;document.querySelector('.engine-details').scrollIntoView({block:'center'})`);await capture(theme+'-data-engine');
    }
    await evaluate(`document.querySelector('button[aria-label="Settings"]').click()`);await ready('.view-settings');await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Replay tutorial').click()`);await ready('.tour-panel');
    for(let step=0;step<5;step++){await capture('tutorial-'+(step+1));await evaluate(`document.querySelector('.tour-actions .primary').click()`);}
    const checks=await evaluate(`(async()=>{const s=await window.whatsup.getState();const id=s.happenings[0].id;await window.whatsup.feedback(id,true);await window.whatsup.saveWatchArea({id:'qa-area',name:'QA saved area',location:s.settings.location,radiusMiles:12,interests:s.settings.interests,scanning:s.settings.scanning});const after=await window.whatsup.getState();return {feedback:after.intelligence.feedback.some(f=>f.happeningId===id&&f.relevant),watchArea:after.intelligence.watchAreas.some(a=>a.id==='qa-area'),evidence:after.intelligence.assessments.length>0,history:after.intelligence.history.length>0,scans:after.intelligence.scans.some(run=>run.status==='complete'&&run.mode!=='quick')};})()`);
    await evaluate(`document.querySelector('button[aria-label="Settings"]').click()`);await ready('.view-settings');await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Reset setup').click()`);await ready('[aria-labelledby="setup-reset-title"]');await capture('reset-setup-confirm');await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Reset setup only').click()`);await ready('.onboarding');
    database.saveSettings({...state.settings,tutorialCompleted:true});const preserved=database.getState();const setupPreserved=preserved.happenings.length===state.happenings.length&&preserved.radars.length>0&&preserved.intelligence?.scans.length;
    await browserWindow.loadURL(appUrl);await ready('.app-shell');await evaluate(`document.querySelector('button[aria-label="Settings"]').click()`);await ready('.view-settings');await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Reset workspace')).click()`);await ready('[aria-labelledby="reset-title"]');await capture('reset-everything-confirm');await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Delete local data').click()`);await ready('.onboarding');const reset=database.getState();const fullReset=reset.happenings.length===0&&reset.radars.length===0&&reset.intelligence?.scans.length===0;
    const report={passed:results.length>0&&Object.values(checks).every(Boolean)&&imageFallback&&!!setupPreserved&&fullReset&&rendererErrors.filter(error=>!/tile\.openstreetmap|Failed to fetch|ERR_/i.test(error)).length===0,checks,imageChecks,setupPreserved:!!setupPreserved,fullReset,location:state.settings.location,sources:state.sources.length,records:state.happenings.length,mapped:state.happenings.filter(h=>h.latitude!==null).length,searchResults:results.length,radarMatches:preserved.radarMatches?.length||0,noDemo:true,...preloadSecurity,rendererErrors,origin:browserWindow.webContents.getURL()};
    writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));app.exit(report.passed?0:1);
  }catch(error){writeFileSync(join(output,'report.json'),JSON.stringify({passed:false,error:String(error),rendererErrors},null,2));app.exit(1);}
}
async function createWindow() {
  window = new BrowserWindow({ width: 1440, height: 940, minWidth: 980, minHeight: 680, backgroundColor: '#f6f5f1', icon: join(app.getAppPath(), 'assets/app-icon.png'), title: "What's Up", autoHideMenuBar: true, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  const rendererErrors: string[] = [];
  window.webContents.on('console-message', details => { if (details.level === 'error') rendererErrors.push(details.message); });
  window.once('ready-to-show', () => window?.show());
  await window.loadURL(appUrl);
  if (process.argv.includes('--smoke-test')) await runSmoke(window, rendererErrors);
  if (process.argv.includes('--real-smoke-test')) await runRealSmoke(window,rendererErrors);
}
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  database = new LocalDatabase(join(dataDirectory, 'whats-up.sqlite'));
  database.intelligence.recoverScans();
  database.setEngineState({scanning:false,currentlyChecking:null,currentJob:null});
  worker = new Worker(join(__dirname,'../backend/worker.cjs'),{workerData:{databasePath:join(dataDirectory,'whats-up.sqlite')}});
  let notificationTimer: ReturnType<typeof setTimeout> | undefined;
  worker.on('message',message=>{
    if(message.type==='render-page')void renderPublicPage(message.url).then(html=>worker.postMessage({type:'rendered-page',id:message.id,html}),error=>worker.postMessage({type:'rendered-page',id:message.id,error:String(error)}));
    if(message.type==='ready'){worker.postMessage({type:'power',onBattery:powerMonitor.isOnBatteryPower()});const settings=database.getSettings();if(!process.argv.some(arg=>/smoke-test|audit-test/.test(arg))&&(settings.scanning.onOpen||automaticScanDue(settings,database.intelligence.runs(settings.location.key||settings.location.name))))scan({mode:'smart',origin:'startup'});}
    if(message.type==='scan-complete'){const settings=database.getSettings();if(settings.notifications.enabled&&Notification.isSupported()){const state=database.getState();const radar=state.radarMatches?.filter(m=>m.isNew).length||0;const important=message.alerts||0;const changed=message.updated||0;const parts=[settings.notifications.radar&&radar?`${radar} new Radar matches`:null,settings.notifications.alerts&&important?`${important} important local alerts`:null,settings.notifications.changes&&changed?`${changed} changed discoveries`:null].filter(Boolean);if(parts.length){const notification=new Notification({title:"What's Up · Local scan",body:parts.join(' · '),silent:true});notification.on('click',()=>{window?.show();window?.focus();});notification.show();}}}
    if(message.type==='state-changed'&&!notificationTimer)notificationTimer=setTimeout(()=>{notificationTimer=undefined;if(window&&!window.isDestroyed())window.webContents.send(IPC.stateChanged);},250);
    if(message.type==='response'){const request=requests.get(message.id);if(request){clearTimeout(request.timer);requests.delete(message.id);message.error?request.reject(Error(message.error)):request.resolve(message.result);}}
  });
  worker.on('error',error=>{database.setEngineState({scanning:false,phase:'Unavailable',error:error.message});window?.webContents.send(IPC.stateChanged);for(const request of requests.values()){clearTimeout(request.timer);request.reject(error);}requests.clear();});
  powerMonitor.on('on-battery',()=>worker.postMessage({type:'power',onBattery:true}));
  powerMonitor.on('on-ac',()=>worker.postMessage({type:'power',onBattery:false}));
  const scheduler=setInterval(()=>{const settings=database.getSettings();const runs=database.intelligence.runs(settings.location.key||settings.location.name);if(database.getEngineState().scanning)return;if(automaticScanDue(settings,runs))scan({mode:'smart',origin:'scheduled'});else if(settings.onboarded&&!settings.demoMode&&settings.scanning.enabled&&database.getDueSources().length)scan({mode:'quick',origin:'scheduled'});},60000);scheduler.unref();
  await installProtocol(); registerIpc(); await createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
}).catch(error => { console.error('Application launch failed:', error); app.exit(1); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => {void worker?.terminate();database?.close();});
