"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const ipcHandlers_1 = require("./ipcHandlers");
const serverManager_1 = require("./serverManager");
const fs_1 = __importDefault(require("fs"));
let mainWindow = null;
const serverManager = new serverManager_1.ServerManager();
function createWindow() {
    const iconCandidates = [
        path_1.default.join(__dirname, '../../images/Logo.png'),
        path_1.default.join(__dirname, '../../src/renderer/assets/Logo.png'),
        path_1.default.join(electron_1.app.getAppPath(), 'images/Logo.png'),
    ];
    const iconPath = iconCandidates.find((p) => fs_1.default.existsSync(p));
    mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        backgroundColor: '#0e1117',
        frame: true,
        title: 'Mini Voice',
        icon: iconPath,
        webPreferences: {
            preload: path_1.default.join(__dirname, '../preload/preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false, // needed for custom desktopCapturer / preload access
            webSecurity: true,
        },
    });
    (0, ipcHandlers_1.setupIpcHandlers)(mainWindow, serverManager);
    // In dev, load Vite dev server if running, otherwise load dist/index.html
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, '../../dist/index.html'));
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
electron_1.app.whenReady().then(() => {
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    serverManager.stopServer();
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('before-quit', () => {
    serverManager.stopServer();
});
//# sourceMappingURL=main.js.map