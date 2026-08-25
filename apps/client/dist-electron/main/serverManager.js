"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerManager = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const electron_1 = require("electron");
const server_js_1 = require("@monky/server/dist/server.js");
class ServerManager {
    serverInstance = null;
    isRunning = false;
    async startServer(options) {
        if (this.isRunning && this.serverInstance) {
            return { success: true };
        }
        const dataDir = path_1.default.join(electron_1.app.getPath('userData'), 'server-data');
        if (!fs_1.default.existsSync(dataDir)) {
            fs_1.default.mkdirSync(dataDir, { recursive: true });
        }
        const config = {
            port: options.port,
            dataDir,
            serverName: options.serverName || 'Monky Server',
            password: options.password || '',
            initialVoiceChannel: options.initialVoiceChannel || 'Geral',
            initialTextChannel: options.initialTextChannel || 'geral',
        };
        try {
            const server = await server_js_1.MonkyServer.create(config);
            await server.start();
            this.serverInstance = server;
            this.isRunning = true;
            console.log(`[ServerManager] Local server started successfully on port ${options.port}`);
            return { success: true };
        }
        catch (err) {
            console.error('[ServerManager] Error starting local server:', err);
            this.isRunning = false;
            this.serverInstance = null;
            return { success: false, error: err.message || 'Falha ao iniciar servidor' };
        }
    }
    async stopServer() {
        if (this.serverInstance) {
            console.log('[ServerManager] Stopping local server...');
            await this.serverInstance.stop();
            this.serverInstance = null;
            this.isRunning = false;
        }
    }
    getStatus() {
        return { isRunning: this.isRunning };
    }
}
exports.ServerManager = ServerManager;
//# sourceMappingURL=serverManager.js.map