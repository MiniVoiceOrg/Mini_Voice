import fs from 'fs';
import path from 'path';

/**
 * Ids are minted by the renderer, so they are treated as untrusted input here:
 * anything outside this shape could walk out of the data folder with `..`.
 */
const SAFE_SERVER_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Everything a server keeps inside its own data directory. */
const SERVER_DATA_ENTRIES = ['server.db', 'avatars', 'attachments'];

export function isSafeServerId(serverId: string): boolean {
  return SAFE_SERVER_ID.test(serverId);
}

/** The folder that belongs to one entry of "Meus Servidores". */
export function serverDataDirFor(baseDir: string, serverId: string): string {
  return path.join(baseDir, serverId);
}

/**
 * Until #364 every created server shared the same `server-data` folder, so the
 * second server created reopened the first one's database: the seed step is a
 * no-op when a server row already exists, which is why the old name, password
 * and channels came back under a server that was supposedly new.
 *
 * Each server now owns a folder. The flat layout left behind is adopted by the
 * first server that starts after the update — for anyone with a single server,
 * the only one it could have belonged to. Returns whether anything was moved.
 */
export function migrateLegacyServerData(baseDir: string, targetDir: string): boolean {
  if (!fs.existsSync(path.join(baseDir, 'server.db'))) return false;
  // A folder that already has its own database is not waiting for an heirloom.
  if (fs.existsSync(path.join(targetDir, 'server.db'))) return false;

  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of SERVER_DATA_ENTRIES) {
    const from = path.join(baseDir, entry);
    if (!fs.existsSync(from)) continue;
    fs.renameSync(from, path.join(targetDir, entry));
  }
  return true;
}
