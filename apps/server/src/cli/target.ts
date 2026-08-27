import { ANSI, color, DEFAULT_DATA_DIR } from './constants';
import { GlobalArgs, readLocalConfig } from './context';
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
  const suffix = port ? ` — porta ${port}` : '';
  return `${server.name || 'Servidor Monky'}${suffix} — ${server.dataDir}`;
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
      throw new Error(
        `Nenhum servidor Monky em: ${globalArgs.dataDir}\nCrie um com: monky create --data "${globalArgs.dataDir}"`
      );
    }
    return findServerByDataDir(globalArgs.dataDir) ?? registerServer(globalArgs.dataDir);
  }

  const servers = knownServers();

  if (servers.length === 0) {
    throw new Error('Nenhum servidor Monky encontrado nesta máquina.\nCrie um com: monky create');
  }

  if (servers.length === 1) {
    return servers[0];
  }

  if (!process.stdin.isTTY) {
    const list = servers.map((server) => `  --data "${server.dataDir}"`).join('\n');
    throw new Error(
      `Há ${servers.length} servidores nesta máquina e o terminal não é interativo.\n` +
        `Escolha um com --data:\n${list}`
    );
  }

  console.log(color(`Há ${servers.length} servidores Monky nesta máquina.`, ANSI.dim));
  const labels = servers.map(describeServer);
  const selected = await askChoice(`Qual servidor deseja ${action}?`, labels);
  return servers[labels.indexOf(selected)];
}
