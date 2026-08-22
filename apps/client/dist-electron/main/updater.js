"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupUpdater = setupUpdater;
const electron_1 = require("electron");
const fs_1 = __importDefault(require("fs"));
const https_1 = __importDefault(require("https"));
const path_1 = __importDefault(require("path"));
const i18n_1 = require("./i18n");
const GITHUB_REPO = 'MiniVoiceOrg/Mini_Voice';
let autoUpdater = null;
function loadAutoUpdater() {
    if (autoUpdater)
        return autoUpdater;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        autoUpdater = require('electron-updater').autoUpdater;
        return autoUpdater;
    }
    catch (e) {
        console.error('electron-updater indisponível:', msg(e));
        return null;
    }
}
function isNewer(latest, current) {
    const parse = (v) => String(v)
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
        if (x > y)
            return true;
        if (x < y)
            return false;
    }
    return false;
}
function msg(e) {
    return e instanceof Error ? e.message : String(e);
}
let pendingMacAsset = null;
let downloadedMacPath = null;
/**
 * Detects updates by querying the GitHub "latest release" API on all platforms
 * and comparing with the running app version. This is more reliable than
 * electron-updater's own check (which can return null when a check is cached or
 * already in progress). On macOS it also records the matching .dmg to download.
 */
async function checkViaGitHub() {
    try {
        const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MiniVoice-App' },
        });
        if (!res.ok)
            return { ok: false, error: `HTTP ${res.status}` };
        const data = (await res.json());
        const version = (data.tag_name ?? '').replace(/^v/i, '');
        if (!version || !isNewer(version, electron_1.app.getVersion())) {
            return { ok: true, available: false, version };
        }
        // On macOS, record the .dmg matching the current CPU architecture so the
        // download step can fetch it directly.
        if (process.platform === 'darwin') {
            const wantArm = process.arch === 'arm64';
            const dmgs = (data.assets ?? []).filter((a) => a.name.endsWith('.dmg'));
            const asset = dmgs.find((a) => (wantArm ? /arm64/i.test(a.name) : !/arm64/i.test(a.name))) ?? dmgs[0];
            if (asset) {
                pendingMacAsset = { version, name: asset.name, url: asset.browser_download_url };
            }
        }
        return { ok: true, available: true, version };
    }
    catch (e) {
        return { ok: false, error: msg(e) };
    }
}
function downloadToFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        const request = (currentUrl, redirects) => {
            if (redirects > 5) {
                reject(new Error('Too many redirects'));
                return;
            }
            https_1.default
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
                const file = fs_1.default.createWriteStream(destPath);
                response.on('data', (chunk) => {
                    received += chunk.length;
                    if (total > 0) {
                        onProgress(Math.round((received / total) * 100));
                    }
                });
                response.pipe(file);
                file.on('finish', () => file.close(() => resolve()));
                file.on('error', (err) => {
                    fs_1.default.unlink(destPath, () => reject(err));
                });
            })
                .on('error', reject);
        };
        request(url, 0);
    });
}
async function downloadMacDmg(mainWindow) {
    if (!pendingMacAsset) {
        return { ok: false, error: (0, i18n_1.mt)('error.noPendingUpdate') };
    }
    try {
        const destPath = path_1.default.join(electron_1.app.getPath('temp'), pendingMacAsset.name);
        await downloadToFile(pendingMacAsset.url, destPath, (pct) => {
            mainWindow.webContents.send('update:progress', pct);
        });
        downloadedMacPath = destPath;
        // Open the .dmg so the user can drag the app into Applications.
        await electron_1.shell.openPath(destPath);
        mainWindow.webContents.send('update:downloaded', { manual: true });
        return { ok: true };
    }
    catch (e) {
        mainWindow.webContents.send('update:error', msg(e));
        return { ok: false, error: msg(e) };
    }
}
// ── Wiring ───────────────────────────────────────────────────────────────
function setupUpdater(mainWindow) {
    const isMac = process.platform === 'darwin';
    if (!isMac) {
        const updater = loadAutoUpdater();
        if (updater) {
            updater.autoDownload = false;
            updater.autoInstallOnAppQuit = true;
            updater.on('download-progress', (p) => {
                const percent = p?.percent ?? 0;
                mainWindow.webContents.send('update:progress', Math.round(percent));
            });
            updater.on('update-downloaded', () => {
                mainWindow.webContents.send('update:downloaded', { manual: false });
                // Install silently and relaunch automatically — no installer wizard.
                setTimeout(() => {
                    try {
                        updater.quitAndInstall(true, true);
                    }
                    catch (e) {
                        mainWindow.webContents.send('update:error', msg(e));
                    }
                }, 1500);
            });
            updater.on('error', (err) => {
                mainWindow.webContents.send('update:error', msg(err));
            });
        }
    }
    electron_1.ipcMain.handle('update-check', async () => {
        // Detection is done via the GitHub API on every platform for reliability.
        return checkViaGitHub();
    });
    electron_1.ipcMain.handle('update-download', async () => {
        if (isMac) {
            return downloadMacDmg(mainWindow);
        }
        const updater = loadAutoUpdater();
        if (!updater) {
            return { ok: false, error: (0, i18n_1.mt)('error.updaterUnavailable') };
        }
        if (!electron_1.app.isPackaged) {
            return { ok: false, error: (0, i18n_1.mt)('error.updaterDevMode') };
        }
        try {
            // electron-updater requires its own check before it can download.
            await updater.checkForUpdates();
            await updater.downloadUpdate();
            return { ok: true };
        }
        catch (e) {
            return { ok: false, error: msg(e) };
        }
    });
    electron_1.ipcMain.handle('update-install', async () => {
        if (isMac) {
            if (downloadedMacPath) {
                await electron_1.shell.openPath(downloadedMacPath);
            }
            return { ok: true };
        }
        const updater = loadAutoUpdater();
        if (!updater) {
            return { ok: false, error: (0, i18n_1.mt)('error.updaterUnavailable') };
        }
        // Defer so the IPC reply is delivered before the app quits to install.
        setImmediate(() => updater.quitAndInstall(true, true));
        return { ok: true };
    });
}
//# sourceMappingURL=updater.js.map