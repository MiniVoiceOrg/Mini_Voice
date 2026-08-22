"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const api = {
    getClientId: () => electron_1.ipcRenderer.invoke('get-client-id'),
    hostServerStart: (options) => electron_1.ipcRenderer.invoke('host-server-start', options),
    hostServerStop: () => electron_1.ipcRenderer.invoke('host-server-stop'),
    hostServerStatus: () => electron_1.ipcRenderer.invoke('host-server-status'),
    getDesktopSources: () => electron_1.ipcRenderer.invoke('get-desktop-sources'),
    selectImageDialog: () => electron_1.ipcRenderer.invoke('dialog-select-image'),
    selectSoundboardFolder: () => electron_1.ipcRenderer.invoke('dialog-select-soundboard-folder'),
    listSoundboardSounds: (folderPath) => electron_1.ipcRenderer.invoke('soundboard-list-sounds', folderPath),
    readSoundboardSound: (filePath) => electron_1.ipcRenderer.invoke('soundboard-read-sound', filePath),
    minimize: () => electron_1.ipcRenderer.invoke('window-minimize'),
    maximize: () => electron_1.ipcRenderer.invoke('window-maximize'),
    close: () => electron_1.ipcRenderer.invoke('window-close'),
    getAppVersion: () => electron_1.ipcRenderer.invoke('get-app-version'),
    checkForUpdates: () => electron_1.ipcRenderer.invoke('update-check'),
    downloadUpdate: () => electron_1.ipcRenderer.invoke('update-download'),
    installUpdate: () => electron_1.ipcRenderer.invoke('update-install'),
    onUpdateProgress: (cb) => electron_1.ipcRenderer.on('update:progress', (_e, percent) => cb(percent)),
    onUpdateDownloaded: (cb) => electron_1.ipcRenderer.on('update:downloaded', (_e, info) => cb(info)),
    onUpdateError: (cb) => electron_1.ipcRenderer.on('update:error', (_e, message) => cb(message)),
    openExternal: (url) => electron_1.ipcRenderer.invoke('open-external', url),
    probeServer: (host, port) => electron_1.ipcRenderer.invoke('probe-server', host, port),
    platform: process.platform,
};
electron_1.contextBridge.exposeInMainWorld('api', api);
//# sourceMappingURL=preload.js.map