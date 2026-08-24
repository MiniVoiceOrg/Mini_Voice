"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const api = {
    startLanDiscovery: () => electron_1.ipcRenderer.invoke('lan-discovery-start'),
    stopLanDiscovery: () => electron_1.ipcRenderer.invoke('lan-discovery-stop'),
    onLanDiscoveryFound: (cb) => electron_1.ipcRenderer.on('lan-discovery:found', (_e, server) => cb(server)),
    onLanDiscoveryLost: (cb) => electron_1.ipcRenderer.on('lan-discovery:lost', (_e, server) => cb(server)),
    getClientId: () => electron_1.ipcRenderer.invoke('get-client-id'),
    maximizeWindow: () => electron_1.ipcRenderer.invoke('window:maximize'),
    hostServerStart: (options) => electron_1.ipcRenderer.invoke('host-server-start', options),
    hostServerStop: () => electron_1.ipcRenderer.invoke('host-server-stop'),
    hostServerStatus: () => electron_1.ipcRenderer.invoke('host-server-status'),
    getDesktopSources: () => electron_1.ipcRenderer.invoke('get-desktop-sources'),
    selectImageDialog: () => electron_1.ipcRenderer.invoke('dialog-select-image'),
    selectSoundFile: () => electron_1.ipcRenderer.invoke('dialog-select-sound-file'),
    selectSoundboardFolder: () => electron_1.ipcRenderer.invoke('dialog-select-soundboard-folder'),
    listSoundboardSounds: (folderPath) => electron_1.ipcRenderer.invoke('soundboard-list-sounds', folderPath),
    readSoundboardSound: (filePath) => electron_1.ipcRenderer.invoke('soundboard-read-sound', filePath),
    registerSoundboardShortcuts: (shortcuts) => electron_1.ipcRenderer.invoke('soundboard-register-shortcuts', shortcuts),
    onSoundboardShortcutTriggered: (cb) => {
        const listener = (_e, soundName) => cb(soundName);
        electron_1.ipcRenderer.on('soundboard-shortcut-triggered', listener);
        return () => electron_1.ipcRenderer.removeListener('soundboard-shortcut-triggered', listener);
    },
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
    screenAudioSupported: () => electron_1.ipcRenderer.invoke('screen-audio-supported'),
    screenAudioDiagnose: () => electron_1.ipcRenderer.invoke('screen-audio-diagnose'),
    screenAudioStart: (sourceId) => electron_1.ipcRenderer.invoke('screen-audio-start', sourceId),
    screenAudioStop: () => electron_1.ipcRenderer.invoke('screen-audio-stop'),
    onScreenAudioFrame: (cb) => electron_1.ipcRenderer.on('screen-audio:frame', (_e, buffer) => cb(buffer)),
    removeScreenAudioFrameListener: () => electron_1.ipcRenderer.removeAllListeners('screen-audio:frame'),
    updateTrayVoiceStatus: (status) => electron_1.ipcRenderer.invoke('tray:update-voice-status', status),
    onTrayToggleMute: (cb) => {
        const listener = () => cb();
        electron_1.ipcRenderer.on('tray:toggle-mute', listener);
        return () => electron_1.ipcRenderer.removeListener('tray:toggle-mute', listener);
    },
    onTrayToggleDeafen: (cb) => {
        const listener = () => cb();
        electron_1.ipcRenderer.on('tray:toggle-deafen', listener);
        return () => electron_1.ipcRenderer.removeListener('tray:toggle-deafen', listener);
    },
    platform: process.platform,
};
electron_1.contextBridge.exposeInMainWorld('api', api);
//# sourceMappingURL=preload.js.map