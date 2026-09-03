import { app, BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { UpdateOutcome } from '@monky/shared';
import { mt } from './i18n';
import { beginUpdateInstall, consumeUpdateOutcome } from './updateInstall';
import {
  cleanVer,
  feedUrlForTag,
  GithubRelease,
  isNewer,
  pickBestRelease,
} from './updateVersions';

const GITHUB_REPO = 'MonkyOrg/Monky';

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
  setFeedURL: (options: { provider: 'generic'; url: string }) => void;
  checkForUpdates: () => Promise<{ updateInfo?: { version: string } } | null>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
};

let autoUpdater: AutoUpdater | null = null;

// Whether the user opted into the beta channel (set from the renderer via the
// `update-set-channel` IPC). When true, update detection also considers GitHub
// pre-releases and electron-updater is allowed to download them.
let betaChannel = false;

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

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── Update detection via GitHub API (reliable on all platforms) ──────────────

interface MacAsset {
  version: string;
  name: string;
  url: string;
}

let pendingMacAsset: MacAsset | null = null;
let downloadedMacPath: string | null = null;

/**
 * Grace period between opening the .dmg and quitting on macOS. Finder needs a
 * moment to mount the image and bring its window to the front; quitting in the
 * same tick would make the app vanish before the user sees where the new
 * version is. The mount itself belongs to Finder, so it survives our exit.
 */
const MAC_QUIT_DELAY_MS = 5000;

/**
 * Quits so Finder can replace the app bundle (#377).
 *
 * macOS refuses to overwrite a bundle whose app is running, so the manual
 * update flow used to dead-end: the .dmg opened, the user dragged Monky into
 * Applications, and the replace failed with "Monky is in use" — with no obvious
 * way out other than hunting for the app in the Dock. Closing on our own is the
 * same thing the Windows flow already does after downloading.
 */
function quitForMacInstall(delayMs: number): void {
  setTimeout(() => {
    app.quit();
    // `app.quit()` can be vetoed by a window that refuses to close, which would
    // strand the user in the exact dead-end this is meant to solve. By this
    // point `before-quit` has already run its cleanup, so exiting for real is
    // safe.
    setTimeout(() => app.exit(0), 4000);
  }, delayMs);
}

/**
 * Version electron-updater finished downloading, so the install step can name
 * it on the progress window even when the user triggers it later by hand.
 */
let downloadedVersion = '';

/**
 * Tag of the release `checkViaGitHub` decided the user should get. The download
 * step points electron-updater straight at it instead of letting the library
 * find a release on its own — see `feedUrlForTag`.
 */
let pendingTag: string | null = null;

/**
 * Fetches the release the user should be offered. Stable users get GitHub's
 * "latest release" (which excludes pre-releases). Beta users list all recent
 * releases (including pre-releases) and pick the one with the highest SemVer —
 * so a newer beta, or the final stable that supersedes it, is always chosen.
 *
 * The page is asked at its maximum size because the repository already has well
 * over a hundred releases, and a short window could cut off the very release
 * being looked for.
 */
async function fetchTargetRelease(): Promise<GithubRelease | null | { error: string }> {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Monky-App' };

  if (betaChannel) {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100`, {
      headers,
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return pickBestRelease(await res.json());
  }

  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { headers });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  return (await res.json()) as GithubRelease;
}

/**
 * Detects updates by querying the GitHub releases API on all platforms and
 * comparing with the running app version. This is more reliable than
 * electron-updater's own check (which can return null when a check is cached or
 * already in progress). It also records what to download: the matching .dmg on
 * macOS, the release tag everywhere else.
 */
async function checkViaGitHub(): Promise<CheckResult> {
  pendingTag = null;
  pendingMacAsset = null;
  try {
    const rel = await fetchTargetRelease();
    if (rel && 'error' in rel) return { ok: false, error: rel.error };
    if (!rel) return { ok: true, available: false };

    const version = (rel.tag_name ?? '').replace(/^v/i, '');
    if (!version || !isNewer(version, app.getVersion())) {
      return { ok: true, available: false, version };
    }

    pendingTag = rel.tag_name ?? null;

    // On macOS, record the .dmg matching the current CPU architecture so the
    // download step can fetch it directly.
    if (process.platform === 'darwin') {
      const wantArm = process.arch === 'arm64';
      const dmgs = (rel.assets ?? []).filter((a) => a.name.endsWith('.dmg'));
      const asset =
        dmgs.find((a) => (wantArm ? /arm64/i.test(a.name) : !/arm64/i.test(a.name))) ?? dmgs[0];
      if (asset) {
        pendingMacAsset = { version, name: asset.name, url: asset.browser_download_url };
      }
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
        .get(currentUrl, { headers: { 'User-Agent': 'Monky-App' } }, (response) => {
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
    return { ok: false, error: mt('error.noPendingUpdate') };
  }
  try {
    const destPath = path.join(app.getPath('temp'), pendingMacAsset.name);
    await downloadToFile(pendingMacAsset.url, destPath, (pct) => {
      mainWindow.webContents.send('updater:progress', pct);
    });
    downloadedMacPath = destPath;

    // Open the .dmg so the user can drag the app into Applications. A failure
    // here means there is nothing on screen to install from, so the app must
    // not go ahead and close.
    const openError = await shell.openPath(destPath);
    if (openError) {
      mainWindow.webContents.send('updater:error', openError);
      return { ok: false, error: openError };
    }

    mainWindow.webContents.send('updater:downloaded', { manual: true });
    quitForMacInstall(MAC_QUIT_DELAY_MS);
    return { ok: true };
  } catch (e) {
    mainWindow.webContents.send('updater:error', msg(e));
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
        mainWindow.webContents.send('updater:progress', Math.round(percent));
      });
      updater.on('update-downloaded', (info) => {
        downloadedVersion = cleanVer((info as { version?: string })?.version ?? '');
        mainWindow.webContents.send('updater:downloaded', { manual: false });
        // Install silently and relaunch automatically — no installer wizard.
        // The progress window takes over the screen first so the user knows why
        // the app is about to disappear, and knows not to reopen it (#498).
        setTimeout(() => {
          try {
            beginUpdateInstall(downloadedVersion, mainWindow);
            updater.quitAndInstall(true, true);
          } catch (e) {
            mainWindow.webContents.send('updater:error', msg(e));
          }
        }, 1500);
      });
      updater.on('error', (err) => {
        mainWindow.webContents.send('updater:error', msg(err));
      });
    }
  }

  ipcMain.handle('updater:set-channel', async (_e, allowBeta: unknown): Promise<CheckResult> => {
    betaChannel = !!allowBeta;
    // Which releases are eligible is decided by `fetchTargetRelease`, which
    // queries the GitHub API itself. electron-updater is handed the chosen
    // release as a generic feed (see `updater:download`), so its own channel and
    // pre-release settings no longer take part in the decision — leaving them
    // alone avoids the ERR_UPDATER_NO_PUBLISHED_VERSIONS its GitHub provider
    // used to throw on pre-release builds.
    // A pending target from the previous channel would be stale.
    pendingTag = null;
    pendingMacAsset = null;
    return { ok: true };
  });

  ipcMain.handle('updater:check', async (): Promise<CheckResult> => {
    // Detection is done via the GitHub API on every platform for reliability.
    return checkViaGitHub();
  });

  ipcMain.handle('updater:download', async (): Promise<CheckResult> => {
    if (isMac) {
      return downloadMacDmg(mainWindow);
    }
    const updater = loadAutoUpdater();
    if (!updater) {
      return { ok: false, error: mt('error.updaterUnavailable') };
    }
    if (!app.isPackaged) {
      return { ok: false, error: mt('error.updaterDevMode') };
    }
    try {
      // Point electron-updater straight at the release `checkViaGitHub` picked,
      // as a generic feed, instead of letting its GitHub provider search for one
      // (#354).
      //
      // Betas used to be tagged `v3.1.0-beta003` — zero padded and without a
      // dot, so that GitHub's releases page (which sorts by tag name) listed
      // them in order while the version stayed valid SemVer (#338). But
      // `semver.prerelease` read the whole `beta003` as one identifier, so
      // electron-updater saw a *custom channel* named `beta003` rather than the
      // `beta` channel, and its release loop only accepts releases whose
      // channel matches. Nothing matched except the running build itself, so
      // `checkForUpdates` concluded "no update", `downloadUpdate` had nothing
      // recorded to fetch and failed with "Please check update first". Tags
      // carry a plain `-beta` since #382, so that trap is gone.
      //
      // Letting the provider search is still wrong, though: its loop takes the
      // first release of the matching channel in the feed, which may be *older*
      // than the one the user is on. Our own SemVer comparison already picked
      // the right release, so the library only needs to be told where it is.
      if (!pendingTag) {
        const recheck = await checkViaGitHub();
        if (!recheck.ok) return recheck;
      }
      if (!pendingTag) {
        return { ok: false, error: mt('error.noPendingUpdate') };
      }
      updater.setFeedURL({ provider: 'generic', url: feedUrlForTag(pendingTag) });
      // electron-updater requires its own check before it can download.
      await updater.checkForUpdates();
      await updater.downloadUpdate();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  });

  ipcMain.handle('updater:install', async (): Promise<CheckResult> => {
    if (isMac) {
      if (downloadedMacPath) {
        const openError = await shell.openPath(downloadedMacPath);
        if (openError) {
          return { ok: false, error: openError };
        }
      }
      // Asked for explicitly, so there is no reason to wait as long as the
      // automatic path does.
      quitForMacInstall(1000);
      return { ok: true };
    }
    const updater = loadAutoUpdater();
    if (!updater) {
      return { ok: false, error: mt('error.updaterUnavailable') };
    }
    // Defer so the IPC reply is delivered before the app quits to install.
    setImmediate(() => {
      beginUpdateInstall(downloadedVersion || cleanVer(pendingTag ?? ''), mainWindow);
      updater.quitAndInstall(true, true);
    });
    return { ok: true };
  });

  // Reported once per launch, right after an install: the renderer turns it
  // into the "updated to X" (or "update did not finish") banner (#498).
  ipcMain.handle('updater:outcome', async (): Promise<UpdateOutcome | null> => {
    return consumeUpdateOutcome();
  });
}
