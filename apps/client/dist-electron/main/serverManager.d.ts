export interface HostServerOptions {
    port: number;
    serverName: string;
    password?: string;
    initialVoiceChannel?: string;
    initialTextChannel?: string;
}
export declare class ServerManager {
    private serverInstance;
    private isRunning;
    startServer(options: HostServerOptions): Promise<{
        success: boolean;
        error?: string;
    }>;
    stopServer(): Promise<void>;
    getStatus(): {
        isRunning: boolean;
    };
}
//# sourceMappingURL=serverManager.d.ts.map