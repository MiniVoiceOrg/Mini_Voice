import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, shell } from 'electron';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { LanDiscovery } from './lanDiscovery';
import { HostServerOptions, ServerManager } from './serverManager';

// Screen audio native module (compiled only on CI — graceful fallback)
let screenAudio: { isSupported: () => boolean; start: (opts: any, cb: (buf: Buffer) => void) => { success: boolean; error?: string }; stop: () => { success: boolean } } | null = null;
try {
  screenAudio = require('@mini-voice/screen-audio');
} catch {
  screenAudio = null;
}

export function setupIpcHandlers(mainWindow: BrowserWindow, serverManager: ServerManager): void {
  const lanDiscovery = new LanDiscovery(mainWindow);

  ipcMain.handle('window:maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const { width: screenW, height: screenH } = require('electron').screen.getPrimaryDisplay().workAreaSize;
    const w = Math.round(screenW * 0.8);
    const h = Math.round(screenH * 0.85);
    mainWindow.setSize(w, h);
    mainWindow.center();
    mainWindow.maximize();
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
      title: 'Selecionar Arquivo de Som',
      filters: [
        { name: 'Áudio (WAV, MP3, OGG)', extensions: ['wav', 'mp3', 'ogg', 'webm'] },
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
      title: 'Selecionar Pasta de Sons (Soundboard)',
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
        throw new Error('Arquivo de áudio muito grande (máximo 3MB)');
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

  ipcMain.handle('screen-audio-start', () => {
    if (!screenAudio || !screenAudio.isSupported()) {
      return { success: false, error: 'Not supported on this platform' };
    }
    const excludePid = process.pid;
    const result = screenAudio.start(
      { excludePid, sampleRate: 48000, channels: 2 },
      (buffer: Buffer) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('screen-audio:frame', buffer);
        }
      }
    );
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
