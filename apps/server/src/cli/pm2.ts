import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import { ANSI, color } from './constants';
import { canonicalDataDir, LEGACY_PM2_PROCESS_NAME, serverIdFor } from './registry';

export const PM2_PROCESS_PREFIX = 'monky-server';
export const UPDATER_PROCESS_PREFIX = 'monky-updater';
export const LEGACY_UPDATER_PROCESS_NAME = 'monky-updater';
export const AUTO_UPDATE_CRON = '0 4 * * *'; // daily at 4am

export { LEGACY_PM2_PROCESS_NAME };

/**
 * PM2 process name for a server, derived from its data directory.
 *
 * A fixed name allowed a single server per machine: starting a second one from
 * another directory silently reported "already running", and stopping any of
 * them stopped whichever happened to be registered.
 */
export function getPm2ProcessName(dataDir: string): string {
  return `${PM2_PROCESS_PREFIX}-${serverIdFor(dataDir)}`;
}

export function getUpdaterProcessName(dataDir: string): string {
  return `${UPDATER_PROCESS_PREFIX}-${serverIdFor(dataDir)}`;
}

export function isPm2Available(): boolean {
  try {
    execSync('pm2 --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export interface Pm2Process {
  name?: string;
  pid?: number;
  monit?: { memory?: number; cpu?: number };
  pm2_env?: {
    status?: string;
    pm_uptime?: number;
    restart_time?: number;
    pm_cwd?: string;
    args?: string[] | string;
  };
}

export function listPm2Processes(): Pm2Process[] {
  if (!isPm2Available()) return [];
  try {
    const listResult = spawnSync('pm2', ['jlist'], { encoding: 'utf8', shell: true });
    if (listResult.status !== 0) return [];
    const parsed = JSON.parse(listResult.stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function findPm2Process(processName: string): Pm2Process | null {
  return listPm2Processes().find((entry) => entry.name === processName) ?? null;
}

export function isMonkyServerRunning(processName: string): boolean {
  return findPm2Process(processName)?.pm2_env?.status === 'online';
}

/**
 * Whether PM2 knows about the server at all, regardless of its status.
 *
 * Reading logs is still useful for a stopped or crashed process, so this is a
 * weaker check than {@link isMonkyServerRunning}.
 */
export function isMonkyServerRegistered(processName: string): boolean {
  return findPm2Process(processName) !== null;
}

export function readProcessDataDir(entry: Pm2Process): string | null {
  const rawArgs = entry.pm2_env?.args;
  const args = Array.isArray(rawArgs) ? rawArgs : typeof rawArgs === 'string' ? rawArgs.split(/\s+/) : [];
  const dataIndex = args.indexOf('--data');
  if (dataIndex >= 0 && args[dataIndex + 1]) {
    return canonicalDataDir(args[dataIndex + 1].replace(/^"|"$/g, ''));
  }
  return entry.pm2_env?.pm_cwd ? canonicalDataDir(entry.pm2_env.pm_cwd) : null;
}

/**
 * Data directories of every Monky process PM2 knows about, including the
 * pre-registry process name so older installations are not lost on upgrade.
 */
export function discoverPm2DataDirs(): string[] {
  const found: string[] = [];
  for (const entry of listPm2Processes()) {
    const name = entry.name ?? '';
    if (name !== LEGACY_PM2_PROCESS_NAME && !name.startsWith(`${PM2_PROCESS_PREFIX}-`)) continue;
    const dataDir = readProcessDataDir(entry);
    if (dataDir) found.push(dataDir);
  }
  return found;
}

/**
 * The pre-registry process, when it points at the given data directory.
 *
 * Upgrading must not leave an orphan `monky-server` running alongside the new
 * per-directory process on the same port.
 */
export function findLegacyProcessFor(dataDir: string): Pm2Process | null {
  const legacy = findPm2Process(LEGACY_PM2_PROCESS_NAME);
  if (!legacy) return null;
  const legacyDataDir = readProcessDataDir(legacy);
  return legacyDataDir === canonicalDataDir(dataDir) ? legacy : null;
}

export function ensurePm2(): void {
  if (!isPm2Available()) {
    console.log(color('PM2 não encontrado. Instalando globalmente...', ANSI.yellow));
    try {
      execSync('npm install -g pm2', { stdio: 'inherit' });
    } catch {
      throw new Error('Falha ao instalar PM2. Instale manualmente: npm install -g pm2');
    }
  }
}

/**
 * Reports PM2 as missing without installing it.
 *
 * Only `monky start` needs PM2 badly enough to install it; reading status or
 * stopping a server should never install software as a side effect.
 */
export function requirePm2(action: string): boolean {
  if (isPm2Available()) return true;
  console.log(color(`PM2 não está instalado, então não há o que ${action}.`, ANSI.yellow));
  console.log(color('Instale com: npm install -g pm2', ANSI.dim));
  return false;
}

export function getEcosystemPath(dataDir: string): string {
  return path.join(dataDir, 'ecosystem.config.cjs');
}

export function getServerEntryPath(): string {
  return path.resolve(__dirname, '..', 'index.js');
}

/** Absolute path of the compiled CLI entry point, for generated scripts. */
export function getCliEntryPath(): string {
  return path.resolve(__dirname, '..', 'cli.js');
}

export interface EcosystemOptions {
  dataDir: string;
  port: number;
  serverName: string;
}

export function generateEcosystem(options: EcosystemOptions): string {
  const entryPath = getServerEntryPath().replace(/\\/g, '\\\\');
  const resolvedDataDir = canonicalDataDir(options.dataDir).replace(/\\/g, '\\\\');
  const serverName = options.serverName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `module.exports = {
  apps: [{
    name: '${getPm2ProcessName(options.dataDir)}',
    script: '${entryPath}',
    args: '--data "${resolvedDataDir}" --port ${options.port} --name "${serverName}"',
    cwd: '${resolvedDataDir}',
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
`;
}

/**
 * Writes the ecosystem file, replacing the pre-ESM `.js` variant.
 *
 * `monky start`, `monky restart` and `monky config set port` all need the file
 * refreshed before handing control to PM2, so they share this single writer.
 */
export function writeEcosystem(options: EcosystemOptions): string {
  const ecosystemPath = getEcosystemPath(options.dataDir);
  fs.writeFileSync(ecosystemPath, generateEcosystem(options), 'utf8');

  const legacyEcosystemPath = path.join(options.dataDir, 'ecosystem.config.js');
  if (fs.existsSync(legacyEcosystemPath)) {
    try {
      fs.unlinkSync(legacyEcosystemPath);
    } catch {}
  }

  return ecosystemPath;
}
