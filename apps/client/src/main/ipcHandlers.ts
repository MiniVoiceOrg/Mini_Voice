import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { HostServerOptions, ServerManager } from './serverManager';

const GITHUB_REPO = 'MiniVoiceOrg/Mini_Voice';

export interface UpdateAsset {
  name: string;
  url: string;
}

export interface UpdateCheckResult {
  ok: boolean;
  tag?: string;
  name?: string;
  htmlUrl?: string;
  publishedAt?: string;
  assets?: UpdateAsset[];
  error?: string;
}

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

  // Check GitHub for the latest published release
  ipcMain.handle('check-for-updates', async (): Promise<UpdateCheckResult> => {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'MiniVoice-App',
          },
        }
      );

      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }

      const data = (await res.json()) as {
        tag_name?: string;
        name?: string;
        html_url?: string;
        published_at?: string;
        assets?: Array<{ name: string; browser_download_url: string }>;
      };

      return {
        ok: true,
        tag: data.tag_name,
        name: data.name,
        htmlUrl: data.html_url,
        publishedAt: data.published_at,
        assets: (data.assets ?? []).map((a) => ({
          name: a.name,
          url: a.browser_download_url,
        })),
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'network error' };
    }
  });

  // Open an external URL in the default browser
  ipcMain.handle('open-external', async (_, url: string) => {
    if (typeof url === 'string' && /^https:\/\//i.test(url)) {
      await shell.openExternal(url);
      return { success: true };
    }
    return { success: false };
  });
}
