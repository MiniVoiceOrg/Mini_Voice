import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronApi {
  getClientId: () => Promise<string>;
  hostServerStart: (options: {
    port: number;
    serverName: string;
    password?: string;
    initialVoiceChannel?: string;
    initialTextChannel?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  hostServerStop: () => Promise<{ success: boolean }>;
  hostServerStatus: () => Promise<{ isRunning: boolean }>;
  getDesktopSources: () => Promise<
    Array<{
      id: string;
      name: string;
      type: 'screen' | 'window';
      thumbnailDataUrl: string;
      appIconDataUrl: string | null;
    }>
  >;
  selectImageDialog: () => Promise<{ fileName: string; mimeType: string; base64: string } | null>;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<{ ok: boolean; available?: boolean; version?: string; error?: string }>;
  downloadUpdate: () => Promise<{ ok: boolean; error?: string }>;
  installUpdate: () => Promise<{ ok: boolean; error?: string }>;
  onUpdateProgress: (cb: (percent: number) => void) => void;
  onUpdateDownloaded: (cb: (info: { manual: boolean }) => void) => void;
  onUpdateError: (cb: (message: string) => void) => void;
  openExternal: (url: string) => Promise<{ success: boolean }>;
  platform: string;
}

const api: ElectronApi = {
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

declare global {
  interface Window {
    api: ElectronApi;
  }
}
