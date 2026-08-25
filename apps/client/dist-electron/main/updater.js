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
const GITHUB_REPO = 'MiniVoiceOrg/Mini_Voice';
let autoUpdater = null;
// Whether the user opted into the beta channel (set from the renderer via the
// `update-set-channel` IPC). When true, update detection also considers GitHub
// pre-releases and electron-updater is allowed to download them.
let betaChannel = false;
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
function cleanVer(v) {
    return String(v ?? '').replace(/^v/i, '').trim();
}
/**
 * Compares two semver strings following SemVer precedence, including the
 * pre-release rule that a release (e.g. `1.8.0`) outranks any of its
 * pre-releases (e.g. `1.8.0-beta.3`), and that `-beta.10 > -beta.2`.
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
function compareVersions(a, b) {
    const na = cleanVer(a).split('-');
    const nb = cleanVer(b).split('-');
    const pa = na[0].split('.').map((n) => parseInt(n, 10) || 0);
    const pb = nb[0].split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const x = pa[i] ?? 0;
        const y = pb[i] ?? 0;
        if (x > y)
            return 1;
        if (x < y)
            return -1;
    }
    // Numeric parts equal — apply pre-release precedence.
    const preA = na.slice(1).join('-');
    const preB = nb.slice(1).join('-');
    if (!preA && !preB)
        return 0;
    if (!preA)
        return 1; // a is a release, b is a pre-release
    if (!preB)
        return -1; // a is a pre-release, b is a release
    return comparePrerelease(preA, preB);
}
function comparePrerelease(a, b) {
    const ai = a.split('.');
    const bi = b.split('.');
    const len = Math.max(ai.length, bi.length);
    for (let i = 0; i < len; i++) {
        const x = ai[i];
        const y = bi[i];
        if (x === undefined)
            return -1;
        if (y === undefined)
            return 1;
        const xn = /^\d+$/.test(x);
        const yn = /^\d+$/.test(y);
        if (xn && yn) {
            const d = parseInt(x, 10) - parseInt(y, 10);
            if (d !== 0)
                return d > 0 ? 1 : -1;
        }
        else if (xn !== yn) {
            return xn ? -1 : 1; // numeric identifiers have lower precedence
        }
        else if (x > y) {
            return 1;
        }
        else if (x < y) {
            return -1;
        }
    }
    return 0;
}
function isNewer(latest, current) {
    return compareVersions(latest, current) > 0;
}
function msg(e) {
    return e instanceof Error ? e.message : String(e);
}
let pendingMacAsset = null;
let downloadedMacPath = null;
/**
 * Fetches the release the user should be offered. Stable users get GitHub's
 * "latest release" (which excludes pre-releases). Beta users list all recent
 * releases (including pre-releases) and pick the one with the highest SemVer —
 * so a newer beta, or the final stable that supersedes it, is always chosen.
 */
async function fetchTargetRelease() {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'MiniVoice-App' };
    if (betaChannel) {
        const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`, {
            headers,
        });
        if (!res.ok)
            return { error: `HTTP ${res.status}` };
        const list = (await res.json());
        const candidates = (Array.isArray(list) ? list : []).filter((r) => r && !r.draft && r.tag_name);
        let best = null;
        for (const r of candidates) {
            if (!best || compareVersions(cleanVer(r.tag_name), cleanVer(best.tag_name)) > 0) {
                best = r;
            }
        }
        return best;
    }
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { headers });
    if (!res.ok)
        return { error: `HTTP ${res.status}` };
    return (await res.json());
}
/**
 * Detects updates by querying the GitHub releases API on all platforms and
 * comparing with the running app version. This is more reliable than
 * electron-updater's own check (which can return null when a check is cached or
 * already in progress). On macOS it also records the matching .dmg to download.
 */
async function checkViaGitHub() {
    try {
        const rel = await fetchTargetRelease();
        if (rel && 'error' in rel)
            return { ok: false, error: rel.error };
        if (!rel)
            return { ok: true, available: false };
        const version = (rel.tag_name ?? '').replace(/^v/i, '');
        if (!version || !isNewer(version, electron_1.app.getVersion())) {
            return { ok: true, available: false, version };
        }
        // On macOS, record the .dmg matching the current CPU architecture so the
        // download step can fetch it directly.
        if (process.platform === 'darwin') {
            const wantArm = process.arch === 'arm64';
            const dmgs = (rel.assets ?? []).filter((a) => a.name.endsWith('.dmg'));
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
        return { ok: false, error: 'Nenhuma atualização pendente' };
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
    electron_1.ipcMain.handle('update-set-channel', async (_e, allowBeta) => {
        betaChannel = !!allowBeta;
        // Keep electron-updater aligned with the chosen channel for the download
        // step. We always publish `latest.yml` (detectUpdateChannel:false), so the
        // channel stays "latest"; only pre-release eligibility changes.
        const updater = loadAutoUpdater();
        if (updater) {
            updater.channel = 'latest';
            updater.allowPrerelease = betaChannel;
        }
        return { ok: true };
    });
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
            return { ok: false, error: 'Updater indisponível' };
        }
        if (!electron_1.app.isPackaged) {
            return { ok: false, error: 'Atualização automática indisponível em modo de desenvolvimento' };
        }
        try {
            // Ensure the updater targets the right channel/pre-release eligibility.
            updater.channel = 'latest';
            updater.allowPrerelease = betaChannel;
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
            return { ok: false, error: 'Updater indisponível' };
        }
        // Defer so the IPC reply is delivered before the app quits to install.
        setImmediate(() => updater.quitAndInstall(true, true));
        return { ok: true };
    });
}
//# sourceMappingURL=updater.js.map