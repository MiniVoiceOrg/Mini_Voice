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
    }) => Promise<{
        success: boolean;
        error?: string;
    }>;
    hostServerStop: () => Promise<{
        success: boolean;
    }>;
    hostServerStatus: () => Promise<{
        isRunning: boolean;
    }>;
    getDesktopSources: () => Promise<Array<{
        id: string;
        name: string;
        type: 'screen' | 'window';
        thumbnailDataUrl: string;
        appIconDataUrl: string | null;
    }>>;
    selectImageDialog: () => Promise<{
        fileName: string;
        mimeType: string;
        base64: string;
    } | null>;
    selectSoundboardFolder: () => Promise<string | null>;
    listSoundboardSounds: (folderPath: string) => Promise<Array<{
        name: string;
        fileName: string;
        filePath: string;
        sizeBytes: number;
        ext: string;
    }>>;
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
    checkForUpdates: () => Promise<{
        ok: boolean;
        available?: boolean;
        version?: string;
        error?: string;
    }>;
    downloadUpdate: () => Promise<{
        ok: boolean;
        error?: string;
    }>;
    installUpdate: () => Promise<{
        ok: boolean;
        error?: string;
    }>;
    onUpdateProgress: (cb: (percent: number) => void) => void;
    onUpdateDownloaded: (cb: (info: {
        manual: boolean;
    }) => void) => void;
    onUpdateError: (cb: (message: string) => void) => void;
    openExternal: (url: string) => Promise<{
        success: boolean;
    }>;
    probeServer: (host: string, port: number) => Promise<{
        reachable: boolean;
        reason: 'online' | 'refused' | 'timeout' | 'unreachable';
    }>;
    screenAudioSupported: () => Promise<boolean>;
    screenAudioStart: () => Promise<{
        success: boolean;
        error?: string;
    }>;
    screenAudioStop: () => Promise<{
        success: boolean;
    }>;
    onScreenAudioFrame: (cb: (buffer: ArrayBuffer) => void) => void;
    removeScreenAudioFrameListener: () => void;
    platform: string;
}
declare global {
    interface Window {
        api: ElectronApi;
    }
}
//# sourceMappingURL=preload.d.ts.map