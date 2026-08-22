"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LanDiscovery = void 0;
const dgram_1 = __importDefault(require("dgram"));
const DEFAULT_DISCOVERY_PORT = 41234;
const ANNOUNCEMENT_TYPE = 'mini-voice-announce';
const SERVER_TTL_MS = 10000;
const PRUNE_INTERVAL_MS = 1000;
class LanDiscovery {
    mainWindow;
    discoveryPort;
    socket = null;
    pruneTimer = null;
    servers = new Map();
    isStarted = false;
    constructor(mainWindow, discoveryPort = DEFAULT_DISCOVERY_PORT) {
        this.mainWindow = mainWindow;
        this.discoveryPort = discoveryPort;
    }
    async start() {
        if (this.isStarted)
            return;
        const socket = dgram_1.default.createSocket({ type: 'udp4', reuseAddr: true });
        try {
            await new Promise((resolve, reject) => {
                const handleError = (error) => {
                    socket.off('listening', handleListening);
                    reject(error);
                };
                const handleListening = () => {
                    socket.off('error', handleError);
                    resolve();
                };
                socket.once('error', handleError);
                socket.once('listening', handleListening);
                socket.bind(this.discoveryPort, '0.0.0.0');
            });
        }
        catch {
            try {
                socket.close();
            }
            catch { }
            return;
        }
        this.socket = socket;
        this.isStarted = true;
        socket.on('message', (message, remote) => {
            this.handleMessage(message, remote.address);
        });
        socket.on('error', () => { });
        this.pruneTimer = setInterval(() => this.pruneExpiredServers(), PRUNE_INTERVAL_MS);
    }
    async stop() {
        if (this.pruneTimer) {
            clearInterval(this.pruneTimer);
            this.pruneTimer = null;
        }
        for (const server of this.servers.values()) {
            this.emitLost(server);
        }
        this.servers.clear();
        const socket = this.socket;
        this.socket = null;
        this.isStarted = false;
        if (!socket)
            return;
        await new Promise((resolve) => {
            try {
                socket.close(() => resolve());
            }
            catch {
                resolve();
            }
        });
    }
    handleMessage(message, host) {
        let parsed;
        try {
            parsed = JSON.parse(message.toString('utf8'));
        }
        catch {
            return;
        }
        if (parsed.type !== ANNOUNCEMENT_TYPE ||
            typeof parsed.serverName !== 'string' ||
            typeof parsed.port !== 'number' ||
            parsed.port < 1 ||
            parsed.port > 65535) {
            return;
        }
        const server = {
            host,
            port: parsed.port,
            serverName: parsed.serverName,
            version: typeof parsed.version === 'string' ? parsed.version : '1.0',
            lastSeen: Date.now(),
        };
        const key = this.getKey(server.host, server.port);
        const existing = this.servers.get(key);
        const isNew = !existing ||
            existing.serverName !== server.serverName ||
            existing.version !== server.version;
        this.servers.set(key, server);
        if (isNew) {
            this.emitFound(server);
        }
    }
    pruneExpiredServers() {
        const cutoff = Date.now() - SERVER_TTL_MS;
        for (const [key, server] of this.servers.entries()) {
            if (server.lastSeen > cutoff)
                continue;
            this.servers.delete(key);
            this.emitLost(server);
        }
    }
    emitFound(server) {
        if (this.mainWindow.isDestroyed())
            return;
        this.mainWindow.webContents.send('lan-discovery:found', server);
    }
    emitLost(server) {
        if (this.mainWindow.isDestroyed())
            return;
        this.mainWindow.webContents.send('lan-discovery:lost', server);
    }
    getKey(host, port) {
        return `${host}:${port}`;
    }
}
exports.LanDiscovery = LanDiscovery;
//# sourceMappingURL=lanDiscovery.js.map