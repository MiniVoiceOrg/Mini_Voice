import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronApi {
  startLanDiscovery: () => Promise<void>;
  stopLanDiscovery: () => Promise<void>;
  onLanDiscoveryFound: (cb: (server: {
    host: string;
    port: number;
    serverName: string;
    version: string;
  }) => void) => void;
  onLanDiscoveryLost: (cb: (server: {
    host: string;
    port: number;
    serverName: string;
    version: string;
  }) => void) => void;
  getClientId: () => Promise<string>;
  maximizeWindow: () => Promise<void>;
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
  selectSoundboardFolder: () => Promise<string | null>;
  listSoundboardSounds: (folderPath: string) => Promise<
    Array<{
      name: string;
      fileName: string;
      filePath: string;
      sizeBytes: number;
      ext: string;
    }>
  >;
  readSoundboardSound: (filePath: string) => Promise<{
    fileName: string;
    soundName: string;
    mimeType: string;
    base64: string;
    dataUrl: string;
    sizeBytes: number;
  } | null>;
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
  probeServer: (
    host: string,
    port: number
  ) => Promise<{ reachable: boolean; reason: 'online' | 'refused' | 'timeout' | 'unreachable' }>;
  screenAudioSupported: () => Promise<boolean>;
  screenAudioStart: () => Promise<{ success: boolean; error?: string }>;
  screenAudioStop: () => Promise<{ success: boolean }>;
  onScreenAudioFrame: (cb: (buffer: ArrayBuffer) => void) => void;
  removeScreenAudioFrameListener: () => void;
  platform: string;
}

const api: ElectronApi = {
  startLanDiscovery: () => ipcRenderer.invoke('lan-discovery-start'),
  stopLanDiscovery: () => ipcRenderer.invoke('lan-discovery-stop'),
  onLanDiscoveryFound: (cb) => ipcRenderer.on('lan-discovery:found', (_e, server) => cb(server)),
  onLanDiscoveryLost: (cb) => ipcRenderer.on('lan-discovery:lost', (_e, server) => cb(server)),
  getClientId: () => ipcRenderer.invoke('get-client-id'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  hostServerStart: (options) => ipcRenderer.invoke('host-server-start', options),
  hostServerStop: () => ipcRenderer.invoke('host-server-stop'),
  hostServerStatus: () => ipcRenderer.invoke('host-server-status'),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  selectImageDialog: () => ipcRenderer.invoke('dialog-select-image'),
  selectSoundboardFolder: () => ipcRenderer.invoke('dialog-select-soundboard-folder'),
  listSoundboardSounds: (folderPath) => ipcRenderer.invoke('soundboard-list-sounds', folderPath),
  readSoundboardSound: (filePath) => ipcRenderer.invoke('soundboard-read-sound', filePath),
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
  probeServer: (host, port) => ipcRenderer.invoke('probe-server', host, port),
  screenAudioSupported: () => ipcRenderer.invoke('screen-audio-supported'),
  screenAudioStart: () => ipcRenderer.invoke('screen-audio-start'),
  screenAudioStop: () => ipcRenderer.invoke('screen-audio-stop'),
  onScreenAudioFrame: (cb) => ipcRenderer.on('screen-audio:frame', (_e, buffer) => cb(buffer)),
  removeScreenAudioFrameListener: () => ipcRenderer.removeAllListeners('screen-audio:frame'),
  platform: process.platform,
};

contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api: ElectronApi;
  }
}
