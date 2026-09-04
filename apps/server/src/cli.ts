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
import { updateCommand, getLocalVersion } from './cli/commands/update';
import { destroyCommand } from './cli/commands/destroy';
import {
  initCliI18n,
  SUPPORTED_CLI_LANGUAGES,
  setCliLanguage,
  persistLanguage,
  t,
  SupportedCliLanguage,
} from './cli/i18n/index';

function printUsage(): void {
  const lang = require('./cli/i18n/index').getCliLanguage();
  const isPtBR = lang === 'pt-BR';

  if (isPtBR) {
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
  --version, -v            Exibe a versão instalada do Monky CLI
  --data <pasta>           Servidor a usar (obrigatório se houver vários)
  --help, -h               Exibe esta ajuda
  --lang <código>          Define o idioma (en, pt-BR)

${color('OPÇÕES POR COMANDO', ANSI.bold)}
  start   --port <n>  --fresh
  restart --fresh          Recria o processo no PM2 do zero (use após trocar a versão do Node)
  status  --watch          Modo dashboard em tempo real (Ctrl+C para sair)
  logs    --lines <n>  --level INFO|WARN|ERROR  --no-follow
  update  --beta  --check  --yes

${color('EXEMPLOS', ANSI.bold)}
  monky create                        Cria e inicia o primeiro servidor
  monky start                         Inicia o único servidor da máquina
  monky logs --level ERROR --no-follow  Imprime os erros recentes e sai
  monky --data /srv/monky restart     Reinicia um servidor específico

Documentação completa: https://monkyorg.github.io/Monky/cli
`.trim());
  } else {
    console.log(`
${color('monky', ANSI.bold)} — Monky server administration tool

${color('USAGE', ANSI.bold)}
  monky <command> [subcommand] [options]

${color('SERVERS', ANSI.bold)}
  create                   Create a new server (interactive)
  list                     List servers on this machine
  start                    Start an existing server
  stop                     Stop the server
  restart                  Restart the server applying current settings
  status                   Show server state
  logs                     Show server logs
  update                   Update Monky to the latest version
  destroy                  Delete all server data (irreversible)

${color('MEMBERS & ROLES', ANSI.bold)}
  members                  List members
  members info <id>        Show member details
  admin add [member]       Grant admin (interactive if no argument)
  admin remove [member]    Revoke admin
  roles                    List roles
  roles create             Create a role (interactive)
  roles assign             Assign a role to a member
  roles unassign           Remove a role from a member
  roles delete             Delete a role

${color('SETTINGS', ANSI.bold)}
  config                   Show server configuration
  config set <key> [value] Change a setting

${color('GLOBAL OPTIONS', ANSI.bold)}
  --version, -v            Show installed Monky CLI version
  --data <dir>             Server to use (required if there are multiple)
  --help, -h               Show this help
  --lang <code>            Set language (en, pt-BR)

${color('COMMAND OPTIONS', ANSI.bold)}
  start   --port <n>  --fresh
  restart --fresh          Recreate the PM2 process from scratch (use after changing Node version)
  status  --watch          Real-time dashboard mode (Ctrl+C to exit)
  logs    --lines <n>  --level INFO|WARN|ERROR  --no-follow
  update  --beta  --check  --yes

${color('EXAMPLES', ANSI.bold)}
  monky create                        Create and start first server
  monky start                         Start the only server on this machine
  monky logs --level ERROR --no-follow  Print recent errors and exit
  monky --data /srv/monky restart     Restart a specific server

Full documentation: https://monkyorg.github.io/Monky/cli
`.trim());
  }
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

  if (section === '--version' || section === '-v' || section === 'version') {
    console.log(`monky ${getLocalVersion()}`);
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
    await statusServerCommand(globalArgs, [action, ...rest].filter(Boolean));
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
        throw new Error('Invalid members command.');
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
        throw new Error('Invalid admin command.');
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
        throw new Error('Invalid roles command.');
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
        throw new Error('Invalid config command.');
      });
    });
    return;
  }

  throw new Error(`Unknown command: ${section}`);
}

async function main(): Promise<void> {
  // Handle --lang before parsing global args, so it's available everywhere.
  const rawArgs = process.argv.slice(2);
  const langIdx = rawArgs.indexOf('--lang');
  if (langIdx >= 0 && rawArgs[langIdx + 1]) {
    const code = rawArgs[langIdx + 1] as SupportedCliLanguage;
    if (SUPPORTED_CLI_LANGUAGES.some((l) => l.code === code)) {
      setCliLanguage(code);
      persistLanguage(code);
      // Remove --lang and its value from args before further parsing
      rawArgs.splice(langIdx, 2);
    }
  }

  const hasLanguage = initCliI18n();

  // If no language is persisted and stdin is interactive, ask on first run.
  if (!hasLanguage && process.stdin.isTTY) {
    await promptLanguageSelection();
  }

  const globalArgs = parseGlobalArgs(rawArgs);
  await runCommand(globalArgs);
}

/**
 * First-run language prompt. Shown once in English (universal) and persisted.
 */
async function promptLanguageSelection(): Promise<void> {
  const readline = await import('readline');
  const labels = SUPPORTED_CLI_LANGUAGES.map((l, i) => `  ${i + 1}. ${l.label}`).join('\n');
  console.log(t('language.selectPrompt'));
  console.log(labels);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question('> ', (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });

  const idx = parseInt(answer, 10) - 1;
  if (idx >= 0 && idx < SUPPORTED_CLI_LANGUAGES.length) {
    const chosen = SUPPORTED_CLI_LANGUAGES[idx].code;
    setCliLanguage(chosen);
    persistLanguage(chosen);
  } else {
    // Try matching by code
    const match = SUPPORTED_CLI_LANGUAGES.find(
      (l) => l.code.toLowerCase() === answer.toLowerCase()
    );
    if (match) {
      setCliLanguage(match.code);
      persistLanguage(match.code);
    } else {
      // Default to English
      persistLanguage('en');
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(color(`Error: ${message}`, ANSI.red));
    console.error(color('Use "monky --help"', ANSI.dim));
    process.exit(1);
  });
}
