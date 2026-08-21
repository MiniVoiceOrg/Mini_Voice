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
      thumbnailDataUrl: string;
      appIconDataUrl: string | null;
    }>
  >;
  selectImageDialog: () => Promise<{ fileName: string; mimeType: string; base64: string } | null>;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<{
    ok: boolean;
    tag?: string;
    name?: string;
    htmlUrl?: string;
    publishedAt?: string;
    assets?: Array<{ name: string; url: string }>;
    error?: string;
  }>;
  openExternal: (url: string) => Promise<{ success: boolean }>;
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
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
};

contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api: ElectronApi;
  }
}
