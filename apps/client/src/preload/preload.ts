import { contextBridge, ipcRenderer } from 'electron';
import type {
  ActionShortcutBinding,
  AppIdentityResult,
  DesktopSource,
  DiscoveredLanServer,
  HostServerOptions,
  ImageSelectionResult,
  LinkPreviewData,
  LogEntry,
  ScreenAudioDiagnostics,
  ServerProbeResult,
  ServerStats,
  SoundboardShortcutBinding,
  SoundboardSoundData,
  SoundboardSoundEntry,
  TrayVoiceStatus,
  UpdateCheckResult,
  UpdateSimpleResult,
} from '@monky/shared';

export type { LinkPreviewData } from '@monky/shared';

export interface ElectronApi {
  startLanDiscovery: () => Promise<void>;
  stopLanDiscovery: () => Promise<void>;
  onLanDiscoveryFound: (cb: (server: DiscoveredLanServer) => void) => () => void;
  onLanDiscoveryLost: (cb: (server: DiscoveredLanServer) => void) => () => void;
  setLanguage: (language: string) => Promise<void>;
  hasIdentity: () => Promise<boolean>;
  getIdentity: () => Promise<AppIdentityResult>;
  getClientId: () => Promise<string>;
  signChallenge: (nonceHex: string) => Promise<string>;
  exportIdentity: (password: string) => Promise<string>;
  importIdentity: (exportedIdentity: string, password: string) => Promise<AppIdentityResult>;
  hostServerStart: (options: HostServerOptions) => Promise<{ success: boolean; error?: string }>;
  hostServerStop: () => Promise<{ success: boolean }>;
  hostServerStatus: () => Promise<{ isRunning: boolean; port: number | null; serverId: string | null }>;
  hostServerLogs: () => Promise<LogEntry[]>;
  hostServerClearLogs: () => Promise<void>;
  hostServerStats: () => Promise<ServerStats | null>;
  onHostServerLog: (callback: (entry: LogEntry) => void) => () => void;
  getDesktopSources: () => Promise<DesktopSource[]>;
  selectImageDialog: () => Promise<ImageSelectionResult | null>;
  selectSoundFile: () => Promise<string | null>;
  selectSoundboardFolder: () => Promise<string | null>;
  listSoundboardSounds: (folderPath: string) => Promise<SoundboardSoundEntry[]>;
  readSoundboardSound: (filePath: string) => Promise<SoundboardSoundData | null>;
  registerSoundboardShortcuts: (shortcuts: SoundboardShortcutBinding[]) => Promise<boolean>;
  onSoundboardShortcutTriggered: (cb: (soundName: string) => void) => () => void;
  registerActionShortcuts: (shortcuts: ActionShortcutBinding[]) => Promise<boolean>;
  onActionShortcutTriggered: (cb: (action: string) => void) => () => void;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  downloadUpdate: () => Promise<UpdateSimpleResult>;
  installUpdate: () => Promise<UpdateSimpleResult>;
  setUpdateChannel: (allowBeta: boolean) => Promise<UpdateSimpleResult>;
  onUpdateProgress: (cb: (percent: number) => void) => () => void;
  onUpdateDownloaded: (cb: (info: { manual: boolean }) => void) => () => void;
  onUpdateError: (cb: (message: string) => void) => () => void;
  openExternal: (url: string) => Promise<{ success: boolean }>;
  fetchLinkPreview: (url: string) => Promise<LinkPreviewData | null>;
  downloadFile: (url: string, fileName: string) => Promise<{ success: boolean; error?: string }>;
  probeServer: (host: string, port: number) => Promise<ServerProbeResult>;
  screenAudioSupported: () => Promise<boolean>;
  screenAudioDiagnose: () => Promise<ScreenAudioDiagnostics>;
  screenAudioStart: (sourceId?: string) => Promise<{ success: boolean; error?: string }>;
  screenAudioStop: () => Promise<{ success: boolean }>;
  onScreenAudioFrame: (cb: (buffer: ArrayBuffer | Uint8Array) => void) => () => void;
  removeScreenAudioFrameListener: () => void;
  updateTrayVoiceStatus: (status: TrayVoiceStatus) => Promise<void>;
  onTrayToggleMute: (cb: () => void) => () => void;
  onTrayToggleDeafen: (cb: () => void) => () => void;
  getAutoStart: () => Promise<boolean>;
  setAutoStart: (enabled: boolean) => Promise<void>;
  setMinimizeToTray: (enabled: boolean) => Promise<void>;
  platform: string;
}

const api: ElectronApi = {
  startLanDiscovery: () => ipcRenderer.invoke('lan:start'),
  stopLanDiscovery: () => ipcRenderer.invoke('lan:stop'),
  onLanDiscoveryFound: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, server: DiscoveredLanServer) => cb(server);
    ipcRenderer.on('lan:found', listener);
    return () => {
      ipcRenderer.removeListener('lan:found', listener);
    };
  },
  onLanDiscoveryLost: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, server: DiscoveredLanServer) => cb(server);
    ipcRenderer.on('lan:lost', listener);
    return () => {
      ipcRenderer.removeListener('lan:lost', listener);
    };
  },
  setLanguage: (language) => ipcRenderer.invoke('app:set-language', language),
  hasIdentity: () => ipcRenderer.invoke('identity:has'),
  getIdentity: () => ipcRenderer.invoke('identity:get'),
  getClientId: () => ipcRenderer.invoke('identity:get-client-id'),
  signChallenge: (nonceHex) => ipcRenderer.invoke('identity:sign-challenge', nonceHex),
  exportIdentity: (password) => ipcRenderer.invoke('identity:export', password),
  importIdentity: (exportedIdentity, password) => ipcRenderer.invoke('identity:import', exportedIdentity, password),
  hostServerStart: (options) => ipcRenderer.invoke('server-host:start', options),
  hostServerStop: () => ipcRenderer.invoke('server-host:stop'),
  hostServerStatus: () => ipcRenderer.invoke('server-host:status'),
  hostServerLogs: () => ipcRenderer.invoke('server-host:logs'),
  hostServerClearLogs: () => ipcRenderer.invoke('server-host:clear-logs'),
  hostServerStats: () => ipcRenderer.invoke('server-host:stats'),
  onHostServerLog: (callback) => {
    const listener = (_event: unknown, entry: LogEntry) => callback(entry);
    ipcRenderer.on('server-host:log', listener);
    return () => ipcRenderer.removeListener('server-host:log', listener);
  },
  getDesktopSources: () => ipcRenderer.invoke('screen-share:get-sources'),
  selectImageDialog: () => ipcRenderer.invoke('dialog:select-image'),
  selectSoundFile: () => ipcRenderer.invoke('dialog:select-sound-file'),
  selectSoundboardFolder: () => ipcRenderer.invoke('dialog:select-soundboard-folder'),
  listSoundboardSounds: (folderPath) => ipcRenderer.invoke('soundboard:list-sounds', folderPath),
  readSoundboardSound: (filePath) => ipcRenderer.invoke('soundboard:read-sound', filePath),
  registerSoundboardShortcuts: (shortcuts) => ipcRenderer.invoke('soundboard:register-shortcuts', shortcuts),
  onSoundboardShortcutTriggered: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, soundName: string) => cb(soundName);
    ipcRenderer.on('soundboard:shortcut-triggered', listener);
    return () => {
      ipcRenderer.removeListener('soundboard:shortcut-triggered', listener);
    };
  },
  registerActionShortcuts: (shortcuts) => ipcRenderer.invoke('shortcuts:register-actions', shortcuts),
  onActionShortcutTriggered: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, action: string) => cb(action);
    ipcRenderer.on('shortcut:action-triggered', listener);
    return () => {
      ipcRenderer.removeListener('shortcut:action-triggered', listener);
    };
  },
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  setUpdateChannel: (allowBeta) => ipcRenderer.invoke('updater:set-channel', allowBeta),
  onUpdateProgress: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, percent: number) => cb(percent);
    ipcRenderer.on('updater:progress', listener);
    return () => {
      ipcRenderer.removeListener('updater:progress', listener);
    };
  },
  onUpdateDownloaded: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, info: { manual: boolean }) => cb(info);
    ipcRenderer.on('updater:downloaded', listener);
    return () => {
      ipcRenderer.removeListener('updater:downloaded', listener);
    };
  },
  onUpdateError: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, message: string) => cb(message);
    ipcRenderer.on('updater:error', listener);
    return () => {
      ipcRenderer.removeListener('updater:error', listener);
    };
  },
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  fetchLinkPreview: (url) => ipcRenderer.invoke('link-preview:fetch', url),
  downloadFile: (url, fileName) => ipcRenderer.invoke('app:download-file', url, fileName),
  probeServer: (host, port) => ipcRenderer.invoke('net:probe-server', host, port),
  screenAudioSupported: () => ipcRenderer.invoke('screen-audio:is-supported'),
  screenAudioDiagnose: () => ipcRenderer.invoke('screen-audio:diagnose'),
  screenAudioStart: (sourceId) => ipcRenderer.invoke('screen-audio:start', sourceId),
  screenAudioStop: () => ipcRenderer.invoke('screen-audio:stop'),
  onScreenAudioFrame: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, buffer: ArrayBuffer | Uint8Array) => cb(buffer);
    ipcRenderer.on('screen-audio:frame', listener);
    return () => {
      ipcRenderer.removeListener('screen-audio:frame', listener);
    };
  },
  removeScreenAudioFrameListener: () => ipcRenderer.removeAllListeners('screen-audio:frame'),
  updateTrayVoiceStatus: (status) => ipcRenderer.invoke('tray:update-voice-status', status),
  onTrayToggleMute: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('tray:toggle-mute', listener);
    return () => {
      ipcRenderer.removeListener('tray:toggle-mute', listener);
    };
  },
  onTrayToggleDeafen: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('tray:toggle-deafen', listener);
    return () => {
      ipcRenderer.removeListener('tray:toggle-deafen', listener);
    };
  },
  getAutoStart: () => ipcRenderer.invoke('app:get-auto-start'),
  setAutoStart: (enabled: boolean) => ipcRenderer.invoke('app:set-auto-start', enabled),
  setMinimizeToTray: (enabled: boolean) => ipcRenderer.invoke('app:set-minimize-to-tray', enabled),
  platform: process.platform,
};

contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api: ElectronApi;
  }
}
