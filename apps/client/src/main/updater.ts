import { app, BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'fs';
import https from 'https';
import path from 'path';

const GITHUB_REPO = 'MiniVoiceOrg/Mini_Voice';

interface CheckResult {
  ok: boolean;
  available?: boolean;
  version?: string;
  error?: string;
}

// electron-updater is loaded lazily (only on Windows/Linux) so that a missing
// or broken package never prevents the app itself from starting.
type AutoUpdater = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on: (event: string, cb: (arg: unknown) => void) => void;
  checkForUpdates: () => Promise<{ updateInfo?: { version: string } } | null>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
};

let autoUpdater: AutoUpdater | null = null;

function loadAutoUpdater(): AutoUpdater | null {
  if (autoUpdater) return autoUpdater;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    autoUpdater = require('electron-updater').autoUpdater as AutoUpdater;
    return autoUpdater;
  } catch (e) {
    console.error('electron-updater indisponível:', msg(e));
    return null;
  }
}

function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) =>
    String(v)
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── macOS: GitHub API check + manual .dmg download (no code-signing needed) ──

interface MacAsset {
  version: string;
  name: string;
  url: string;
}

let pendingMacAsset: MacAsset | null = null;
let downloadedMacPath: string | null = null;

async function checkMacUpdate(): Promise<CheckResult> {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MiniVoice-App' },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    const data = (await res.json()) as {
      tag_name?: string;
      assets?: Array<{ name: string; browser_download_url: string }>;
    };

    const version = (data.tag_name ?? '').replace(/^v/i, '');
    if (!version || !isNewer(version, app.getVersion())) {
      return { ok: true, available: false };
    }

    // Pick the .dmg matching the current CPU architecture.
    const wantArm = process.arch === 'arm64';
    const dmgs = (data.assets ?? []).filter((a) => a.name.endsWith('.dmg'));
    const asset =
      dmgs.find((a) => (wantArm ? /arm64/i.test(a.name) : !/arm64/i.test(a.name))) ?? dmgs[0];

    if (asset) {
      pendingMacAsset = { version, name: asset.name, url: asset.browser_download_url };
    }

    return { ok: true, available: true, version };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

function downloadToFile(
  url: string,
  destPath: string,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = (currentUrl: string, redirects: number): void => {
      if (redirects > 5) {
        reject(new Error('Too many redirects'));
        return;
      }
      https
        .get(currentUrl, { headers: { 'User-Agent': 'MiniVoice-App' } }, (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400 && response.headers.location) {
            response.resume();
            request(response.headers.location, redirects + 1);
            return;
          }
          if (status !== 200) {
            response.resume();
            reject(new Error(`HTTP ${status}`));
            return;
          }

          const total = parseInt(response.headers['content-length'] ?? '0', 10);
          let received = 0;
          const file = fs.createWriteStream(destPath);

          response.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (total > 0) {
              onProgress(Math.round((received / total) * 100));
            }
          });
          response.pipe(file);
          file.on('finish', () => file.close(() => resolve()));
          file.on('error', (err) => {
            fs.unlink(destPath, () => reject(err));
          });
        })
        .on('error', reject);
    };
    request(url, 0);
  });
}

async function downloadMacDmg(mainWindow: BrowserWindow): Promise<CheckResult> {
  if (!pendingMacAsset) {
    return { ok: false, error: 'Nenhuma atualização pendente' };
  }
  try {
    const destPath = path.join(app.getPath('temp'), pendingMacAsset.name);
    await downloadToFile(pendingMacAsset.url, destPath, (pct) => {
      mainWindow.webContents.send('update:progress', pct);
    });
    downloadedMacPath = destPath;
    // Open the .dmg so the user can drag the app into Applications.
    await shell.openPath(destPath);
    mainWindow.webContents.send('update:downloaded', { manual: true });
    return { ok: true };
  } catch (e) {
    mainWindow.webContents.send('update:error', msg(e));
    return { ok: false, error: msg(e) };
  }
}

// ── Wiring ───────────────────────────────────────────────────────────────

export function setupUpdater(mainWindow: BrowserWindow): void {
  const isMac = process.platform === 'darwin';

  if (!isMac) {
    const updater = loadAutoUpdater();
    if (updater) {
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = true;

      updater.on('download-progress', (p) => {
        const percent = (p as { percent?: number })?.percent ?? 0;
        mainWindow.webContents.send('update:progress', Math.round(percent));
      });
      updater.on('update-downloaded', () => {
        mainWindow.webContents.send('update:downloaded', { manual: false });
        // Install silently and relaunch automatically — no installer wizard.
        setTimeout(() => {
          try {
            updater.quitAndInstall(true, true);
          } catch (e) {
            mainWindow.webContents.send('update:error', msg(e));
          }
        }, 1500);
      });
      updater.on('error', (err) => {
        mainWindow.webContents.send('update:error', msg(err));
      });
    }
  }

  ipcMain.handle('update-check', async (): Promise<CheckResult> => {
    if (isMac) {
      return checkMacUpdate();
    }
    const updater = loadAutoUpdater();
    // electron-updater cannot run without packaging metadata (e.g. in dev).
    if (!updater || !app.isPackaged) {
      return { ok: true, available: false };
    }
    try {
      const result = await updater.checkForUpdates();
      const info = result?.updateInfo;
      const available = info ? isNewer(info.version, app.getVersion()) : false;
      return { ok: true, available, version: info?.version };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  });

  ipcMain.handle('update-download', async (): Promise<CheckResult> => {
    if (isMac) {
      return downloadMacDmg(mainWindow);
    }
    const updater = loadAutoUpdater();
    if (!updater) {
      return { ok: false, error: 'Updater indisponível' };
    }
    try {
      await updater.downloadUpdate();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  });

  ipcMain.handle('update-install', async (): Promise<CheckResult> => {
    if (isMac) {
      if (downloadedMacPath) {
        await shell.openPath(downloadedMacPath);
      }
      return { ok: true };
    }
    const updater = loadAutoUpdater();
    if (!updater) {
      return { ok: false, error: 'Updater indisponível' };
    }
    // Defer so the IPC reply is delivered before the app quits to install.
    setImmediate(() => updater.quitAndInstall(true, true));
    return { ok: true };
  });
}
