#!/usr/bin/env node

import { ANSI, color } from './cli/constants';
import {
  GlobalArgs,
  isHelpArg,
  parseGlobalArgs,
  withContext,
} from './cli/context';
import { resolveTargetServer } from './cli/target';
import { createCommand } from './cli/commands/create';
import {
  listServersCommand,
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
${color('monky', ANSI.bold)} — ferramenta de administração do servidor Monky

${color('USO', ANSI.bold)}
  monky <comando> [subcomando] [opções]

${color('SERVIDORES', ANSI.bold)}
  create                   Cria um novo servidor (interativo)
  list                     Lista os servidores desta máquina
  start                    Inicia um servidor já criado
  stop                     Para o servidor
  restart                  Reinicia o servidor aplicando a configuração atual
  status                   Exibe o estado do servidor
  logs                     Exibe os logs do servidor
  update                   Atualiza o Monky para a última versão
  destroy                  Apaga todos os dados do servidor (irreversível)

${color('MEMBROS E CARGOS', ANSI.bold)}
  members                  Lista membros
  members info <id>        Exibe um membro em detalhe
  admin add [membro]       Concede admin (interativo se sem argumento)
  admin remove [membro]    Remove admin
  roles                    Lista cargos
  roles create             Cria um cargo (interativo)
  roles assign             Atribui um cargo a um membro
  roles unassign           Remove um cargo de um membro
  roles delete             Apaga um cargo

${color('CONFIGURAÇÃO', ANSI.bold)}
  config                   Exibe a configuração do servidor
  config set <chave> [valor]  Altera uma configuração

${color('OPÇÕES GLOBAIS', ANSI.bold)}
  --data <pasta>           Servidor a usar (obrigatório se houver vários)
  --help, -h               Exibe esta ajuda

${color('OPÇÕES POR COMANDO', ANSI.bold)}
  start   --port <n>
  logs    --lines <n>  --level INFO|WARN|ERROR  --no-follow
  update  --beta  --check  --yes

${color('EXEMPLOS', ANSI.bold)}
  monky create                        Cria e inicia o primeiro servidor
  monky start                         Inicia o único servidor da máquina
  monky logs --level ERROR --no-follow  Imprime os erros recentes e sai
  monky --data /srv/monky restart     Reinicia um servidor específico

Documentação completa: https://monkyorg.github.io/Monky/cli
`.trim());
}

async function runDataCommand(
  globalArgs: GlobalArgs,
  fn: (dataDir: string) => Promise<void>
): Promise<void> {
  const target = await resolveTargetServer(globalArgs, 'administrar');
  await fn(target.dataDir);
}

export async function runCommand(globalArgs: GlobalArgs): Promise<void> {
  const [section, action, ...rest] = globalArgs.args;

  if (!section || isHelpArg(section)) {
    printUsage();
    return;
  }

  // "bootstrap" is kept as a hidden alias so existing scripts and older
  // documentation keep working after the rename to "create".
  if (section === 'create' || section === 'bootstrap') {
    await createCommand(globalArgs, [action, ...rest].filter(Boolean));
    return;
  }

  if (section === 'list' || section === 'ls') {
    await listServersCommand();
    return;
  }

  if (section === 'start') {
    await startServerCommand(globalArgs, [action, ...rest].filter(Boolean));
    return;
  }

  if (section === 'stop') {
    await stopServerCommand(globalArgs);
    return;
  }

  if (section === 'restart') {
    await restartServerCommand(globalArgs, [action, ...rest].filter(Boolean));
    return;
  }

  if (section === 'logs') {
    await logsServerCommand(globalArgs, [action, ...rest].filter(Boolean));
    return;
  }

  if (section === 'status') {
    await statusServerCommand(globalArgs);
    return;
  }

  if (section === 'update') {
    await updateCommand(globalArgs, [action, ...rest].filter(Boolean));
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

  throw new Error(`Comando inválido: ${section}`);
}

async function main(): Promise<void> {
  const globalArgs = parseGlobalArgs(process.argv.slice(2));
  await runCommand(globalArgs);
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(color(`Erro: ${message}`, ANSI.red));
    console.error(color('Use "monky --help" para ver os comandos disponíveis.', ANSI.dim));
    process.exit(1);
  });
}
