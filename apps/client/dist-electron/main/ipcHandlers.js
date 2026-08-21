"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupIpcHandlers = setupIpcHandlers;
const electron_1 = require("electron");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const uuid_1 = require("uuid");
function setupIpcHandlers(mainWindow, serverManager) {
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
}
//# sourceMappingURL=ipcHandlers.js.map