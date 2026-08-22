import { BrowserWindow } from 'electron';
export interface DiscoveredLanServer {
    host: string;
    port: number;
    serverName: string;
    version: string;
}
export declare class LanDiscovery {
    private readonly mainWindow;
    private readonly discoveryPort;
    private socket;
    private pruneTimer;
    private readonly servers;
    private isStarted;
    constructor(mainWindow: BrowserWindow, discoveryPort?: number);
    start(): Promise<void>;
    stop(): Promise<void>;
    private handleMessage;
    private pruneExpiredServers;
    private emitFound;
    private emitLost;
    private getKey;
}
//# sourceMappingURL=lanDiscovery.d.ts.map