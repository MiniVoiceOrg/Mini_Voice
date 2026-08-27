import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { LIMITS } from '@monky/shared';
import { ServerConfig } from '../../server';
import { SqliteServerRepository } from '../../infrastructure/database/SqliteRepositories';
import { ANSI, color, DEFAULT_SERVER_NAME } from '../constants';
import { dataDbPath, GlobalArgs, readLocalConfig, withContext } from '../context';
import { parseOption, parsePositiveInt } from '../formatters';
import {
  ensurePm2,
  generateEcosystem,
  getEcosystemPath,
  PM2_PROCESS_NAME,
} from '../pm2';

export async function loadStoredServer(dataDir: string): Promise<Awaited<ReturnType<SqliteServerRepository['getServer']>>> {
  if (!fs.existsSync(dataDbPath(dataDir))) {
    return null;
  }
  return withContext(dataDir, async (ctx) => ctx.serverRepo.getServer(), false);
}

export async function buildStartConfig(dataDir: string, args: string[]): Promise<ServerConfig> {
  const storedServer = await loadStoredServer(dataDir);
  const localConfig = readLocalConfig(dataDir);
  const port = parseOption(args, '--port');
  const name = parseOption(args, '--name');
  const password = parseOption(args, '--password');
  const maxUsers = parseOption(args, '--max-users');
  const initialVoiceChannel = parseOption(args, '--voice-channel');
  const initialTextChannel = parseOption(args, '--text-channel');

  return {
    port: port ? parsePositiveInt('port', port) : (localConfig.port || LIMITS.DEFAULT_PORT),
    dataDir,
    serverName: name || storedServer?.name || DEFAULT_SERVER_NAME,
    password: storedServer ? '' : (password || ''),
    maxUsers: storedServer?.maxUsers || (maxUsers ? parsePositiveInt('max-users', maxUsers) : LIMITS.MAX_USERS_DEFAULT),
    initialVoiceChannel,
    initialTextChannel,
  };
}

export async function startServerCommand(globalArgs: GlobalArgs, args: string[]): Promise<void> {
  const dataDir = globalArgs.dataDir;
  await fs.promises.mkdir(dataDir, { recursive: true });

  ensurePm2();

  const config = await buildStartConfig(dataDir, args);
  const ecosystemPath = getEcosystemPath(dataDir);
  const ecosystemContent = generateEcosystem(dataDir, config.port, config.serverName || DEFAULT_SERVER_NAME);
  await fs.promises.writeFile(ecosystemPath, ecosystemContent, 'utf8');

  // Clean up legacy ecosystem.config.js if it exists
  const legacyEcosystemPath = path.join(dataDir, 'ecosystem.config.js');
  if (fs.existsSync(legacyEcosystemPath)) {
    try {
      await fs.promises.unlink(legacyEcosystemPath);
    } catch {}
  }

  // Check if already running
  const listResult = spawnSync('pm2', ['jlist'], { encoding: 'utf8', shell: true });
  if (listResult.status === 0) {
    try {
      const processes = JSON.parse(listResult.stdout);
      const existing = processes.find((p: any) => p.name === PM2_PROCESS_NAME && p.pm2_env?.status === 'online');
      if (existing) {
        console.log(color(`O servidor já está em execução (PID ${existing.pid}).`, ANSI.yellow));
        console.log(color('Use "monky restart" para reiniciar ou "monky stop" para parar.', ANSI.dim));
        return;
      }
    } catch { /* ignore parse errors */ }
  }

  const result = spawnSync('pm2', ['start', ecosystemPath], { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    throw new Error('Falha ao iniciar o servidor via PM2.');
  }

  console.log();
  console.log(color('Servidor Monky iniciado com sucesso!', ANSI.green));
  console.log(`porta: ${config.port}`);
  console.log(`dataDir: ${path.resolve(dataDir)}`);
  console.log(`serverName: ${config.serverName}`);
  console.log();
  console.log(color('Comandos úteis:', ANSI.bold));
  console.log(`  monky status    — ver estado do servidor`);
  console.log(`  monky logs      — ver logs em tempo real`);
  console.log(`  monky restart   — reiniciar o servidor`);
  console.log(`  monky stop      — parar o servidor`);
}

export async function stopServerCommand(_dataDir: string): Promise<void> {
  ensurePm2();

  const result = spawnSync('pm2', ['stop', PM2_PROCESS_NAME], { encoding: 'utf8', shell: true });
  if (result.status !== 0) {
    if (result.stderr?.includes('not found') || result.stdout?.includes('not found')) {
      console.log(color('Nenhum servidor Monky em execução foi encontrado.', ANSI.yellow));
      return;
    }
    throw new Error('Falha ao parar o servidor.');
  }

  spawnSync('pm2', ['delete', PM2_PROCESS_NAME], { stdio: 'ignore', shell: true });
  console.log(color('Servidor Monky parado com sucesso.', ANSI.green));
}

export async function restartServerCommand(_dataDir: string): Promise<void> {
  ensurePm2();

  const result = spawnSync('pm2', ['restart', PM2_PROCESS_NAME], { encoding: 'utf8', shell: true });
  if (result.status !== 0) {
    if (result.stderr?.includes('not found') || result.stdout?.includes('not found')) {
      console.log(color('Nenhum servidor Monky em execução. Use "monky start" primeiro.', ANSI.yellow));
      return;
    }
    throw new Error('Falha ao reiniciar o servidor.');
  }

  console.log(color('Servidor Monky reiniciado com sucesso.', ANSI.green));
}

export function logsServerCommand(): void {
  ensurePm2();

  console.log(color('Exibindo logs do servidor (Ctrl+C para sair)...', ANSI.dim));
  spawnSync('pm2', ['logs', PM2_PROCESS_NAME, '--lines', '50'], { stdio: 'inherit', shell: true });
}

export function statusServerCommand(): void {
  ensurePm2();

  const listResult = spawnSync('pm2', ['jlist'], { encoding: 'utf8', shell: true });
  if (listResult.status !== 0) {
    console.log(color('Não foi possível verificar o estado do servidor.', ANSI.yellow));
    return;
  }

  try {
    const processes = JSON.parse(listResult.stdout);
    const monky = processes.find((p: any) => p.name === PM2_PROCESS_NAME);
    if (!monky) {
      console.log(color('Servidor Monky não está registrado no PM2.', ANSI.yellow));
      console.log(color('Use "monky start" para iniciar.', ANSI.dim));
      return;
    }

    const status = monky.pm2_env?.status || 'unknown';
    const pid = monky.pid || '-';
    const uptime = monky.pm2_env?.pm_uptime ? new Date(monky.pm2_env.pm_uptime).toISOString() : '-';
    const restarts = monky.pm2_env?.restart_time ?? 0;
    const memory = monky.monit?.memory ? `${Math.round(monky.monit.memory / 1024 / 1024)} MB` : '-';
    const cpu = monky.monit?.cpu !== undefined ? `${monky.monit.cpu}%` : '-';

    const statusColor = status === 'online' ? ANSI.green : status === 'stopped' ? ANSI.yellow : ANSI.red;

    console.log(color('Estado do Servidor Monky', ANSI.bold));
    console.log(`status: ${color(status, statusColor)}`);
    console.log(`pid: ${pid}`);
    console.log(`uptime: ${uptime}`);
    console.log(`restarts: ${restarts}`);
    console.log(`memory: ${memory}`);
    console.log(`cpu: ${cpu}`);
  } catch {
    // Fallback to pm2 show
    spawnSync('pm2', ['show', PM2_PROCESS_NAME], { stdio: 'inherit', shell: true });
  }
}
