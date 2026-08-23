"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupIpcHandlers = setupIpcHandlers;
const electron_1 = require("electron");
const fs_1 = __importDefault(require("fs"));
const net_1 = __importDefault(require("net"));
const path_1 = __importDefault(require("path"));
const uuid_1 = require("uuid");
const lanDiscovery_1 = require("./lanDiscovery");
// Screen audio native module (compiled only on CI — graceful fallback)
let screenAudio = null;
try {
    screenAudio = require('@mini-voice/screen-audio');
}
catch {
    screenAudio = null;
}
function setupIpcHandlers(mainWindow, serverManager) {
    const lanDiscovery = new lanDiscovery_1.LanDiscovery(mainWindow);
    electron_1.ipcMain.handle('window:maximize', () => {
        if (!mainWindow || mainWindow.isDestroyed())
            return;
        const { width: screenW, height: screenH } = require('electron').screen.getPrimaryDisplay().workAreaSize;
        const w = Math.round(screenW * 0.8);
        const h = Math.round(screenH * 0.85);
        mainWindow.setSize(w, h);
        mainWindow.center();
        mainWindow.maximize();
    });
    // Client ID persistence
    electron_1.ipcMain.handle('get-client-id', async () => {
        const clientIdFile = path_1.default.join(electron_1.app.getPath('userData'), 'client-id.json');
        try {
            if (fs_1.default.existsSync(clientIdFile)) {
                const data = JSON.parse(fs_1.default.readFileSync(clientIdFile, 'utf8'));
                if (data.clientId) {
                    return data.clientId;
                }
            }
        }
        catch (e) {
            console.warn('Could not read existing client-id.json', e);
        }
        const newClientId = (0, uuid_1.v4)();
        try {
            fs_1.default.writeFileSync(clientIdFile, JSON.stringify({ clientId: newClientId }, null, 2), 'utf8');
        }
        catch (e) {
            console.error('Could not save client-id.json', e);
        }
        return newClientId;
    });
    // Local Server Management
    electron_1.ipcMain.handle('host-server-start', async (_, options) => {
        return await serverManager.startServer(options);
    });
    electron_1.ipcMain.handle('host-server-stop', async () => {
        serverManager.stopServer();
        return { success: true };
    });
    electron_1.ipcMain.handle('host-server-status', async () => {
        return serverManager.getStatus();
    });
    electron_1.ipcMain.handle('lan-discovery-start', async () => {
        await lanDiscovery.start();
    });
    electron_1.ipcMain.handle('lan-discovery-stop', async () => {
        await lanDiscovery.stop();
    });
    // Desktop Screen Sharing sources
    electron_1.ipcMain.handle('get-desktop-sources', async () => {
        const sources = await electron_1.desktopCapturer.getSources({
            types: ['screen', 'window'],
            thumbnailSize: { width: 320, height: 180 },
            fetchWindowIcons: true,
        });
        return sources.map((s) => ({
            id: s.id,
            name: s.name,
            type: s.id.startsWith('screen:') ? 'screen' : 'window',
            thumbnailDataUrl: s.thumbnail.toDataURL(),
            appIconDataUrl: s.appIcon ? s.appIcon.toDataURL() : null,
        }));
    });
    // Avatar Image Selection Dialog
    electron_1.ipcMain.handle('dialog-select-image', async () => {
        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
            title: 'Selecionar Foto de Perfil',
            filters: [
                { name: 'Imagens (PNG, JPG, WebP)', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
            ],
            properties: ['openFile'],
        });
        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }
        const filePath = result.filePaths[0];
        const buffer = fs_1.default.readFileSync(filePath);
        const ext = path_1.default.extname(filePath).toLowerCase().replace('.', '');
        const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        const base64 = buffer.toString('base64');
        return {
            fileName: path_1.default.basename(filePath),
            mimeType: mime,
            base64: `data:${mime};base64,${base64}`,
        };
    });
    // Custom sound file selection (#7)
    electron_1.ipcMain.handle('dialog-select-sound-file', async () => {
        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
            title: 'Selecionar Arquivo de Som',
            filters: [
                { name: 'Áudio (WAV, MP3, OGG)', extensions: ['wav', 'mp3', 'ogg', 'webm'] },
            ],
            properties: ['openFile'],
        });
        if (result.canceled || result.filePaths.length === 0)
            return null;
        const filePath = result.filePaths[0];
        const buffer = fs_1.default.readFileSync(filePath);
        const ext = path_1.default.extname(filePath).toLowerCase().replace('.', '');
        const mime = ext === 'mp3' ? 'audio/mpeg' : ext === 'ogg' ? 'audio/ogg' : ext === 'webm' ? 'audio/webm' : 'audio/wav';
        const base64 = buffer.toString('base64');
        return `data:${mime};base64,${base64}`;
    });
    // Soundboard Folder Selection
    electron_1.ipcMain.handle('dialog-select-soundboard-folder', async () => {
        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
            title: 'Selecionar Pasta de Sons (Soundboard)',
            properties: ['openDirectory'],
        });
        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }
        return result.filePaths[0];
    });
    // Soundboard List Sounds
    electron_1.ipcMain.handle('soundboard-list-sounds', async (_, folderPath) => {
        if (!folderPath || typeof folderPath !== 'string' || !fs_1.default.existsSync(folderPath)) {
            return [];
        }
        try {
            const entries = fs_1.default.readdirSync(folderPath, { withFileTypes: true });
            const validExts = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.webm'];
            const sounds = [];
            for (const entry of entries) {
                if (entry.isFile()) {
                    const ext = path_1.default.extname(entry.name).toLowerCase();
                    if (validExts.includes(ext)) {
                        const fullPath = path_1.default.join(folderPath, entry.name);
                        const stat = fs_1.default.statSync(fullPath);
                        const displayName = path_1.default.basename(entry.name, ext);
                        sounds.push({
                            name: displayName,
                            fileName: entry.name,
                            filePath: fullPath,
                            sizeBytes: stat.size,
                            ext,
                        });
                    }
                }
            }
            sounds.sort((a, b) => a.name.localeCompare(b.name));
            return sounds;
        }
        catch (e) {
            console.warn('Error reading soundboard folder:', e);
            return [];
        }
    });
    // Soundboard Read Sound
    electron_1.ipcMain.handle('soundboard-read-sound', async (_, filePath) => {
        if (!filePath || typeof filePath !== 'string' || !fs_1.default.existsSync(filePath)) {
            return null;
        }
        try {
            const stat = fs_1.default.statSync(filePath);
            if (stat.size > 3 * 1024 * 1024) {
                throw new Error('Arquivo de áudio muito grande (máximo 3MB)');
            }
            const buffer = fs_1.default.readFileSync(filePath);
            const ext = path_1.default.extname(filePath).toLowerCase();
            let mime = 'audio/mp3';
            if (ext === '.wav')
                mime = 'audio/wav';
            else if (ext === '.ogg')
                mime = 'audio/ogg';
            else if (ext === '.m4a' || ext === '.aac')
                mime = 'audio/mp4';
            else if (ext === '.webm')
                mime = 'audio/webm';
            return {
                fileName: path_1.default.basename(filePath),
                soundName: path_1.default.basename(filePath, ext),
                mimeType: mime,
                base64: buffer.toString('base64'),
                dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
                sizeBytes: stat.size,
            };
        }
        catch (e) {
            console.warn('Error reading sound file:', e);
            return null;
        }
    });
    // Soundboard Global Shortcuts Registration
    electron_1.ipcMain.handle('soundboard-register-shortcuts', (_, shortcuts) => {
        try {
            electron_1.globalShortcut.unregisterAll();
            if (!Array.isArray(shortcuts))
                return true;
            for (const item of shortcuts) {
                if (!item.accelerator || !item.soundName)
                    continue;
                try {
                    electron_1.globalShortcut.register(item.accelerator, () => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('soundboard-shortcut-triggered', item.soundName);
                        }
                    });
                }
                catch (err) {
                    console.warn(`[main] Failed to register global shortcut "${item.accelerator}" for "${item.soundName}":`, err);
                }
            }
            return true;
        }
        catch (e) {
            console.warn('[main] Error in soundboard-register-shortcuts:', e);
            return false;
        }
    });
    // Window Controls
    electron_1.ipcMain.handle('window-minimize', () => {
        mainWindow.minimize();
    });
    electron_1.ipcMain.handle('window-maximize', () => {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        }
        else {
            mainWindow.maximize();
        }
    });
    electron_1.ipcMain.handle('window-close', () => {
        mainWindow.close();
    });
    // App version (for update checks)
    electron_1.ipcMain.handle('get-app-version', () => electron_1.app.getVersion());
    // Open an external URL in the default browser
    electron_1.ipcMain.handle('open-external', async (_, url) => {
        if (typeof url === 'string' && /^https:\/\//i.test(url)) {
            await electron_1.shell.openExternal(url);
            return { success: true };
        }
        return { success: false };
    });
    // TCP reachability probe (#37): distinguishes an unreachable host (offline)
    // from a reachable host whose port refuses the connection (server closed).
    electron_1.ipcMain.handle('probe-server', async (_, host, port) => {
        return await new Promise((resolve) => {
            const socket = new net_1.default.Socket();
            let settled = false;
            const finish = (result) => {
                if (settled)
                    return;
                settled = true;
                socket.destroy();
                resolve(result);
            };
            socket.setTimeout(5000);
            socket.once('connect', () => finish({ reachable: true, reason: 'online' }));
            socket.once('timeout', () => finish({ reachable: false, reason: 'timeout' }));
            socket.once('error', (err) => {
                if (err.code === 'ECONNREFUSED') {
                    // Host answered but the port is closed → machine is online, server is not.
                    finish({ reachable: false, reason: 'refused' });
                }
                else if (err.code === 'ETIMEDOUT') {
                    finish({ reachable: false, reason: 'timeout' });
                }
                else {
                    // ENOTFOUND / EHOSTUNREACH / ENETUNREACH / etc. → host is offline.
                    finish({ reachable: false, reason: 'unreachable' });
                }
            });
            try {
                socket.connect(port, host);
            }
            catch {
                finish({ reachable: false, reason: 'unreachable' });
            }
        });
    });
    // Screen Audio Capture (native module)
    electron_1.ipcMain.handle('screen-audio-supported', () => {
        return screenAudio ? screenAudio.isSupported() : false;
    });
    electron_1.ipcMain.handle('screen-audio-diagnose', () => {
        const os = require('os');
        const release = os.release(); // e.g. "10.0.22631"
        return {
            nativeModuleLoaded: screenAudio !== null,
            platformSupported: screenAudio ? screenAudio.isSupported() : false,
            osVersion: `${os.platform()} ${release}`,
            pid: process.pid,
        };
    });
    electron_1.ipcMain.handle('screen-audio-start', () => {
        if (!screenAudio || !screenAudio.isSupported()) {
            return { success: false, error: 'Not supported on this platform' };
        }
        const excludePid = process.pid;
        console.log(`[ScreenAudio:Main] Starting capture (excludePid=${excludePid})`);
        const result = screenAudio.start({ excludePid, sampleRate: 48000, channels: 2 }, (buffer) => {
            if (!mainWindow.isDestroyed()) {
                mainWindow.webContents.send('screen-audio:frame', buffer);
            }
        });
        console.log(`[ScreenAudio:Main] start() result:`, result);
        return result;
    });
    electron_1.ipcMain.handle('screen-audio-stop', () => {
        if (!screenAudio)
            return { success: false };
        return screenAudio.stop();
    });
    mainWindow.on('closed', () => {
        void lanDiscovery.stop();
    });
}
//# sourceMappingURL=ipcHandlers.js.map