#!/usr/bin/env node

import { ANSI, color } from './cli/constants';
import {
  ensureExistingDataDir,
  GlobalArgs,
  isHelpArg,
  parseGlobalArgs,
  withContext,
} from './cli/context';
import { bootstrapCommand } from './cli/commands/bootstrap';
import {
  logsServerCommand,
  restartServerCommand,
  startServerCommand,
  statusServerCommand,
  stopServerCommand,
} from './cli/commands/serverLifecycle';
import {
  changeAdminRole,
  listMembers,
  showMemberInfo,
} from './cli/commands/members';
import {
  assignRoleInteractive,
  createRoleInteractive,
  deleteRoleInteractive,
  listRoles,
} from './cli/commands/roles';
import { setConfig, showConfig } from './cli/commands/config';
import { updateCommand } from './cli/commands/update';
import { destroyCommand } from './cli/commands/destroy';

function printUsage(): void {
  console.log(`
${color('Monky CLI - Ferramenta de administração do servidor Monky', ANSI.bold)}

Uso:
  monky bootstrap          Configura um novo servidor (interativo)
  monky start              Inicia o servidor (via PM2, daemon)
  monky stop               Para o servidor
  monky restart            Reinicia o servidor
  monky status             Exibe o estado do servidor
  monky logs               Exibe logs em tempo real
  monky members            Lista membros
  monky members info <id>  Info detalhada de um membro
  monky admin add [user]   Concede admin (interativo se sem arg)
  monky admin remove [user] Remove admin
  monky roles              Lista cargos
  monky roles create       Cria um novo cargo (interativo)
  monky roles assign       Atribui cargo a membro (interativo)
  monky roles unassign     Remove cargo de membro (interativo)
  monky roles delete       Remove um cargo (interativo)
  monky config             Mostra configuração do servidor
  monky config set [k] [v] Altera uma configuração (interativo se sem args)
  monky update             Atualiza o servidor para a última versão
  monky update --check     Apenas verifica se há atualização
  monky destroy            Apaga todos os dados do servidor (irreversível)

Opções globais:
  --data <pasta>   Caminho dos dados (padrão: ./data)
  --help, -h       Mostra esta ajuda

Instalação global:
  cd apps/server && npm install -g .
  Depois use "monky" de qualquer lugar.
`.trim());
}

async function runDataCommand(
  globalArgs: GlobalArgs,
  fn: (dataDir: string) => Promise<void>
): Promise<void> {
  const dataDir = await ensureExistingDataDir(globalArgs.dataDir, globalArgs.dataDirSpecified);
  await fn(dataDir);
}

export async function runCommand(globalArgs: GlobalArgs): Promise<void> {
  const [section, action, ...rest] = globalArgs.args;

  if (!section || isHelpArg(section)) {
    printUsage();
    return;
  }

  if (section === 'bootstrap') {
    await bootstrapCommand(globalArgs, [action, ...rest].filter(Boolean));
    return;
  }

  if (section === 'start') {
    await startServerCommand(globalArgs, [action, ...rest].filter(Boolean));
    return;
  }

  if (section === 'stop') {
    await stopServerCommand(globalArgs.dataDir);
    return;
  }

  if (section === 'restart') {
    await restartServerCommand(globalArgs.dataDir);
    return;
  }

  if (section === 'logs') {
    logsServerCommand();
    return;
  }

  if (section === 'status') {
    statusServerCommand();
    return;
  }

  if (section === 'update') {
    await updateCommand([action, ...rest].filter(Boolean));
    return;
  }

  if (section === 'destroy') {
    await destroyCommand(globalArgs);
    return;
  }

  if (section === 'members') {
    const memberAction = action || 'list';
    await runDataCommand(globalArgs, async (dataDir) => {
      await withContext(dataDir, async (ctx) => {
        if (memberAction === 'list') {
          await listMembers(ctx);
          return;
        }
        if (memberAction === 'info') {
          await showMemberInfo(ctx, rest.join(' '));
          return;
        }
        throw new Error('Comando inválido para members.');
      });
    });
    return;
  }

  if (section === 'admin') {
    await runDataCommand(globalArgs, async (dataDir) => {
      await withContext(dataDir, async (ctx) => {
        if (action === 'add') {
          await changeAdminRole(ctx, rest.join(' '), true);
          return;
        }
        if (action === 'remove') {
          await changeAdminRole(ctx, rest.join(' '), false);
          return;
        }
        throw new Error('Comando inválido para admin.');
      });
    });
    return;
  }

  if (section === 'roles') {
    const roleAction = action || 'list';
    await runDataCommand(globalArgs, async (dataDir) => {
      await withContext(dataDir, async (ctx) => {
        if (roleAction === 'list') {
          await listRoles(ctx);
          return;
        }
        if (roleAction === 'create') {
          await createRoleInteractive(ctx, rest);
          return;
        }
        if (roleAction === 'assign') {
          await assignRoleInteractive(ctx, rest, false);
          return;
        }
        if (roleAction === 'unassign') {
          await assignRoleInteractive(ctx, rest, true);
          return;
        }
        if (roleAction === 'delete') {
          await deleteRoleInteractive(ctx, rest);
          return;
        }
        throw new Error('Comando inválido para roles.');
      });
    });
    return;
  }

  if (section === 'config') {
    const configAction = action || 'show';
    await runDataCommand(globalArgs, async (dataDir) => {
      await withContext(dataDir, async (ctx) => {
        if (configAction === 'show') {
          await showConfig(ctx);
          return;
        }
        if (configAction === 'set') {
          await setConfig(ctx, rest[0] || '', rest.length > 1 ? rest.slice(1).join(' ') : undefined);
          return;
        }
        throw new Error('Comando inválido para config.');
      });
    });
    return;
  }

  throw new Error('Comando inválido.');
}

async function main(): Promise<void> {
  const globalArgs = parseGlobalArgs(process.argv.slice(2));
  await runCommand(globalArgs);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(color(`Erro: ${error instanceof Error ? error.message : String(error)}`, ANSI.red));
    printUsage();
    process.exit(1);
  });
}
