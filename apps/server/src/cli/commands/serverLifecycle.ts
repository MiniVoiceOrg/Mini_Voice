import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { LIMITS, LOG_LEVELS, LogLevel } from '@monky/shared';
import { ServerConfig } from '../../server';
import { SqliteServerRepository } from '../../infrastructure/database/SqliteRepositories';
import { ANSI, color, DEFAULT_SERVER_NAME } from '../constants';
import { dataDbPath, GlobalArgs, readLocalConfig, withContext } from '../context';
import { parseOption, parsePositiveInt } from '../formatters';
import {
  ensurePm2,
  generateEcosystem,
  getEcosystemPath,
  isMonkyServerRegistered,
  isPm2Available,
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

/**
 * Classifies a PM2 output line by the level the server Logger printed it with.
 *
 * The console format is `[timestamp] [CATEGORY]` for INFO and
 * `[timestamp] [WARN:CATEGORY]` / `[ERROR:CATEGORY]` for the rest, and PM2
 * prefixes every line with its own process tag, so the markers are matched
 * anywhere in the line. Lines that match nothing are continuations (stack
 * traces, for instance) and inherit the level of the line above them.
 */
function classifyLogLine(line: string): LogLevel | null {
  if (line.includes('[ERROR:')) return 'ERROR';
  if (line.includes('[WARN:')) return 'WARN';
  if (/\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s+\[[A-Z]+\]/.test(line)) return 'INFO';
  return null;
}

function parseLevelOption(value: string): LogLevel {
  const normalized = value.trim().toUpperCase();
  if ((LOG_LEVELS as string[]).includes(normalized)) return normalized as LogLevel;
  throw new Error(`Nível inválido: ${value}. Use ${LOG_LEVELS.join(', ')}.`);
}

export function logsServerCommand(args: string[] = []): void {
  const linesOption = parseOption(args, '--lines');
  const levelOption = parseOption(args, '--level');
  const follow = !args.includes('--no-follow');

  const lines = linesOption ? parsePositiveInt('lines', linesOption) : 100;
  const minLevel = levelOption ? parseLevelOption(levelOption) : null;

  if (!isPm2Available()) {
    console.log(color('PM2 não está instalado, então não há logs persistidos para ler.', ANSI.yellow));
    console.log(color('O "monky logs" lê os logs do servidor iniciado com "monky start" (que roda via PM2).', ANSI.dim));
    console.log(color('Instale com: npm install -g pm2', ANSI.dim));
    console.log(color('Se o servidor foi iniciado pelo app Monky, use o Monitor do Servidor no próprio app.', ANSI.dim));
    return;
  }

  if (!isMonkyServerRegistered()) {
    console.log(color('Servidor Monky não está registrado no PM2 — não há logs para exibir.', ANSI.yellow));
    console.log(color('Use "monky start" para iniciar o servidor.', ANSI.dim));
    return;
  }

  const pm2Args = ['logs', PM2_PROCESS_NAME, '--lines', String(lines)];
  if (!follow) pm2Args.push('--nostream');

  const describeFilter = minLevel ? ` (nível ${minLevel} ou acima)` : '';
  console.log(
    color(
      follow
        ? `Exibindo logs do servidor${describeFilter} — Ctrl+C para sair...`
        : `Últimas ${lines} linhas do servidor${describeFilter}...`,
      ANSI.dim
    )
  );

  // Without a level filter, hand the terminal straight to PM2 so its own
  // colours and formatting survive; filtering requires reading the stream.
  if (!minLevel) {
    spawnSync('pm2', pm2Args, { stdio: 'inherit', shell: true });
    return;
  }

  const threshold = LOG_LEVELS.indexOf(minLevel);
  const child = spawn('pm2', pm2Args, { shell: true });
  let pending = '';
  let keepingCurrent = false;

  const handleChunk = (chunk: Buffer) => {
    pending += chunk.toString();
    const parts = pending.split(/\r?\n/);
    pending = parts.pop() ?? '';

    for (const line of parts) {
      const level = classifyLogLine(line);
      if (level) {
        keepingCurrent = LOG_LEVELS.indexOf(level) >= threshold;
      }
      if (keepingCurrent) console.log(line);
    }
  };

  child.stdout?.on('data', handleChunk);
  child.stderr?.on('data', handleChunk);
  child.on('close', () => {
    if (pending && keepingCurrent) console.log(pending);
  });

  const forwardInterrupt = () => child.kill();
  process.on('SIGINT', forwardInterrupt);
  child.on('close', () => process.off('SIGINT', forwardInterrupt));
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
