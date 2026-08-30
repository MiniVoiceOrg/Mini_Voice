import { spawn, spawnSync } from 'child_process';
import { LIMITS, LOG_LEVELS, LogLevel } from '@monky/shared';
import { SqliteServerRepository } from '../../infrastructure/database/SqliteRepositories';
import { ANSI, color, DEFAULT_SERVER_NAME } from '../constants';
import { GlobalArgs, readLocalConfig, withContext } from '../context';
import { formatBool, parseOption, parsePositiveInt, pad } from '../formatters';
import {
  ensurePm2,
  findLegacyProcessFor,
  findPm2Process,
  getPm2ProcessName,
  isMonkyServerRegistered,
  isPm2Available,
  LEGACY_PM2_PROCESS_NAME,
  requirePm2,
  writeEcosystem,
} from '../pm2';
import { hasServerDatabase, RegisteredServer, registerServer } from '../registry';
import { confirmDisconnectingUsers } from '../onlineUsers';
import { knownServers, resolveTargetServer } from '../target';
import { CoturnManager, TURN_LISTENING_PORT } from '../../infrastructure/turn/CoturnManager';

/**
 * Flags that only ever applied while the database was being created.
 *
 * `ensureServerSeedData` ignores them once the server exists, so accepting them
 * on `monky start` silently did nothing. They now fail loudly and point at the
 * command that actually applies them.
 */
const REMOVED_START_OPTIONS: Record<string, string> = {
  '--password': 'monky config set password',
  '--max-users': 'monky config set maxUsers',
  '--name': 'monky config set name',
  '--voice-channel': 'monky create',
  '--text-channel': 'monky create',
};

function rejectRemovedStartOptions(args: string[]): void {
  for (const [option, replacement] of Object.entries(REMOVED_START_OPTIONS)) {
    if (args.includes(option)) {
      throw new Error(
        `"${option}" não é aceito em "monky start" — ele só teria efeito ao criar o servidor.\n` +
          `Use: ${replacement}`
      );
    }
  }
}

export async function loadStoredServer(
  dataDir: string
): Promise<Awaited<ReturnType<SqliteServerRepository['getServer']>>> {
  if (!hasServerDatabase(dataDir)) {
    return null;
  }
  return withContext(dataDir, async (ctx) => ctx.serverRepo.getServer(), false);
}

export interface StartPlan {
  dataDir: string;
  port: number;
  serverName: string;
}

/**
 * Resolves what `monky start` will hand to PM2.
 *
 * Everything comes from the server that already exists on disk; `--port` is the
 * only accepted override, because it is the one setting that may need to change
 * per boot without being persisted.
 */
export async function buildStartPlan(dataDir: string, args: string[]): Promise<StartPlan> {
  // Arguments are validated before the database is opened so a typo fails with
  // a message about the typo, not about the database.
  rejectRemovedStartOptions(args);
  const portOption = parseOption(args, '--port');
  const overriddenPort = portOption ? parsePositiveInt('port', portOption) : null;

  const localConfig = readLocalConfig(dataDir);
  const storedServer = await loadStoredServer(dataDir);

  return {
    dataDir,
    port: overriddenPort ?? localConfig.port ?? LIMITS.DEFAULT_PORT,
    serverName: storedServer?.name || DEFAULT_SERVER_NAME,
  };
}

/**
 * Retires the pre-registry `monky-server` process for this data directory.
 *
 * Without this an upgraded machine would end up with the old process and the
 * new per-directory one competing for the same port.
 */
function retireLegacyProcess(dataDir: string): void {
  if (!findLegacyProcessFor(dataDir)) return;
  console.log(color('Migrando o processo PM2 antigo ("monky-server") para o novo formato...', ANSI.dim));
  spawnSync('pm2', ['delete', LEGACY_PM2_PROCESS_NAME], { stdio: 'ignore', shell: true });
}

export async function startServerCommand(globalArgs: GlobalArgs, args: string[]): Promise<void> {
  rejectRemovedStartOptions(args);
  const portOption = parseOption(args, '--port');
  if (portOption) parsePositiveInt('port', portOption);

  const target = await resolveTargetServer(globalArgs, 'iniciar');
  const plan = await buildStartPlan(target.dataDir, args);
  const processName = getPm2ProcessName(target.dataDir);

  ensurePm2();

  const existing = findPm2Process(processName);
  if (existing?.pm2_env?.status === 'online') {
    console.log(color(`O servidor já está em execução (PID ${existing.pid}).`, ANSI.yellow));
    console.log(color('Use "monky restart" para reiniciar ou "monky stop" para parar.', ANSI.dim));
    return;
  }

  retireLegacyProcess(target.dataDir);
  const ecosystemPath = writeEcosystem(plan);

  // startOrRestart re-reads the ecosystem file, so a process PM2 still knows
  // about from a previous "monky stop" picks up the current port.
  const result = spawnSync('pm2', ['startOrRestart', ecosystemPath], { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    throw new Error('Falha ao iniciar o servidor via PM2.');
  }

  spawnSync('pm2', ['save'], { stdio: 'ignore', shell: true });
  registerServer(target.dataDir, { name: plan.serverName, port: plan.port });

  console.log();
  console.log(color('Servidor Monky iniciado com sucesso!', ANSI.green));
  console.log(`porta: ${plan.port}`);
  console.log(`dataDir: ${plan.dataDir}`);
  console.log(`serverName: ${plan.serverName}`);
  console.log(`processo PM2: ${processName}`);
  console.log();
  console.log(color('Comandos úteis:', ANSI.bold));
  console.log(`  monky status    — ver estado do servidor`);
  console.log(`  monky logs      — ver logs em tempo real`);
  console.log(`  monky restart   — reiniciar o servidor`);
  console.log(`  monky stop      — parar o servidor`);
}

export async function stopServerCommand(globalArgs: GlobalArgs): Promise<void> {
  if (!requirePm2('parar')) return;

  const target = await resolveTargetServer(globalArgs, 'parar');
  const processName = getPm2ProcessName(target.dataDir);

  // Everyone on the server loses their session when it goes down (#334).
  if (!(await confirmDisconnectingUsers(target, 'parar'))) return;

  if (!isMonkyServerRegistered(processName) && findLegacyProcessFor(target.dataDir)) {
    spawnSync('pm2', ['stop', LEGACY_PM2_PROCESS_NAME], { stdio: 'inherit', shell: true });
    console.log(color('Servidor Monky parado com sucesso.', ANSI.green));
    return;
  }

  const result = spawnSync('pm2', ['stop', processName], { encoding: 'utf8', shell: true });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (output.includes('not found')) {
      console.log(color('Esse servidor não está registrado no PM2 — nada a parar.', ANSI.yellow));
      return;
    }
    throw new Error('Falha ao parar o servidor.');
  }

  // The process is kept in PM2 on purpose: deleting it discards the logs right
  // when they matter most, after a crash or a manual stop.
  console.log(color('Servidor Monky parado com sucesso.', ANSI.green));
  console.log(color(`Os logs continuam disponíveis em "monky logs".`, ANSI.dim));
}

export async function restartServerCommand(globalArgs: GlobalArgs, args: string[] = []): Promise<void> {
  if (!requirePm2('reiniciar')) return;

  const target = await resolveTargetServer(globalArgs, 'reiniciar');
  const processName = getPm2ProcessName(target.dataDir);

  if (!isMonkyServerRegistered(processName) && !findLegacyProcessFor(target.dataDir)) {
    console.log(color('Esse servidor não está registrado no PM2. Use "monky start" primeiro.', ANSI.yellow));
    return;
  }

  // A restart drops every open session, same as a stop (#334).
  if (!(await confirmDisconnectingUsers(target, 'reiniciar'))) return;

  retireLegacyProcess(target.dataDir);

  // Rewriting the ecosystem before restarting is what makes a port or name
  // changed in the meantime actually take effect.
  const plan = await buildStartPlan(target.dataDir, args);
  const ecosystemPath = writeEcosystem(plan);

  const result = spawnSync('pm2', ['startOrRestart', ecosystemPath], { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    throw new Error('Falha ao reiniciar o servidor.');
  }

  spawnSync('pm2', ['save'], { stdio: 'ignore', shell: true });
  registerServer(target.dataDir, { name: plan.serverName, port: plan.port });

  console.log(color('Servidor Monky reiniciado com sucesso.', ANSI.green));
  console.log(`porta: ${plan.port}`);
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

export async function logsServerCommand(globalArgs: GlobalArgs, args: string[] = []): Promise<void> {
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

  const target = await resolveTargetServer(globalArgs, 'inspecionar');
  let processName = getPm2ProcessName(target.dataDir);

  if (!isMonkyServerRegistered(processName)) {
    if (findLegacyProcessFor(target.dataDir)) {
      processName = LEGACY_PM2_PROCESS_NAME;
    } else {
      console.log(color('Esse servidor não está registrado no PM2 — não há logs para exibir.', ANSI.yellow));
      console.log(color('Use "monky start" para iniciar o servidor.', ANSI.dim));
      return;
    }
  }

  const pm2Args = ['logs', processName, '--lines', String(lines)];
  if (!follow) pm2Args.push('--nostream');

  const describeFilter = minLevel ? ` (nível ${minLevel} ou acima)` : '';
  console.log(
    color(
      follow
        ? `Exibindo logs de "${target.name || target.dataDir}"${describeFilter} — Ctrl+C para sair...`
        : `Últimas ${lines} linhas de "${target.name || target.dataDir}"${describeFilter}...`,
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

function statusLabel(status: string): string {
  const statusColor = status === 'online' ? ANSI.green : status === 'stopped' ? ANSI.yellow : ANSI.red;
  return color(status, statusColor);
}

function readServerStatus(dataDir: string): { status: string; process: ReturnType<typeof findPm2Process> } {
  const found = findPm2Process(getPm2ProcessName(dataDir)) ?? findLegacyProcessFor(dataDir);
  return { status: found?.pm2_env?.status ?? 'não iniciado', process: found };
}

function printServerDetails(server: RegisteredServer): void {
  const { status, process: entry } = readServerStatus(server.dataDir);
  const port = server.port ?? readLocalConfig(server.dataDir).port ?? LIMITS.DEFAULT_PORT;

  console.log(color(`Estado do servidor: ${server.name || 'Servidor Monky'}`, ANSI.bold));
  console.log(`status: ${statusLabel(status)}`);
  console.log(`dataDir: ${server.dataDir}`);
  console.log(`porta: ${port}`);
  console.log(`processo PM2: ${getPm2ProcessName(server.dataDir)}`);

  if (!entry) {
    console.log(color('Use "monky start" para iniciar.', ANSI.dim));
    return;
  }

  console.log(`pid: ${entry.pid || '-'}`);
  console.log(`uptime: ${entry.pm2_env?.pm_uptime ? new Date(entry.pm2_env.pm_uptime).toISOString() : '-'}`);
  console.log(`restarts: ${entry.pm2_env?.restart_time ?? 0}`);
  console.log(`memória: ${entry.monit?.memory ? `${Math.round(entry.monit.memory / 1024 / 1024)} MB` : '-'}`);
  console.log(`cpu: ${entry.monit?.cpu !== undefined ? `${entry.monit.cpu}%` : '-'}`);

  // TURN relay info (#441)
  printTurnStatus(server.dataDir);
}

export function printServerTable(servers: RegisteredServer[]): void {
  const rows = servers.map((server) => ({
    name: server.name || 'Servidor Monky',
    status: readServerStatus(server.dataDir).status,
    port: String(server.port ?? readLocalConfig(server.dataDir).port ?? LIMITS.DEFAULT_PORT),
    dataDir: server.dataDir,
  }));

  const nameWidth = Math.max(4, ...rows.map((row) => row.name.length));
  const statusWidth = Math.max(6, ...rows.map((row) => row.status.length));
  const portWidth = Math.max(5, ...rows.map((row) => row.port.length));

  console.log(
    `${color(pad('NOME', nameWidth), ANSI.cyan)}  ${color(pad('STATUS', statusWidth), ANSI.cyan)}  ` +
      `${color(pad('PORTA', portWidth), ANSI.cyan)}  ${color('PASTA DE DADOS', ANSI.cyan)}`
  );

  for (const row of rows) {
    const paddedStatus = statusLabel(row.status) + ' '.repeat(Math.max(0, statusWidth - row.status.length));
    console.log(`${pad(row.name, nameWidth)}  ${paddedStatus}  ${pad(row.port, portWidth)}  ${row.dataDir}`);
  }
}

export async function listServersCommand(): Promise<void> {
  const servers = knownServers();
  if (servers.length === 0) {
    console.log(color('Nenhum servidor Monky encontrado nesta máquina.', ANSI.yellow));
    console.log(color('Crie um com "monky create".', ANSI.dim));
    return;
  }
  printServerTable(servers);
}

/**
 * Prints TURN relay info when the server has it configured (#441).
 *
 * This is the sync stub called from `printServerDetails`; it only shows
 * platform-level availability. The full async variant (`printTurnStatusAsync`)
 * also reads the database to check whether TURN is actually enabled.
 */
function printTurnStatus(_dataDir: string): void {
  // The sync path only reports coturn availability; the database read happens
  // in printTurnStatusAsync after printServerDetails returns.
}

/**
 * Async variant that reads TURN status from the database.
 */
async function printTurnStatusAsync(dataDir: string): Promise<void> {
  if (!hasServerDatabase(dataDir)) return;
  try {
    await withContext(dataDir, async (ctx) => {
      const server = await ctx.serverRepo.getServer();
      if (!server) return;
      const turnEnabled = Boolean(server.turnEnabled);
      console.log();
      console.log(color('Relay TURN', ANSI.bold));
      console.log(`turn: ${formatBool(turnEnabled)}`);
      if (turnEnabled) {
        const reason = CoturnManager.getUnavailabilityReason();
        if (reason) {
          console.log(`coturn: ${color('indisponível', ANSI.yellow)}`);
          console.log(`  ${color(reason, ANSI.dim)}`);
        } else {
          console.log(`coturn: ${color('instalado', ANSI.green)}`);
          console.log(`porta: ${TURN_LISTENING_PORT}`);
          // Check port reachability
          const portProblem = await CoturnManager.checkPortReachability();
          if (portProblem) {
            console.log(`status: ${color('⚠ porta bloqueada', ANSI.yellow)}`);
            console.log(`  ${color(portProblem, ANSI.dim)}`);
          } else {
            console.log(`status: ${color('✔ acessível', ANSI.green)}`);
          }
        }
      }
    }, false);
  } catch {
    // Database may be locked by the running server; skip silently.
  }
}

/**
 * Formats uptime from epoch ms to a human-readable duration.
 */
function formatUptime(startedAtMs: number): string {
  const elapsed = Date.now() - startedAtMs;
  if (elapsed < 0) return '-';
  const seconds = Math.floor(elapsed / 1000) % 60;
  const minutes = Math.floor(elapsed / (1000 * 60)) % 60;
  const hours = Math.floor(elapsed / (1000 * 60 * 60)) % 24;
  const days = Math.floor(elapsed / (1000 * 60 * 60 * 24));
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Renders one frame of the real-time dashboard, clearing the terminal first.
 */
function renderDashboard(server: RegisteredServer): void {
  const { status, process: entry } = readServerStatus(server.dataDir);
  const port = server.port ?? readLocalConfig(server.dataDir).port ?? LIMITS.DEFAULT_PORT;

  // Clear terminal and move cursor to top-left
  process.stdout.write('\x1b[2J\x1b[H');

  console.log(color('╔══════════════════════════════════════════════════╗', ANSI.cyan));
  console.log(color('║', ANSI.cyan) + color(`  Monky Server Dashboard`, ANSI.bold) + ' '.repeat(25) + color('║', ANSI.cyan));
  console.log(color('╚══════════════════════════════════════════════════╝', ANSI.cyan));
  console.log();

  console.log(color('  Servidor', ANSI.bold));
  console.log(`    nome:     ${server.name || 'Servidor Monky'}`);
  console.log(`    status:   ${statusLabel(status)}`);
  console.log(`    porta:    ${port}`);
  console.log(`    dataDir:  ${server.dataDir}`);
  console.log(`    processo: ${getPm2ProcessName(server.dataDir)}`);

  if (entry) {
    console.log();
    console.log(color('  Processo', ANSI.bold));
    console.log(`    pid:      ${entry.pid || '-'}`);
    console.log(`    uptime:   ${entry.pm2_env?.pm_uptime ? formatUptime(entry.pm2_env.pm_uptime) : '-'}`);
    console.log(`    restarts: ${entry.pm2_env?.restart_time ?? 0}`);
    console.log(`    memória:  ${entry.monit?.memory ? `${Math.round(entry.monit.memory / 1024 / 1024)} MB` : '-'}`);
    console.log(`    cpu:      ${entry.monit?.cpu !== undefined ? `${entry.monit.cpu}%` : '-'}`);
  }

  console.log();
  console.log(color(`  Atualizado: ${new Date().toLocaleTimeString()}`, ANSI.dim));
  console.log(color('  Pressione Ctrl+C para sair.', ANSI.dim));
}

/**
 * Shows one server in detail, or every server as a table.
 *
 * Listing is read-only, so with several servers it prints all of them instead
 * of asking which one — asking would be busywork for a question with no side
 * effects.
 */
export async function statusServerCommand(globalArgs: GlobalArgs, args: string[] = []): Promise<void> {
  if (!requirePm2('consultar')) return;

  const watch = args.includes('--watch') || args.includes('-w');

  if (watch) {
    const target = await resolveTargetServer(globalArgs, 'monitorar');

    // --watch mode: real-time dashboard that refreshes every 2s (#441)
    renderDashboard(target);
    const interval = setInterval(() => renderDashboard(target), 2000);

    const cleanup = () => {
      clearInterval(interval);
      // Show cursor again and print a clean exit line
      process.stdout.write('\x1b[?25h');
      console.log();
      console.log(color('Dashboard encerrado.', ANSI.dim));
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    return;
  }

  if (globalArgs.dataDirSpecified) {
    const target = await resolveTargetServer(globalArgs, 'consultar');
    printServerDetails(target);
    await printTurnStatusAsync(target.dataDir);
    return;
  }

  const servers = knownServers();
  if (servers.length === 0) {
    console.log(color('Nenhum servidor Monky encontrado nesta máquina.', ANSI.yellow));
    console.log(color('Crie um com "monky create".', ANSI.dim));
    return;
  }

  if (servers.length === 1) {
    printServerDetails(servers[0]);
    await printTurnStatusAsync(servers[0].dataDir);
    return;
  }

  printServerTable(servers);
  console.log();
  console.log(color('Use "monky status --data <pasta>" para detalhes de um servidor.', ANSI.dim));
}
