import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type WhatsUpBridge } from '../shared/models';

const bridge: WhatsUpBridge = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  scanDetails: id => ipcRenderer.invoke(IPC.scanDetails,id),
  sourceHistory: id => ipcRenderer.invoke(IPC.sourceHistory,id),
  saveSettings: settings => ipcRenderer.invoke(IPC.saveSettings, settings),
  toggleSaved: id => ipcRenderer.invoke(IPC.toggleSaved, id),
  saveRadar: radar => ipcRenderer.invoke(IPC.saveRadar, radar),
  deleteRadar: id => ipcRenderer.invoke(IPC.deleteRadar, id),
  resetData: () => ipcRenderer.invoke(IPC.resetData),
  resetSetup: () => ipcRenderer.invoke(IPC.resetSetup),
  addSource: url => ipcRenderer.invoke(IPC.addSource,url),
  saveWatchArea: area => ipcRenderer.invoke(IPC.saveWatchArea,area),
  deleteWatchArea: id => ipcRenderer.invoke(IPC.deleteWatchArea,id),
  switchWatchArea: id => ipcRenderer.invoke(IPC.switchWatchArea,id),
  feedback: (id,relevant) => ipcRenderer.invoke(IPC.feedback,{id,relevant}),
  openExternal: url => ipcRenderer.invoke(IPC.openExternal, url),
  scan: options => ipcRenderer.invoke(IPC.scan, options),
  resolveLocation: query => ipcRenderer.invoke(IPC.resolveLocation, query),
  search: query => ipcRenderer.invoke(IPC.search, query),
  onStateChanged: callback => {
    const listener = () => { void ipcRenderer.invoke(IPC.getState).then(callback); };
    ipcRenderer.on(IPC.stateChanged, listener);
    return () => ipcRenderer.removeListener(IPC.stateChanged, listener);
  },
};
contextBridge.exposeInMainWorld('whatsup', Object.freeze(bridge));
ipcRenderer.send('whatsup:preload-security', { sandbox: process.sandboxed, contextIsolation: process.contextIsolated });
