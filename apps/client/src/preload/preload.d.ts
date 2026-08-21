export interface ElectronApi {
    getClientId: () => Promise<string>;
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
    platform: string;
}
declare global {
    interface Window {
        api: ElectronApi;
    }
}
//# sourceMappingURL=preload.d.ts.map