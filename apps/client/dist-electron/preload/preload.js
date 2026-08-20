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
    minimize: () => electron_1.ipcRenderer.invoke('window-minimize'),
    maximize: () => electron_1.ipcRenderer.invoke('window-maximize'),
    close: () => electron_1.ipcRenderer.invoke('window-close'),
};
electron_1.contextBridge.exposeInMainWorld('api', api);
//# sourceMappingURL=preload.js.map