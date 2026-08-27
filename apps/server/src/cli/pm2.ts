import path from 'path';
import { execSync, spawnSync } from 'child_process';
import { ANSI, color } from './constants';

export const PM2_PROCESS_NAME = 'monky-server';
export const UPDATER_PROCESS_NAME = 'monky-updater';
export const AUTO_UPDATE_CRON = '0 4 * * *'; // daily at 4am

export function isPm2Available(): boolean {
  try {
    execSync('pm2 --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function isMonkyServerRunning(): boolean {
  if (!isPm2Available()) return false;
  try {
    const listResult = spawnSync('pm2', ['jlist'], { encoding: 'utf8', shell: true });
    if (listResult.status !== 0) return false;
    const processes = JSON.parse(listResult.stdout);
    return processes.some((p: any) => p.name === PM2_PROCESS_NAME && p.pm2_env?.status === 'online');
  } catch {
    return false;
  }
}

/**
 * Whether PM2 knows about the server at all, regardless of its status.
 *
 * Reading logs is still useful for a stopped or crashed process, so this is a
 * weaker check than {@link isMonkyServerRunning}.
 */
export function isMonkyServerRegistered(): boolean {
  if (!isPm2Available()) return false;
  try {
    const listResult = spawnSync('pm2', ['jlist'], { encoding: 'utf8', shell: true });
    if (listResult.status !== 0) return false;
    const processes = JSON.parse(listResult.stdout);
    return processes.some((p: any) => p.name === PM2_PROCESS_NAME);
  } catch {
    return false;
  }
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

export function getEcosystemPath(dataDir: string): string {
  return path.join(dataDir, 'ecosystem.config.cjs');
}

export function getServerEntryPath(): string {
  return path.resolve(__dirname, '..', 'index.js');
}

export function generateEcosystem(dataDir: string, port: number, serverName: string): string {
  const entryPath = getServerEntryPath().replace(/\\/g, '\\\\');
  const resolvedDataDir = path.resolve(dataDir).replace(/\\/g, '\\\\');
  return `module.exports = {
  apps: [{
    name: '${PM2_PROCESS_NAME}',
    script: '${entryPath}',
    args: '--data "${resolvedDataDir}" --port ${port} --name "${serverName.replace(/"/g, '\\"')}"',
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
