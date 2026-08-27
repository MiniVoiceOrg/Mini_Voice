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
import { formatBool, formatDate, parseBoolean, parsePositiveInt } from '../formatters';
import {
  generateEcosystem,
  getEcosystemPath,
  isMonkyServerRunning,
  PM2_PROCESS_NAME,
} from '../pm2';
import { ask, askChoice, confirm, promptPassword } from '../prompts';
import { disableAutoUpdate, enableAutoUpdate } from './update';

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
  console.log(`maxUsers: ${server.maxUsers}`);
  console.log(`ownerUserId: ${server.ownerUserId ?? '-'}`);
  console.log(`ownerNickname: ${owner?.nickname ?? '-'}`);
  console.log(`allowSoundboard: ${formatBool(server.allowSoundboard !== false)}`);
  console.log(`iconPath: ${server.iconPath ?? '-'}`);
  console.log(`maxAttachmentFileBytes: ${server.maxAttachmentFileBytes ?? '-'}`);
  console.log(`maxAttachmentStorageBytes: ${server.maxAttachmentStorageBytes ?? '-'}`);
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
    autoUpdate: 'false',
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
      case 'autoUpdate':
        nextValue = await askChoice('Habilitar atualização automática?', ['true', 'false']);
        break;
      case 'maxUsers':
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
      if (isMonkyServerRunning()) {
        const shouldRestart = await confirm('Servidor está rodando. Deseja reiniciar agora para aplicar a nova porta?', true);
        if (shouldRestart) {
          const ecosystemPath = getEcosystemPath(ctx.dataDir);
          const ecosystemContent = generateEcosystem(ctx.dataDir, portNum, (await ctx.serverRepo.getServer())?.name || DEFAULT_SERVER_NAME);
          fs.writeFileSync(ecosystemPath, ecosystemContent, 'utf8');
          const legacyEcosystemPath = path.join(ctx.dataDir, 'ecosystem.config.js');
          if (fs.existsSync(legacyEcosystemPath)) {
            try {
              fs.unlinkSync(legacyEcosystemPath);
            } catch {}
          }
          spawnSync('pm2', ['restart', PM2_PROCESS_NAME], { stdio: 'inherit', shell: true });
          console.log(color('Servidor reiniciado com a nova porta.', ANSI.green));
        } else {
          console.log(color('A nova porta será usada no próximo "monky start" ou "monky restart".', ANSI.dim));
        }
      } else {
        console.log(color('A nova porta será usada no próximo "monky start".', ANSI.dim));
      }
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
    case 'maxUsers':
      await ctx.serverRepo.updateServer({ maxUsers: parsePositiveInt(normalizedKey, nextValue) });
      break;
    case 'allowSoundboard':
      await ctx.serverRepo.updateServer({ allowSoundboard: parseBoolean(nextValue) });
      break;
    case 'maxAttachmentFileBytes':
      await ctx.serverRepo.updateServer({ maxAttachmentFileBytes: parsePositiveInt(normalizedKey, nextValue) });
      break;
    case 'maxAttachmentStorageBytes':
      await ctx.serverRepo.updateServer({ maxAttachmentStorageBytes: parsePositiveInt(normalizedKey, nextValue) });
      break;
    case 'autoUpdate': {
      const enabled = parseBoolean(nextValue);
      if (enabled) {
        await enableAutoUpdate(ctx.dataDir);
      } else {
        await disableAutoUpdate();
      }
      break;
    }
    default:
      throw new Error(`Chave não suportada: ${key}`);
  }

  console.log(color(`Configuração "${normalizedKey}" atualizada com sucesso.`, ANSI.green));
}
