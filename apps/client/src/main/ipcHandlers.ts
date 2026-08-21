import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, shell } from 'electron';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { HostServerOptions, ServerManager } from './serverManager';

export function setupIpcHandlers(mainWindow: BrowserWindow, serverManager: ServerManager): void {
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
}
