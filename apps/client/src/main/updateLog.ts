import { app } from 'electron';
import fs from 'fs';
import path from 'path';

/**
 * Append-only diagnostic log for the update/install flow (#498, #543).
 *
 * The update spans two processes — the running app that downloads and calls
 * `quitAndInstall`, and the fresh app the NSIS installer relaunches — so the
 * usual per-session `ClientLogger` (created only once the main window exists)
 * cannot see the whole handoff. This writes to a single file in `userData`
 * that both processes append to, giving one ordered timeline of the download,
 * the splash, the sentinel and the relaunch. Each line carries the pid and the
 * running version so the two processes can be told apart.
 *
 * It is intentionally dependency-free and best-effort: a logging failure must
 * never interfere with an actual update.
 */

const LOG_FILE = 'update-flow.log';

/** Absolute path of the update-flow log, handy to surface to the user. */
export function updateLogPath(): string {
  return path.join(app.getPath('userData'), LOG_FILE);
}

export function updateLog(message: string, data?: Record<string, unknown>): void {
  try {
    let version = '?';
    try {
      version = app.getVersion();
    } catch {
      // getVersion can throw very early in startup; the message still logs.
    }
    const suffix = data ? ` ${JSON.stringify(data)}` : '';
    const line = `${new Date().toISOString()} [pid ${process.pid}] [v${version}] ${message}${suffix}\n`;
    fs.appendFileSync(updateLogPath(), line, 'utf-8');
  } catch {
    // Never let diagnostics break the update.
  }
}
