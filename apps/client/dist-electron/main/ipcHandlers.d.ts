import { BrowserWindow } from 'electron';
import { ServerManager } from './serverManager';
export interface UpdateAsset {
    name: string;
    url: string;
}
export interface UpdateCheckResult {
    ok: boolean;
    tag?: string;
    name?: string;
    htmlUrl?: string;
    publishedAt?: string;
    assets?: UpdateAsset[];
    error?: string;
}
export declare function setupIpcHandlers(mainWindow: BrowserWindow, serverManager: ServerManager): void;
//# sourceMappingURL=ipcHandlers.d.ts.map