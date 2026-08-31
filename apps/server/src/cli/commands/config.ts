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
import { t } from '../i18n/index';
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
  return reason ? color(`  (${t('config.turnUnavailable', { reason })})`, ANSI.yellow) : '';
}

export async function showConfig(ctx: CliContext): Promise<void> {
  const server = await ctx.serverRepo.getServer();
  if (!server) {
    throw new Error(t('create.serverNotFound'));
  }

  const localConfig = readLocalConfig(ctx.dataDir);
  const owner = server.ownerUserId ? await ctx.userRepo.findById(server.ownerUserId) : null;
  console.log(color(t('config.title'), ANSI.bold));
  console.log(`dataDir: ${ctx.dataDir}`);
  console.log(`id: ${server.id}`);
  console.log(`name: ${server.name}`);
  console.log(`port: ${localConfig.port || LIMITS.DEFAULT_PORT}`);
  console.log(`hasPassword: ${formatBool(Boolean(server.passwordHash))}`);
  console.log(`maxUsers: ${server.maxUsers > LIMITS.MAX_USERS_UNLIMITED ? server.maxUsers : t('config.noLimit')}`);
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
    t('config.whichKey'),
    CONFIG_KEYS.map((key) => `${key}`)
  );
  return choice as ConfigKey;
}

export async function setConfig(ctx: CliContext, key: string, value?: string): Promise<void> {
  const normalizedKey = (key.trim() || (await askConfigKey())) as ConfigKey;
  const server = await ctx.serverRepo.getServer();
  if (!server) {
    throw new Error(t('create.serverNotFound'));
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
        nextValue = await ask(t('config.askName'), currentValues.name);
        break;
      case 'password':
        nextValue = await promptPassword(t('config.askPassword'));
        break;
      case 'port':
        nextValue = await ask(t('config.askPort'), currentValues.port);
        break;
      case 'icon':
        nextValue = await ask(t('config.askIcon'));
        break;
      case 'allowSoundboard':
        nextValue = await askChoice(t('config.askSoundboard'), ['true', 'false']);
        break;
      case 'turn':
        nextValue = await askChoice(t('config.askTurn'), ['true', 'false']);
        break;
      case 'autoUpdate':
        nextValue = await askChoice(t('config.askAutoUpdate'), ['true', 'false']);
        break;
      case 'maxUsers':
        nextValue = await ask(t('config.askMaxUsers'), currentValues.maxUsers);
        break;
      case 'maxAttachmentFileBytes':
      case 'maxAttachmentStorageBytes':
        nextValue = await ask(t('config.askValue', { key: normalizedKey }), currentValues[normalizedKey]);
        break;
      default:
        nextValue = await ask(t('config.askValue', { key: normalizedKey }));
    }
  }

  switch (normalizedKey) {
    case 'name': {
      const nextName = nextValue.trim();
      if (nextName.length < 2) {
        throw new Error(t('config.nameTooShort'));
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
        const shouldRestart = await confirm(t('config.restartForPort'), true);
        if (shouldRestart) {
          const ecosystemPath = writeEcosystem({
            dataDir: ctx.dataDir,
            port: portNum,
            serverName: (await ctx.serverRepo.getServer())?.name || DEFAULT_SERVER_NAME,
          });
          spawnSync('pm2', ['startOrRestart', ecosystemPath], { stdio: 'inherit', shell: true });
          console.log(color(t('config.portRestarted'), ANSI.green));
        } else {
          console.log(color(t('config.portNextStartOrRestart'), ANSI.dim));
        }
      } else {
        console.log(color(t('config.portNextStart'), ANSI.dim));
      }
      registerServer(ctx.dataDir, { port: portNum });
      break;
    }
    case 'icon': {
      const iconValue = nextValue.trim();
      if (!iconValue || ['clear', 'none', 'remove'].includes(iconValue.toLowerCase())) {
        await ctx.serverRepo.updateServer({ iconPath: null });
        console.log(color(t('config.iconRemoved'), ANSI.dim));
      } else {
        const resolvedPath = path.resolve(iconValue);
        if (!fs.existsSync(resolvedPath)) {
          throw new Error(t('config.fileNotFound', { path: resolvedPath }));
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
          throw new Error(t('config.tooManyMembers', { count: memberCount }));
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
      if (enabled && !CoturnManager.isInstalled()) {
        // Same intent as the desktop toggle: asking is enough, the server does
        // the installing (#431).
        if (!CoturnManager.isSupportedPlatform()) {
          throw new Error(t('config.turnLinuxOnly'));
        }
        console.log(t('config.installingCoturn'));
        const outcome = await CoturnManager.ensureInstalled();
        if (!outcome.ok) {
          switch (outcome.reason) {
            case 'no-privileges':
              throw new Error(t('config.coturnNoPrivileges'));
            case 'unknown-package-manager':
              throw new Error(t('config.coturnNoPackageManager'));
            default:
              throw new Error(t('config.coturnInstallFailed', { detail: outcome.detail ?? 'unknown error' }));
          }
        }
        if (!outcome.alreadyInstalled) {
          console.log(color(t('config.coturnInstalled'), ANSI.green));
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
        console.log(color(t('config.turnRestartNeeded'), ANSI.yellow));
      }
      if (enabled) {
        // Run a real port check instead of a static reminder.
        const portProblem = await CoturnManager.checkPortReachability();
        if (portProblem) {
          console.log(color('⚠ ' + portProblem, ANSI.yellow));
        } else {
          console.log(color(t('config.turnPortOk'), ANSI.green));
        }
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
          const dailyOption = t('config.autoUpdateDaily');
          const intervalOption = t('config.autoUpdateInterval');
          const scheduleMode = await askChoice(t('config.autoUpdateScheduleType'), [
            dailyOption,
            intervalOption,
          ]);
          if (scheduleMode === intervalOption) {
            const hoursStr = await ask(t('config.autoUpdateHoursInterval'), '2');
            const hours = Math.max(1, parseInt(hoursStr, 10) || 2);
            schedule = { type: 'interval', value: hours };
          } else {
            const timeStr = await ask(t('config.autoUpdateDailyTime'), '04:00');
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
      throw new Error(t('config.unsupportedKey', { key }));
  }

  console.log(color(t('config.updated', { key: normalizedKey }), ANSI.green));
}
