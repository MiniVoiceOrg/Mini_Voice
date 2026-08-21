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
        tag?: string;
        name?: string;
        htmlUrl?: string;
        publishedAt?: string;
        assets?: Array<{
            name: string;
            url: string;
        }>;
        error?: string;
    }>;
    openExternal: (url: string) => Promise<{
        success: boolean;
    }>;
}
declare global {
    interface Window {
        api: ElectronApi;
    }
}
//# sourceMappingURL=preload.d.ts.map