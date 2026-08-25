import { contextBridge, ipcRenderer } from 'electron';
const api = {
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
        const listener = (_e, soundName) => cb(soundName);
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
//# sourceMappingURL=preload.js.map