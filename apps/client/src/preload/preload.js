import { contextBridge, ipcRenderer } from 'electron';
const api = {
    getClientId: () => ipcRenderer.invoke('get-client-id'),
    hostServerStart: (options) => ipcRenderer.invoke('host-server-start', options),
    hostServerStop: () => ipcRenderer.invoke('host-server-stop'),
    hostServerStatus: () => ipcRenderer.invoke('host-server-status'),
    getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
    selectImageDialog: () => ipcRenderer.invoke('dialog-select-image'),
    minimize: () => ipcRenderer.invoke('window-minimize'),
    maximize: () => ipcRenderer.invoke('window-maximize'),
    close: () => ipcRenderer.invoke('window-close'),
};
contextBridge.exposeInMainWorld('api', api);
//# sourceMappingURL=preload.js.map