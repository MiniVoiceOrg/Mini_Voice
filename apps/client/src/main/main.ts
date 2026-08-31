import { app, BrowserWindow, ipcMain, Menu, screen, session, shell } from 'electron';
import path from 'path';
import { setupIpcHandlers } from './ipcHandlers';
import { setupUpdater } from './updater';
import { ServerManager } from './serverManager';
import { TrayManager } from './trayManager';
import { ClientLogger } from './clientLogger';
import { HOME_MIN_HEIGHT, HOME_MIN_WIDTH } from './windowSizing';

import fs from 'fs';

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow: BrowserWindow | null = null;
let trayManager: TrayManager | null = null;
const serverManager = new ServerManager();
let clientLogger: ClientLogger | null = null;
let isShuttingDown = false;
let isQuitting = false;
/** Whether the renderer has already been asked to leave the call (#458). */
let leaveAnnounced = false;

/**
 * How long the quit waits for the renderer to say goodbye to the servers.
 *
 * It only has to cover sending a frame on an already open socket, so the ack
 * normally arrives in a few milliseconds; this bound just guarantees that a
 * renderer which is wedged cannot hold the app open.
 */
const LEAVE_ANNOUNCE_TIMEOUT_MS = 1000;

/**
 * Asks the renderer to leave every call and disconnect before the process dies,
 * then quits (#458).
 *
 * Without this, closing the app just dropped the WebSocket: the server could not
 * tell that apart from a network blip, so the person stayed listed in the voice
 * channel and nobody heard them leave. Telling the server explicitly makes the
 * departure immediate and deliberate. A crash obviously cannot run this — that
 * case is covered on the server, which now takes a session out of voice as soon
 * as its socket dies.
 */
function announceLeaveThenQuit(): void {
  if (leaveAnnounced) {
    app.quit();
    return;
  }
  leaveAnnounced = true;

  if (!mainWindow || mainWindow.isDestroyed()) {
    app.quit();
    return;
  }

  let settled = false;
  const finish = (): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    onLeaveComplete = null;
    app.quit();
  };

  const timer = setTimeout(finish, LEAVE_ANNOUNCE_TIMEOUT_MS);
  onLeaveComplete = finish;
  mainWindow.webContents.send('app:before-quit');
}

/** Set only while a quit is waiting for the renderer's goodbye. */
let onLeaveComplete: (() => void) | null = null;

ipcMain.handle('app:leave-complete', () => {
  onLeaveComplete?.();
});

function bindMainWindowNavigationGuards(): void {
  if (!mainWindow) return;

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!mainWindow) return;
    if (url === mainWindow.webContents.getURL()) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
}

function shutdownServer(): void {
  if (isShuttingDown) return;
  isShuttingDown = true;
  serverManager.stopServer();
}

function quitApplication(): void {
  isQuitting = true;
  app.quit();
}

function createWindow(): void {
  const iconCandidates = [
    path.join(__dirname, '../../build/icon.ico'),
    path.join(__dirname, '../../build/icon.png'),
    path.join(__dirname, '../../images/Logo.png'),
    path.join(__dirname, '../../src/renderer/assets/Logo.png'),
    path.join(app.getAppPath(), 'build/icon.ico'),
    path.join(app.getAppPath(), 'build/icon.png'),
    path.join(app.getAppPath(), 'images/Logo.png'),
  ];
  const iconPath = iconCandidates.find((p) => fs.existsSync(p));

  const isMac = process.platform === 'darwin';

  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;
  const winWidth = Math.min(700, Math.round(screenW * 0.85));

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: 950,
    minWidth: HOME_MIN_WIDTH,
    minHeight: HOME_MIN_HEIGHT,
    backgroundColor: '#0e1117',
    // Windows/Linux: fully frameless (custom title bar in the renderer).
    // macOS: keep the native traffic-light buttons but hide the title bar.
    frame: isMac,
    titleBarStyle: isMac ? 'hidden' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 12 } : undefined,
    title: 'Monky',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needed for custom desktopCapturer / preload access
      webSecurity: true,
      backgroundThrottling: false, // Keep audio and WebRTC processing smoothly when minimized/hidden
    },
  });

  if (!trayManager) {
    trayManager = new TrayManager(mainWindow, quitApplication);
  }

  let minimizeToTray = true;

  clientLogger = new ClientLogger();
  clientLogger.write({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    category: 'APP',
    message: `Application started — version ${app.getVersion()}, platform ${process.platform} ${process.arch}`,
  });

  setupIpcHandlers(mainWindow, serverManager, trayManager, {
    setMinimizeToTray: (enabled: boolean) => {
      minimizeToTray = enabled;
    },
    clientLogger,
  });
  setupUpdater(mainWindow);

  // In dev, load Vite dev server if running, otherwise load dist/index.html
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  // Minimize to tray on close instead of quitting the application (#149, #256)
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      if (minimizeToTray) {
        event.preventDefault();
        mainWindow?.hide();
        return;
      }
      // The renderer has to stay alive long enough to leave the call (#458), so
      // the window is kept open and the quit drives the teardown instead.
      event.preventDefault();
      quitApplication();
      return;
    }

    // Quitting from the tray or the menu: same rule, the goodbye needs a live
    // renderer. Once it has been sent, the window is free to go.
    if (!leaveAnnounced) {
      event.preventDefault();
      announceLeaveThenQuit();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Windows groups taskbar buttons by AppUserModelID. The NSIS installer stamps the
// shortcuts with `appId`, so the running process must declare the very same id --
// otherwise Windows sees the live window as a different app and the pinned icon
// stops matching it after every update (#323).
if (process.platform === 'win32') {
  app.setAppUserModelId('com.monky.app');
}

// Only allow a single running instance. If a second instance is launched,
// focus the window of the instance that is already running instead of
// opening a new one (option 1 from #154).
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Remove the default application menu (File / Edit / View ...).
    Menu.setApplicationMenu(null);

    // Fix YouTube/Spotify embed iframes: set a valid Referer header so
    // external embed providers don't reject requests from file:// origins (#237).
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: ['https://*.youtube.com/*', 'https://*.youtube-nocookie.com/*', 'https://*.googlevideo.com/*', 'https://*.spotify.com/*'] },
      (details, callback) => {
        const headers = { ...details.requestHeaders };
        headers['Referer'] = 'https://www.youtube.com/';
        headers['Origin'] = 'https://www.youtube.com';
        callback({ requestHeaders: headers });
      }
    );

    // Allow media/DRM permissions required by embedded players.
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      const allowed = ['media', 'mediaKeySystem', 'fullscreen', 'clipboard-read', 'clipboard-sanitized-write'];
      callback(allowed.includes(permission));
    });

    createWindow();
    bindMainWindowNavigationGuards();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        bindMainWindowNavigationGuards();
      } else if (mainWindow) {
        if (!mainWindow.isVisible()) mainWindow.show();
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  });
}

app.on('window-all-closed', () => {
  shutdownServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  isQuitting = true;

  // Say goodbye to the servers while the renderer is still alive, then quit for
  // real on the second pass (#458).
  if (!leaveAnnounced && mainWindow && !mainWindow.isDestroyed()) {
    event.preventDefault();
    announceLeaveThenQuit();
    return;
  }

  clientLogger?.shutdown();
  shutdownServer();
  trayManager?.destroy();
});
