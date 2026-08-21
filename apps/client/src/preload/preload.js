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
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    checkForUpdates: () => ipcRenderer.invoke('update-check'),
    downloadUpdate: () => ipcRenderer.invoke('update-download'),
    installUpdate: () => ipcRenderer.invoke('update-install'),
    onUpdateProgress: (cb) => ipcRenderer.on('update:progress', (_e, percent) => cb(percent)),
    onUpdateDownloaded: (cb) => ipcRenderer.on('update:downloaded', (_e, info) => cb(info)),
    onUpdateError: (cb) => ipcRenderer.on('update:error', (_e, message) => cb(message)),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    platform: process.platform,
};
contextBridge.exposeInMainWorld('api', api);
//# sourceMappingURL=preload.js.map