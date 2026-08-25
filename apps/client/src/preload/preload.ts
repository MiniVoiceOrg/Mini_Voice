import { contextBridge, ipcRenderer } from 'electron';

export interface LinkPreviewData {
  url: string;
  title: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
}

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
  setLanguage: (language: string) => Promise<void>;
  hasIdentity: () => Promise<boolean>;
  getIdentity: () => Promise<{ publicKey: string; clientId: string }>;
  getClientId: () => Promise<string>;
  signChallenge: (nonceHex: string) => Promise<string>;
  exportIdentity: (password: string) => Promise<string>;
  importIdentity: (exportedIdentity: string, password: string) => Promise<{ publicKey: string; clientId: string }>;
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
  selectSoundFile: () => Promise<string | null>;
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
  registerSoundboardShortcuts: (shortcuts: Array<{ soundName: string; accelerator: string }>) => Promise<boolean>;
  onSoundboardShortcutTriggered: (cb: (soundName: string) => void) => () => void;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<{ ok: boolean; available?: boolean; version?: string; error?: string }>;
  downloadUpdate: () => Promise<{ ok: boolean; error?: string }>;
  installUpdate: () => Promise<{ ok: boolean; error?: string }>;
  setUpdateChannel: (allowBeta: boolean) => Promise<{ ok: boolean; error?: string }>;
  onUpdateProgress: (cb: (percent: number) => void) => void;
  onUpdateDownloaded: (cb: (info: { manual: boolean }) => void) => void;
  onUpdateError: (cb: (message: string) => void) => void;
  openExternal: (url: string) => Promise<{ success: boolean }>;
  fetchLinkPreview: (url: string) => Promise<LinkPreviewData | null>;
  downloadFile: (url: string, fileName: string) => Promise<{ success: boolean; error?: string }>;
  probeServer: (
    host: string,
    port: number
  ) => Promise<{ reachable: boolean; reason: 'online' | 'refused' | 'timeout' | 'unreachable' }>;
  screenAudioSupported: () => Promise<boolean>;
  screenAudioDiagnose: () => Promise<{ nativeModuleLoaded: boolean; platformSupported: boolean; osVersion: string; pid: number }>;
  screenAudioStart: (sourceId?: string) => Promise<{ success: boolean; error?: string }>;
  screenAudioStop: () => Promise<{ success: boolean }>;
  onScreenAudioFrame: (cb: (buffer: ArrayBuffer) => void) => void;
  removeScreenAudioFrameListener: () => void;
  updateTrayVoiceStatus: (status: {
    inCall: boolean;
    isMuted: boolean;
    isDeafened: boolean;
    isSpeaking: boolean;
  }) => Promise<void>;
  onTrayToggleMute: (cb: () => void) => () => void;
  onTrayToggleDeafen: (cb: () => void) => () => void;
  platform: string;
}

const api: ElectronApi = {
  startLanDiscovery: () => ipcRenderer.invoke('lan-discovery-start'),
  stopLanDiscovery: () => ipcRenderer.invoke('lan-discovery-stop'),
  onLanDiscoveryFound: (cb) => ipcRenderer.on('lan-discovery:found', (_e, server) => cb(server)),
  onLanDiscoveryLost: (cb) => ipcRenderer.on('lan-discovery:lost', (_e, server) => cb(server)),
  setLanguage: (language) => ipcRenderer.invoke('app-set-language', language),
  hasIdentity: () => ipcRenderer.invoke('has-identity'),
  getIdentity: () => ipcRenderer.invoke('get-identity'),
  getClientId: () => ipcRenderer.invoke('get-client-id'),
  signChallenge: (nonceHex) => ipcRenderer.invoke('sign-challenge', nonceHex),
  exportIdentity: (password) => ipcRenderer.invoke('export-identity', password),
  importIdentity: (exportedIdentity, password) => ipcRenderer.invoke('import-identity', exportedIdentity, password),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  hostServerStart: (options) => ipcRenderer.invoke('host-server-start', options),
  hostServerStop: () => ipcRenderer.invoke('host-server-stop'),
  hostServerStatus: () => ipcRenderer.invoke('host-server-status'),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  selectImageDialog: () => ipcRenderer.invoke('dialog-select-image'),
  selectSoundFile: () => ipcRenderer.invoke('dialog-select-sound-file'),
  selectSoundboardFolder: () => ipcRenderer.invoke('dialog-select-soundboard-folder'),
  listSoundboardSounds: (folderPath) => ipcRenderer.invoke('soundboard-list-sounds', folderPath),
  readSoundboardSound: (filePath) => ipcRenderer.invoke('soundboard-read-sound', filePath),
  registerSoundboardShortcuts: (shortcuts) => ipcRenderer.invoke('soundboard-register-shortcuts', shortcuts),
  onSoundboardShortcutTriggered: (cb) => {
    const listener = (_e: any, soundName: string) => cb(soundName);
    ipcRenderer.on('soundboard-shortcut-triggered', listener);
    return () => ipcRenderer.removeListener('soundboard-shortcut-triggered', listener);
  },
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  downloadUpdate: () => ipcRenderer.invoke('update-download'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  setUpdateChannel: (allowBeta) => ipcRenderer.invoke('update-set-channel', allowBeta),
  onUpdateProgress: (cb) => ipcRenderer.on('update:progress', (_e, percent) => cb(percent)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update:downloaded', (_e, info) => cb(info)),
  onUpdateError: (cb) => ipcRenderer.on('update:error', (_e, message) => cb(message)),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  fetchLinkPreview: (url) => ipcRenderer.invoke('fetch-link-preview', url),
  downloadFile: (url, fileName) => ipcRenderer.invoke('download-file', url, fileName),
  probeServer: (host, port) => ipcRenderer.invoke('probe-server', host, port),
  screenAudioSupported: () => ipcRenderer.invoke('screen-audio-supported'),
  screenAudioDiagnose: () => ipcRenderer.invoke('screen-audio-diagnose'),
  screenAudioStart: (sourceId) => ipcRenderer.invoke('screen-audio-start', sourceId),
  screenAudioStop: () => ipcRenderer.invoke('screen-audio-stop'),
  onScreenAudioFrame: (cb) => ipcRenderer.on('screen-audio:frame', (_e, buffer) => cb(buffer)),
  removeScreenAudioFrameListener: () => ipcRenderer.removeAllListeners('screen-audio:frame'),
  updateTrayVoiceStatus: (status) => ipcRenderer.invoke('tray:update-voice-status', status),
  onTrayToggleMute: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('tray:toggle-mute', listener);
    return () => ipcRenderer.removeListener('tray:toggle-mute', listener);
  },
  onTrayToggleDeafen: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('tray:toggle-deafen', listener);
    return () => ipcRenderer.removeListener('tray:toggle-deafen', listener);
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api: ElectronApi;
  }
}
