import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, shell } from 'electron';
import fs from 'fs';
import http from 'http';
import https from 'https';
import net from 'net';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { LanDiscovery } from './lanDiscovery';
import { HostServerOptions, ServerManager } from './serverManager';
import { mt, setMainLanguage } from './i18n';
import { TrayManager, VoiceStatus } from './trayManager';

function sanitizeDownloadFileName(fileName: string): string {
  const baseName = path.basename((fileName || '').trim()) || 'download';
  const sanitized = baseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return sanitized || 'download';
}

async function downloadToFile(url: string, destPath: string): Promise<void> {
  const tempPath = `${destPath}.downloading`;
  return await new Promise((resolve, reject) => {
    const requestDownload = (currentUrl: string, redirects: number): void => {
      if (redirects > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      const transport = currentUrl.startsWith('https:') ? https : http;
      const request = transport.get(currentUrl, { headers: { 'User-Agent': 'Monky-App' } }, (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          const locationHeader = response.headers.location;
          const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
          response.resume();
          if (!location) {
            reject(new Error(`HTTP ${status}`));
            return;
          }
          requestDownload(new URL(location, currentUrl).toString(), redirects + 1);
          return;
        }

        if (status !== 200) {
          response.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }

        const file = fs.createWriteStream(tempPath);
        let settled = false;
        const fail = (err: Error) => {
          if (settled) return;
          settled = true;
          file.destroy();
          fs.unlink(tempPath, () => reject(err));
        };

        response.on('aborted', () => fail(new Error('Download aborted')));
        response.on('error', fail);
        file.on('error', fail);
        file.on('finish', () => {
          if (settled) return;
          file.close((closeErr) => {
            if (closeErr) {
              fail(closeErr);
              return;
            }
            fs.rm(destPath, { force: true }, (removeErr) => {
              if (removeErr) {
                fail(removeErr);
                return;
              }
              fs.rename(tempPath, destPath, (renameErr) => {
                if (renameErr) {
                  fail(renameErr);
                  return;
                }
                settled = true;
                resolve();
              });
            });
          });
        });
        response.pipe(file);
      });
      request.on('error', reject);
      request.on('error', reject);
    };

    requestDownload(url, 0);
  });
}

// Screen audio native module (compiled only on CI — graceful fallback)
let screenAudio: {
  isSupported: () => boolean;
  start: (opts: any, cb: (buf: Buffer) => void) => { success: boolean; error?: string };
  stop: () => { success: boolean };
  getLastError: () => string;
  getStatus: () => number;
} | null = null;
try {
  screenAudio = require('@monky/screen-audio');
} catch (e) {
  console.warn('[ScreenAudio:Main] Native module not available:', (e as Error).message);
  screenAudio = null;
}

export function setupIpcHandlers(
  mainWindow: BrowserWindow,
  serverManager: ServerManager,
  trayManager?: TrayManager
): void {
  const lanDiscovery = new LanDiscovery(mainWindow);

  ipcMain.handle('tray:update-voice-status', (_, status: VoiceStatus) => {
    trayManager?.updateVoiceStatus(status);
  });

  ipcMain.handle('window:maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const { width: screenW, height: screenH } = require('electron').screen.getPrimaryDisplay().workAreaSize;
    const w = Math.round(screenW * 0.8);
    const h = Math.round(screenH * 0.85);
    mainWindow.setSize(w, h);
    mainWindow.center();
    mainWindow.maximize();
  });

  // Active UI language (#16): keeps native dialogs in the same language the
  // renderer is showing.
  ipcMain.handle('app-set-language', (_event, language: string) => {
    setMainLanguage(language);
    // The tray builds its labels eagerly, so it needs a redraw to pick the
    // new language up (#16).
    trayManager?.refresh();
  });

  // Client ID persistence
  ipcMain.handle('get-client-id', async () => {
    const clientIdFile = path.join(app.getPath('userData'), 'client-id.json');
    try {
      if (fs.existsSync(clientIdFile)) {
        const data = JSON.parse(fs.readFileSync(clientIdFile, 'utf8'));
        if (data.clientId) {
          return data.clientId;
        }
      }
    } catch (e) {
      console.warn('Could not read existing client-id.json', e);
    }

    const newClientId = uuidv4();
    try {
      fs.writeFileSync(clientIdFile, JSON.stringify({ clientId: newClientId }, null, 2), 'utf8');
    } catch (e) {
      console.error('Could not save client-id.json', e);
    }
    return newClientId;
  });

  // Local Server Management
  ipcMain.handle('host-server-start', async (_, options: HostServerOptions) => {
    return await serverManager.startServer(options);
  });

  ipcMain.handle('host-server-stop', async () => {
    serverManager.stopServer();
    return { success: true };
  });

  ipcMain.handle('host-server-status', async () => {
    return serverManager.getStatus();
  });

  ipcMain.handle('lan-discovery-start', async () => {
    await lanDiscovery.start();
  });

  ipcMain.handle('lan-discovery-stop', async () => {
    await lanDiscovery.stop();
  });

  // Desktop Screen Sharing sources
  ipcMain.handle('get-desktop-sources', async () => {
    const sources = await desktopCapturer.getSources({
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
  ipcMain.handle('dialog-select-image', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: mt('dialog.selectProfilePhoto'),
      filters: [
        { name: 'Imagens (PNG, JPG, WebP)', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const base64 = buffer.toString('base64');

    return {
      fileName: path.basename(filePath),
      mimeType: mime,
      base64: `data:${mime};base64,${base64}`,
    };
  });

  // Custom sound file selection (#7)
  ipcMain.handle('dialog-select-sound-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: mt('dialog.selectSoundFile'),
      filters: [
        { name: mt('dialog.audioFilter'), extensions: ['wav', 'mp3', 'ogg', 'webm'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mime = ext === 'mp3' ? 'audio/mpeg' : ext === 'ogg' ? 'audio/ogg' : ext === 'webm' ? 'audio/webm' : 'audio/wav';
    const base64 = buffer.toString('base64');
    return `data:${mime};base64,${base64}`;
  });

  // Soundboard Folder Selection
  ipcMain.handle('dialog-select-soundboard-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: mt('dialog.selectSoundboardFolder'),
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  // Soundboard List Sounds
  ipcMain.handle('soundboard-list-sounds', async (_, folderPath: string) => {
    if (!folderPath || typeof folderPath !== 'string' || !fs.existsSync(folderPath)) {
      return [];
    }
    try {
      const entries = fs.readdirSync(folderPath, { withFileTypes: true });
      const validExts = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.webm'];
      const sounds = [];
      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (validExts.includes(ext)) {
            const fullPath = path.join(folderPath, entry.name);
            const stat = fs.statSync(fullPath);
            const displayName = path.basename(entry.name, ext);
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
    } catch (e) {
      console.warn('Error reading soundboard folder:', e);
      return [];
    }
  });

  // Soundboard Read Sound
  ipcMain.handle('soundboard-read-sound', async (_, filePath: string) => {
    if (!filePath || typeof filePath !== 'string' || !fs.existsSync(filePath)) {
      return null;
    }
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 3 * 1024 * 1024) {
        throw new Error(mt('error.audioFileTooLarge'));
      }
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      let mime = 'audio/mp3';
      if (ext === '.wav') mime = 'audio/wav';
      else if (ext === '.ogg') mime = 'audio/ogg';
      else if (ext === '.m4a' || ext === '.aac') mime = 'audio/mp4';
      else if (ext === '.webm') mime = 'audio/webm';

      return {
        fileName: path.basename(filePath),
        soundName: path.basename(filePath, ext),
        mimeType: mime,
        base64: buffer.toString('base64'),
        dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
        sizeBytes: stat.size,
      };
    } catch (e: any) {
      console.warn('Error reading sound file:', e);
      return null;
    }
  });

  // Soundboard Global Shortcuts Registration
  ipcMain.handle('soundboard-register-shortcuts', (_, shortcuts: Array<{ soundName: string; accelerator: string }>) => {
    try {
      globalShortcut.unregisterAll();
      if (!Array.isArray(shortcuts)) return true;

      for (const item of shortcuts) {
        if (!item.accelerator || !item.soundName) continue;
        try {
          globalShortcut.register(item.accelerator, () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('soundboard-shortcut-triggered', item.soundName);
            }
          });
        } catch (err) {
          console.warn(`[main] Failed to register global shortcut "${item.accelerator}" for "${item.soundName}":`, err);
        }
      }
      return true;
    } catch (e) {
      console.warn('[main] Error in soundboard-register-shortcuts:', e);
      return false;
    }
  });

  // Window Controls
  ipcMain.handle('window-minimize', () => {
    mainWindow.minimize();
  });
  ipcMain.handle('window-maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle('window-close', () => {
    mainWindow.close();
  });

  // App version (for update checks)
  ipcMain.handle('get-app-version', () => app.getVersion());

  // Open an external URL in the default browser
  ipcMain.handle('open-external', async (_, url: string) => {
    if (typeof url === 'string' && /^https:\/\//i.test(url)) {
      await shell.openExternal(url);
      return { success: true };
    }
    return { success: false };
  });

  ipcMain.handle('download-file', async (_, url: string, fileName: string) => {
    try {
      const parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return { success: false, error: 'Invalid URL' };
      }

      const fallbackName = sanitizeDownloadFileName(decodeURIComponent(path.basename(parsedUrl.pathname) || 'download'));
      const suggestedName = sanitizeDownloadFileName(fileName || fallbackName);
      const saveResult = await dialog.showSaveDialog(mainWindow, {
        defaultPath: path.join(app.getPath('downloads'), suggestedName),
      });

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false };
      }

      await downloadToFile(parsedUrl.toString(), saveResult.filePath);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // TCP reachability probe (#37): distinguishes an unreachable host (offline)
  // from a reachable host whose port refuses the connection (server closed).
  ipcMain.handle('probe-server', async (_, host: string, port: number) => {
    return await new Promise<{ reachable: boolean; reason: 'online' | 'refused' | 'timeout' | 'unreachable' }>(
      (resolve) => {
        const socket = new net.Socket();
        let settled = false;
        const finish = (result: { reachable: boolean; reason: 'online' | 'refused' | 'timeout' | 'unreachable' }) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          resolve(result);
        };

        socket.setTimeout(5000);
        socket.once('connect', () => finish({ reachable: true, reason: 'online' }));
        socket.once('timeout', () => finish({ reachable: false, reason: 'timeout' }));
        socket.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'ECONNREFUSED') {
            // Host answered but the port is closed → machine is online, server is not.
            finish({ reachable: false, reason: 'refused' });
          } else if (err.code === 'ETIMEDOUT') {
            finish({ reachable: false, reason: 'timeout' });
          } else {
            // ENOTFOUND / EHOSTUNREACH / ENETUNREACH / etc. → host is offline.
            finish({ reachable: false, reason: 'unreachable' });
          }
        });

        try {
          socket.connect(port, host);
        } catch {
          finish({ reachable: false, reason: 'unreachable' });
        }
      }
    );
  });

  // Screen Audio Capture (native module)
  ipcMain.handle('screen-audio-supported', () => {
    return screenAudio ? screenAudio.isSupported() : false;
  });

  ipcMain.handle('screen-audio-diagnose', () => {
    const os = require('os');
    const release = os.release();
    return {
      nativeModuleLoaded: screenAudio !== null,
      platformSupported: screenAudio ? screenAudio.isSupported() : false,
      osVersion: `${os.platform()} ${release}`,
      pid: process.pid,
      captureStatus: screenAudio ? screenAudio.getStatus() : -1,
      lastError: screenAudio ? screenAudio.getLastError() : 'Module not loaded',
    };
  });

  ipcMain.handle('screen-audio-start', (_event, sourceId?: string) => {
    if (!screenAudio || !screenAudio.isSupported()) {
      return { success: false, error: 'Not supported on this platform' };
    }
    const excludePid = process.pid;
    // Electron encodes a window source id as `window:<HWND>:<n>`. When the user
    // shares a single application window, capture only that app's audio
    // (INCLUDE its process tree) instead of the whole PC.
    let includeHwnd = 0;
    if (sourceId && sourceId.startsWith('window:')) {
      const parsed = Number.parseInt(sourceId.split(':')[1] ?? '', 10);
      if (Number.isFinite(parsed) && parsed > 0) includeHwnd = parsed;
    }
    const opts: Record<string, number> = { excludePid, sampleRate: 48000, channels: 2 };
    if (includeHwnd) opts.includeHwnd = includeHwnd;
    console.log(`[ScreenAudio:Main] Starting capture (excludePid=${excludePid}, includeHwnd=${includeHwnd || 'none'}, source=${sourceId ?? 'screen'})`);
    const result = screenAudio.start(
      opts,
      (buffer: Buffer) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('screen-audio:frame', buffer);
        }
      }
    );
    console.log(`[ScreenAudio:Main] start() result:`, result);
    return result;
  });

  ipcMain.handle('screen-audio-stop', () => {
    if (!screenAudio) return { success: false };
    return screenAudio.stop();
  });

  mainWindow.on('closed', () => {
    void lanDiscovery.stop();
  });
}
