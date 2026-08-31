import { ANSI, color, DEFAULT_DATA_DIR } from './constants';
import { GlobalArgs, readLocalConfig } from './context';
import { t } from './i18n/index';
import { askChoice } from './prompts';
import { discoverPm2DataDirs } from './pm2';
import {
  adoptServers,
  findServerByDataDir,
  hasServerDatabase,
  listServers,
  RegisteredServer,
  registerServer,
} from './registry';

/**
 * Every server this machine knows about.
 *
 * When the registry is empty the CLI looks for servers that predate it — the
 * ones PM2 is already running and the conventional `./data` next to the current
 * directory — so upgrading never makes an existing server disappear.
 */
export function knownServers(): RegisteredServer[] {
  const registered = listServers();
  if (registered.length > 0) return registered;

  adoptServers([...discoverPm2DataDirs(), DEFAULT_DATA_DIR]);
  return listServers();
}

export function describeServer(server: RegisteredServer): string {
  const port = server.port ?? readLocalConfig(server.dataDir).port;
  const suffix = port ? ` — ${t('target.portSuffix', { port })}` : '';
  return `${server.name || 'Monky Server'}${suffix} — ${server.dataDir}`;
}

/**
 * Decides which server a command applies to.
 *
 * `--data` always wins. Otherwise the CLI acts directly when there is only one
 * server on the machine and asks which one when there are several, because a
 * globally installed CLI has no working directory to infer it from.
 */
export async function resolveTargetServer(globalArgs: GlobalArgs, action: string): Promise<RegisteredServer> {
  if (globalArgs.dataDirSpecified) {
    if (!hasServerDatabase(globalArgs.dataDir)) {
      throw new Error(t('target.notFound', { dataDir: globalArgs.dataDir }));
    }
    return findServerByDataDir(globalArgs.dataDir) ?? registerServer(globalArgs.dataDir);
  }

  const servers = knownServers();

  if (servers.length === 0) {
    throw new Error(t('target.noneOnMachine'));
  }

  if (servers.length === 1) {
    return servers[0];
  }

  if (!process.stdin.isTTY) {
    const list = servers.map((server) => `  --data "${server.dataDir}"`).join('\n');
    throw new Error(t('target.multipleNonInteractive', { count: servers.length, list }));
  }

  console.log(color(t('target.multipleFound', { count: servers.length }), ANSI.dim));
  const labels = servers.map(describeServer);
  const selected = await askChoice(t('target.whichServer', { action }), labels);
  return servers[labels.indexOf(selected)];
}
