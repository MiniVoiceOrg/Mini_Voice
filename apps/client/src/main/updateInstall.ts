import { app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { UpdateOutcome } from '@monky/shared';
import { getMainLanguage, mt, setMainLanguage } from './i18n';
/**
 * Windows/Linux install handoff (#498).
 *
 * `quitAndInstall` runs the NSIS installer silently and kills the app, so the
 * screen goes empty for several seconds with no clue that anything is
 * happening. Worse, clicking the icon during that window either fails with a
 * Windows error (the executable is mid-replacement) or starts a second copy on
 * top of the install.
 *
 * Two things fix that from the app side:
 *
 * 1. A small always-on-top window replaces the main UI right before quitting,
 *    saying what is being installed and asking the user not to reopen the app.
 * 2. A sentinel file records the install. Any launch that happens while it is
 *    fresh shows the same window instead of the normal UI and exits, and the
 *    first launch after the install reports the outcome to the renderer.
 */

const SENTINEL_FILE = 'update-install.json';

/**
 * How long a recorded install is trusted. A crashed or cancelled installer
 * would otherwise lock the app out forever, so after this the sentinel is
 * dropped and the launch proceeds (reported as a failed update).
 */
const STALE_AFTER_MS = 10 * 60 * 1000;

/** How long the "already installing" window stays up before the launch aborts. */
const BUSY_WINDOW_MS = 8000;

interface Sentinel {
  targetVersion: string;
  fromVersion: string;
  startedAt: number;
  language: string;
}

let installWindow: BrowserWindow | null = null;
let pendingOutcome: UpdateOutcome | null = null;

function sentinelPath(): string {
  return path.join(app.getPath('userData'), SENTINEL_FILE);
}

function readSentinel(): Sentinel | null {
  try {
    const raw = fs.readFileSync(sentinelPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<Sentinel>;
    if (!parsed.targetVersion || typeof parsed.startedAt !== 'number') return null;
    return {
      targetVersion: parsed.targetVersion,
      fromVersion: parsed.fromVersion ?? '',
      startedAt: parsed.startedAt,
      language: parsed.language ?? 'pt-BR',
    };
  } catch {
    return null;
  }
}

function clearSentinel(): void {
  try {
    fs.rmSync(sentinelPath(), { force: true });
  } catch {
    // Non-fatal: a stale sentinel expires on its own.
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml(message: string, hint: string): string {
  return `<!DOCTYPE html>
<html lang="${getMainLanguage()}">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
<title>${escapeHtml(mt('updateInstall.title'))}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 26px 30px;
    background: #0b0e14;
    color: #f0f3f6;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    text-align: center;
    user-select: none;
    cursor: default;
    border: 1px solid #262c36;
    -webkit-app-region: drag;
  }
  .spinner {
    width: 30px;
    height: 30px;
    border: 3px solid #262c36;
    border-top-color: #5865f2;
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .title { font-size: 15px; font-weight: 600; }
  .hint { font-size: 12.5px; line-height: 1.45; color: #9da7b3; max-width: 340px; }
</style>
</head>
<body>
  <div class="spinner"></div>
  <div class="title">${escapeHtml(message)}</div>
  <div class="hint">${escapeHtml(hint)}</div>
</body>
</html>`;
}

function openWindow(message: string, hint: string): BrowserWindow | null {
  try {
    if (installWindow && !installWindow.isDestroyed()) {
      return installWindow;
    }
    const win = new BrowserWindow({
      width: 420,
      height: 220,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      frame: false,
      alwaysOnTop: true,
      center: true,
      show: false,
      backgroundColor: '#0b0e14',
      title: mt('updateInstall.title'),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.setMenuBarVisibility(false);
    win.on('closed', () => {
      installWindow = null;
    });
    win.once('ready-to-show', () => win.show());
    void win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(buildHtml(message, hint))}`
    );
    installWindow = win;
    return win;
  } catch {
    // A missing splash must never block the update itself.
    return null;
  }
}

/**
 * Resolves once the splash is actually on screen (or right away if it could not
 * be created). `quitAndInstall` tears the whole app down, so calling it in the
 * same tick as `openWindow` — as the update flow used to — killed the window
 * before it ever painted, which is why #498's progress window never showed. The
 * fallback timer makes sure a late or missing paint never blocks the install.
 */
function whenVisible(win: BrowserWindow | null): Promise<void> {
  if (!win || win.isDestroyed() || win.isVisible()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    win.once('show', finish);
    setTimeout(finish, 2000);
  });
}

/**
 * Records the install and swaps the UI for the progress window. Called right
 * before `quitAndInstall`, so the last thing on screen explains the wait
 * instead of the window simply vanishing.
 *
 * Resolves once the splash has painted so the caller can hold `quitAndInstall`
 * back until the window is really visible (#498).
 */
export function beginUpdateInstall(targetVersion: string, mainWindow?: BrowserWindow): Promise<void> {
  if (targetVersion && targetVersion !== app.getVersion()) {
    const sentinel: Sentinel = {
      targetVersion,
      fromVersion: app.getVersion(),
      startedAt: Date.now(),
      language: getMainLanguage(),
    };
    try {
      fs.writeFileSync(sentinelPath(), JSON.stringify(sentinel), 'utf-8');
    } catch {
      // Non-fatal: the splash below still gives the user feedback.
    }
  }

  const win = openWindow(
    targetVersion
      ? mt('updateInstall.installing', { version: targetVersion })
      : mt('updateInstall.installingGeneric'),
    mt('updateInstall.installingHint')
  );

  // Hiding rather than closing keeps the renderer alive for the goodbye that
  // `before-quit` sends to the servers (#458).
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.hide();
  }

  return whenVisible(win);
}

/**
 * Reads the sentinel at startup.
 *
 * Returns `true` when an install is still running, in which case the caller
 * must not build the normal window — a second copy of the app on top of a
 * half-replaced installation is exactly what #498 is about. The result of a
 * finished install is stashed for `consumeUpdateOutcome`.
 */
export function handleLaunchDuringUpdate(): boolean {
  const sentinel = readSentinel();
  if (!sentinel) return false;

  setMainLanguage(sentinel.language);

  if (app.getVersion() === sentinel.targetVersion) {
    clearSentinel();
    pendingOutcome = {
      status: 'success',
      version: sentinel.targetVersion,
      fromVersion: sentinel.fromVersion,
    };
    // The old process's splash died when it quit for the silent install, and the
    // fresh process still has a cold start ahead of it — that is the long dark
    // gap the user sees. Put the splash straight back up so it visually carries
    // through the cold boot; main.ts then dismisses it the instant the main
    // window has painted, so it only disappears as Monky actually opens (#498).
    openWindow(mt('updateInstall.finishing'), mt('updateInstall.finishingHint'));
    return false;
  }

  if (Date.now() - sentinel.startedAt >= STALE_AFTER_MS) {
    clearSentinel();
    pendingOutcome = { status: 'failed', version: sentinel.targetVersion };
    return false;
  }

  openWindow(
    mt('updateInstall.busy', { version: sentinel.targetVersion }),
    mt('updateInstall.busyHint')
  );
  setTimeout(() => app.exit(0), BUSY_WINDOW_MS);
  return true;
}

/**
 * Whether the post-install splash is currently on screen. main.ts uses this to
 * decide whether to hold the main window back until it has painted (#498).
 */
export function isInstallSplashActive(): boolean {
  return !!installWindow && !installWindow.isDestroyed();
}

/**
 * Closes the splash. Called the moment the main window is ready, so the hand-off
 * from "finishing update" to the live UI has no dark gap in between (#498).
 */
export function dismissInstallSplash(): void {
  if (installWindow && !installWindow.isDestroyed()) {
    installWindow.close();
  }
  installWindow = null;
}

/**
 * Hands the result of the last install to the renderer, once. The banner it
 * feeds is the only confirmation the user gets that the update actually landed.
 */
export function consumeUpdateOutcome(): UpdateOutcome | null {
  const outcome = pendingOutcome;
  pendingOutcome = null;
  return outcome;
}
