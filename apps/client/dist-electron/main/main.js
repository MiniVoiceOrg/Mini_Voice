"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const ipcHandlers_1 = require("./ipcHandlers");
const updater_1 = require("./updater");
const serverManager_1 = require("./serverManager");
const fs_1 = __importDefault(require("fs"));
let mainWindow = null;
const serverManager = new serverManager_1.ServerManager();
let isShuttingDown = false;
function shutdownServer() {
    if (isShuttingDown)
        return;
    isShuttingDown = true;
    serverManager.stopServer();
}
function createWindow() {
    const iconCandidates = [
        path_1.default.join(__dirname, '../../images/Logo.png'),
        path_1.default.join(__dirname, '../../src/renderer/assets/Logo.png'),
        path_1.default.join(electron_1.app.getAppPath(), 'images/Logo.png'),
    ];
    const iconPath = iconCandidates.find((p) => fs_1.default.existsSync(p));
    const isMac = process.platform === 'darwin';
    const { width: screenW, height: screenH } = electron_1.screen.getPrimaryDisplay().workAreaSize;
    const winWidth = Math.min(700, Math.round(screenW * 0.85));
    const winHeight = Math.min(1000, Math.max(750, Math.round(screenH * 0.85)));
    mainWindow = new electron_1.BrowserWindow({
        width: winWidth,
        height: winHeight,
        minWidth: 600,
        minHeight: 500,
        backgroundColor: '#0e1117',
        // Windows/Linux: fully frameless (custom title bar in the renderer).
        // macOS: keep the native traffic-light buttons but hide the title bar.
        frame: isMac,
        titleBarStyle: isMac ? 'hidden' : 'default',
        trafficLightPosition: isMac ? { x: 14, y: 12 } : undefined,
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
    (0, updater_1.setupUpdater)(mainWindow);
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
    // Remove the default application menu (File / Edit / View ...).
    electron_1.Menu.setApplicationMenu(null);
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    shutdownServer();
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('before-quit', () => {
    shutdownServer();
});
//# sourceMappingURL=main.js.map