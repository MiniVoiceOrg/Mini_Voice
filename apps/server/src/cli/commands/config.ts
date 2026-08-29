import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { LIMITS } from '@monky/shared';
import { PasswordService } from '../../infrastructure/security/PasswordService';
import {
  ANSI,
  color,
  CONFIG_KEYS,
  ConfigKey,
  DEFAULT_SERVER_NAME,
} from '../constants';
import { CliContext, readLocalConfig, writeLocalConfig } from '../context';
import { formatBool, formatDate, parseBoolean, parseMemberLimit, parsePositiveInt } from '../formatters';
import {
  getPm2ProcessName,
  isMonkyServerRunning,
  writeEcosystem,
} from '../pm2';
import { registerServer } from '../registry';
import { ask, askChoice, confirm, promptPassword } from '../prompts';
import { disableAutoUpdate, enableAutoUpdate, isAutoUpdateEnabled, AutoUpdateSchedule } from './update';
import { CoturnManager } from '../../infrastructure/turn/CoturnManager';

/**
 * Warns, right where the value is shown, when the relay cannot actually run on
 * this host — an operator reading `turn: sim` deserves to know if nothing is
 * relaying because coturn is missing (#425).
 */
function turnStatusSuffix(): string {
  const reason = CoturnManager.getUnavailabilityReason();
  return reason ? color(`  (indisponível: ${reason})`, ANSI.yellow) : '';
}

export async function showConfig(ctx: CliContext): Promise<void> {
  const server = await ctx.serverRepo.getServer();
  if (!server) {
    throw new Error('Servidor não encontrado.');
  }

  const localConfig = readLocalConfig(ctx.dataDir);
  const owner = server.ownerUserId ? await ctx.userRepo.findById(server.ownerUserId) : null;
  console.log(color('Configuração do servidor', ANSI.bold));
  console.log(`dataDir: ${ctx.dataDir}`);
  console.log(`id: ${server.id}`);
  console.log(`name: ${server.name}`);
  console.log(`port: ${localConfig.port || LIMITS.DEFAULT_PORT}`);
  console.log(`hasPassword: ${formatBool(Boolean(server.passwordHash))}`);
  console.log(`maxUsers: ${server.maxUsers > LIMITS.MAX_USERS_UNLIMITED ? server.maxUsers : 'sem limite'}`);
  console.log(`ownerUserId: ${server.ownerUserId ?? '-'}`);
  console.log(`ownerNickname: ${owner?.nickname ?? '-'}`);
  console.log(`allowSoundboard: ${formatBool(server.allowSoundboard !== false)}`);
  console.log(`turn: ${formatBool(Boolean(server.turnEnabled))}${turnStatusSuffix()}`);
  console.log(`iconPath: ${server.iconPath ?? '-'}`);
  console.log(`maxAttachmentFileBytes: ${server.maxAttachmentFileBytes ?? '-'}`);
  console.log(`maxAttachmentStorageBytes: ${server.maxAttachmentStorageBytes ?? '-'}`);
  console.log(`autoUpdate: ${formatBool(isAutoUpdateEnabled(ctx.dataDir))}`);
  console.log(`createdAt: ${formatDate(server.createdAt)}`);
}

export async function askConfigKey(): Promise<ConfigKey> {
  const choice = await askChoice(
    'Qual configuração deseja alterar?',
    CONFIG_KEYS.map((key) => `${key}`)
  );
  return choice as ConfigKey;
}

export async function setConfig(ctx: CliContext, key: string, value?: string): Promise<void> {
  const normalizedKey = (key.trim() || (await askConfigKey())) as ConfigKey;
  const server = await ctx.serverRepo.getServer();
  if (!server) {
    throw new Error('Servidor não encontrado.');
  }

  const localConfig = readLocalConfig(ctx.dataDir);

  const currentValues: Record<ConfigKey, string> = {
    name: server.name,
    password: '',
    port: String(localConfig.port || LIMITS.DEFAULT_PORT),
    icon: server.iconPath ?? '',
    maxUsers: String(server.maxUsers),
    allowSoundboard: String(server.allowSoundboard !== false),
    maxAttachmentFileBytes: String(server.maxAttachmentFileBytes ?? ''),
    maxAttachmentStorageBytes: String(server.maxAttachmentStorageBytes ?? ''),
    autoUpdate: String(isAutoUpdateEnabled(ctx.dataDir)),
    turn: String(Boolean(server.turnEnabled)),
  };

  let nextValue = value;
  if (nextValue === undefined) {
    switch (normalizedKey) {
      case 'name':
        nextValue = await ask('Nome do servidor', currentValues.name);
        break;
      case 'password':
        nextValue = await promptPassword('Senha do servidor (deixe vazio para remover): ');
        break;
      case 'port':
        nextValue = await ask('Porta do servidor', currentValues.port);
        break;
      case 'icon':
        nextValue = await ask('Caminho da imagem do servidor (deixe vazio para remover)');
        break;
      case 'allowSoundboard':
        nextValue = await askChoice('Permitir soundboard?', ['true', 'false']);
        break;
      case 'turn':
        nextValue = await askChoice('Habilitar o relay de mídia (TURN)?', ['true', 'false']);
        break;
      case 'autoUpdate':
        nextValue = await askChoice('Habilitar atualização automática?', ['true', 'false']);
        break;
      case 'maxUsers':
        nextValue = await ask('Limite de membros (0 para sem limite)', currentValues.maxUsers);
        break;
      case 'maxAttachmentFileBytes':
      case 'maxAttachmentStorageBytes':
        nextValue = await ask(`Valor para ${normalizedKey}`, currentValues[normalizedKey]);
        break;
      default:
        nextValue = await ask(`Valor para ${normalizedKey}`);
    }
  }

  switch (normalizedKey) {
    case 'name': {
      const nextName = nextValue.trim();
      if (nextName.length < 2) {
        throw new Error('O nome do servidor deve ter pelo menos 2 caracteres.');
      }
      await ctx.serverRepo.updateServer({ name: nextName });
      registerServer(ctx.dataDir, { name: nextName });
      break;
    }
    case 'password': {
      const normalizedValue = nextValue.trim().toLowerCase();
      const shouldClear = !nextValue.trim() || ['clear', 'none', 'null', 'empty', 'remove'].includes(normalizedValue);
      await ctx.serverRepo.updateServer({
        passwordHash: shouldClear ? '' : PasswordService.hashPassword(nextValue),
      });
      break;
    }
    case 'port': {
      const portNum = parsePositiveInt('port', nextValue);
      const config = readLocalConfig(ctx.dataDir);
      config.port = portNum;
      writeLocalConfig(ctx.dataDir, config);

      const processName = getPm2ProcessName(ctx.dataDir);
      if (isMonkyServerRunning(processName)) {
        const shouldRestart = await confirm('Servidor está rodando. Deseja reiniciar agora para aplicar a nova porta?', true);
        if (shouldRestart) {
          const ecosystemPath = writeEcosystem({
            dataDir: ctx.dataDir,
            port: portNum,
            serverName: (await ctx.serverRepo.getServer())?.name || DEFAULT_SERVER_NAME,
          });
          spawnSync('pm2', ['startOrRestart', ecosystemPath], { stdio: 'inherit', shell: true });
          console.log(color('Servidor reiniciado com a nova porta.', ANSI.green));
        } else {
          console.log(color('A nova porta será usada no próximo "monky start" ou "monky restart".', ANSI.dim));
        }
      } else {
        console.log(color('A nova porta será usada no próximo "monky start".', ANSI.dim));
      }
      registerServer(ctx.dataDir, { port: portNum });
      break;
    }
    case 'icon': {
      const iconValue = nextValue.trim();
      if (!iconValue || ['clear', 'none', 'remove'].includes(iconValue.toLowerCase())) {
        await ctx.serverRepo.updateServer({ iconPath: null });
        console.log(color('Ícone removido.', ANSI.dim));
      } else {
        const resolvedPath = path.resolve(iconValue);
        if (!fs.existsSync(resolvedPath)) {
          throw new Error(`Arquivo não encontrado: ${resolvedPath}`);
        }
        const destDir = path.join(ctx.dataDir, 'icons');
        await fs.promises.mkdir(destDir, { recursive: true });
        const ext = path.extname(resolvedPath);
        const destPath = path.join(destDir, `server-icon${ext}`);
        await fs.promises.copyFile(resolvedPath, destPath);
        await ctx.serverRepo.updateServer({ iconPath: destPath });
      }
      break;
    }
    case 'maxUsers': {
      const nextMax = parseMemberLimit(normalizedKey, nextValue);
      // Mirrors the rule enforced over the wire (#403): never leave the server
      // above its own cap, since the only way out would be kicking members.
      if (nextMax > LIMITS.MAX_USERS_UNLIMITED) {
        const memberCount = await ctx.userRepo.count();
        if (nextMax < memberCount) {
          throw new Error(
            `O servidor já tem ${memberCount} membros. Remova membros antes de definir um limite menor.`
          );
        }
      }
      await ctx.serverRepo.updateServer({ maxUsers: nextMax });
      break;
    }
    case 'allowSoundboard':
      await ctx.serverRepo.updateServer({ allowSoundboard: parseBoolean(nextValue) });
      break;
    case 'turn': {
      const enabled = parseBoolean(nextValue);
      if (enabled) {
        const reason = CoturnManager.getUnavailabilityReason();
        if (reason) {
          throw new Error(reason);
        }
      }
      const updates: { turnEnabled: boolean; turnSecret?: string } = { turnEnabled: enabled };
      // Minted once and kept: rotating the secret would invalidate every
      // credential already issued and drop the calls being relayed (#425).
      if (enabled && !server.turnSecret) {
        updates.turnSecret = CoturnManager.generateSecret();
      }
      await ctx.serverRepo.updateServer(updates);

      // The running process holds its own copy of this setting, so the change
      // only takes effect once it reloads.
      if (isMonkyServerRunning(getPm2ProcessName(ctx.dataDir))) {
        console.log(
          color('O servidor está rodando. Rode "monky restart" para aplicar a mudança do relay.', ANSI.yellow)
        );
      }
      if (enabled) {
        console.log(
          color(
            'Lembre-se de liberar no firewall a porta 3478 (TCP/UDP) e a faixa UDP 49152-65535.',
            ANSI.dim
          )
        );
      }
      break;
    }
    case 'maxAttachmentFileBytes':
      await ctx.serverRepo.updateServer({ maxAttachmentFileBytes: parsePositiveInt(normalizedKey, nextValue) });
      break;
    case 'maxAttachmentStorageBytes':
      await ctx.serverRepo.updateServer({ maxAttachmentStorageBytes: parsePositiveInt(normalizedKey, nextValue) });
      break;
    case 'autoUpdate': {
      const enabled = parseBoolean(nextValue);
      if (enabled) {
        let schedule: AutoUpdateSchedule = { type: 'daily', value: '04:00' };
        if (process.stdin.isTTY) {
          const scheduleMode = await askChoice('Tipo de agendamento do auto-update:', [
            'Diário em horário fixo (ex: 04:00)',
            'Intervalo de horas (ex: a cada 2 horas)',
          ]);
          if (scheduleMode.startsWith('Intervalo')) {
            const hoursStr = await ask('Intervalo em horas para verificar atualizações', '2');
            const hours = Math.max(1, parseInt(hoursStr, 10) || 2);
            schedule = { type: 'interval', value: hours };
          } else {
            const timeStr = await ask('Horário diário da verificação (HH:MM)', '04:00');
            schedule = { type: 'daily', value: timeStr.trim() || '04:00' };
          }
        }
        await enableAutoUpdate(ctx.dataDir, schedule);
      } else {
        await disableAutoUpdate(ctx.dataDir);
      }
      break;
    }
    default:
      throw new Error(`Chave não suportada: ${key}`);
  }

  console.log(color(`Configuração "${normalizedKey}" atualizada com sucesso.`, ANSI.green));
}
