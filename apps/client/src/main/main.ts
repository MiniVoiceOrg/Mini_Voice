import { app, BrowserWindow, Menu } from 'electron';
import path from 'path';
import { setupIpcHandlers } from './ipcHandlers';
import { setupUpdater } from './updater';
import { ServerManager } from './serverManager';

import fs from 'fs';

let mainWindow: BrowserWindow | null = null;
const serverManager = new ServerManager();
let isShuttingDown = false;

function shutdownServer(): void {
  if (isShuttingDown) return;
  isShuttingDown = true;
  serverManager.stopServer();
}

function createWindow(): void {
  const iconCandidates = [
    path.join(__dirname, '../../images/Logo.png'),
    path.join(__dirname, '../../src/renderer/assets/Logo.png'),
    path.join(app.getAppPath(), 'images/Logo.png'),
  ];
  const iconPath = iconCandidates.find((p) => fs.existsSync(p));

  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0e1117',
    // Windows/Linux: fully frameless (custom title bar in the renderer).
    // macOS: keep the native traffic-light buttons but hide the title bar.
    frame: isMac,
    titleBarStyle: isMac ? 'hidden' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 12 } : undefined,
    title: 'Mini Voice',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needed for custom desktopCapturer / preload access
      webSecurity: true,
    },
  });

  setupIpcHandlers(mainWindow, serverManager);
  setupUpdater(mainWindow);

  // In dev, load Vite dev server if running, otherwise load dist/index.html
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Remove the default application menu (File / Edit / View ...).
  Menu.setApplicationMenu(null);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  shutdownServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  shutdownServer();
});
