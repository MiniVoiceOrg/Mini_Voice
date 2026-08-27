import { v4 as uuidv4 } from 'uuid';
import { UserRecord } from '../../domain/entities';
import {
  ANSI,
  color,
  DEFAULT_BOOTSTRAP_PORT,
  DEFAULT_OWNER_NICKNAME,
  DEFAULT_SERVER_NAME,
} from '../constants';
import { ask, confirm, promptPassword } from '../prompts';
import {
  CliContext,
  GlobalArgs,
  formatDataDirForPrompt,
  readLocalConfig,
  resolveInputPath,
  withContext,
  writeLocalConfig,
} from '../context';
import { DecryptedIdentity, decryptIdentityExport } from '../identity';
import { parseOption, parsePositiveInt } from '../formatters';
import { hasServerDatabase, registerServer } from '../registry';
import { setConfig } from './config';
import { startServerCommand } from './serverLifecycle';

export async function findUserByPublicIdentity(ctx: CliContext, identity: DecryptedIdentity): Promise<UserRecord | null> {
  const byClientId = await ctx.userRepo.findByClientId(identity.clientId);
  if (byClientId) return byClientId;
  return ctx.userRepo.findByPublicKey(identity.publicKey);
}

export async function getUniqueNickname(ctx: CliContext, preferred?: string, excludeUserId?: string): Promise<string> {
  const base = (preferred?.trim() || DEFAULT_OWNER_NICKNAME).slice(0, 32);
  const direct = await ctx.userRepo.findByNickname(base);
  if (!direct || direct.id === excludeUserId) return base;

  for (let i = 1; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    const existing = await ctx.userRepo.findByNickname(candidate);
    if (!existing || existing.id === excludeUserId) return candidate;
  }

  return `owner-${Date.now().toString(36)}`;
}

export async function applyBootstrap(
  ctx: CliContext,
  identityCode: string,
  identityPassword: string,
  nicknameOverride: string
): Promise<void> {
  const identity = decryptIdentityExport(identityCode, identityPassword);
  const server = await ctx.serverRepo.getServer();
  if (!server) {
    throw new Error('Servidor não encontrado.');
  }

  let user = await findUserByPublicIdentity(ctx, identity);

  if (server.ownerUserId && server.ownerUserId !== user?.id) {
    throw new Error('Este servidor já possui um owner configurado.');
  }

  if (!user) {
    const now = Date.now();
    const nickname = await getUniqueNickname(ctx, nicknameOverride);
    user = {
      id: uuidv4(),
      clientId: identity.clientId,
      publicKey: identity.publicKey,
      nickname,
      avatarPath: null,
      createdAt: now,
      lastSeenAt: now,
    };
    await ctx.userRepo.create(user);
  } else {
    await ctx.userRepo.update(user.id, {
      publicKey: identity.publicKey,
      lastSeenAt: Date.now(),
      nickname: nicknameOverride.trim() ? await getUniqueNickname(ctx, nicknameOverride, user.id) : user.nickname,
    });
    user = await ctx.userRepo.findById(user.id);
    if (!user) {
      throw new Error('Falha ao atualizar o usuário bootstrap.');
    }
  }

  const defaultRoles = await ctx.roleRepo.getDefaultRoles();
  for (const role of defaultRoles) {
    await ctx.roleRepo.assignRole(user.id, role.id);
  }

  const adminRole = await ctx.roleRepo.findByName('Admin');
  if (!adminRole) {
    throw new Error('Cargo Admin não encontrado.');
  }

  await ctx.roleRepo.assignRole(user.id, adminRole.id);
  await ctx.serverRepo.updateServer({ ownerUserId: user.id });

  console.log(color('Dono do servidor configurado com sucesso.', ANSI.green));
  console.log(`nickname: ${user.nickname}`);
  console.log(`userId: ${user.id}`);
  console.log(`clientId: ${user.clientId}`);
}

/**
 * Asks where the server data should live.
 *
 * The directory is always confirmed instead of silently defaulting to `./data`
 * in whatever directory the command happened to run from — a globally
 * installed CLI has no meaningful working directory.
 */
async function askDataDir(globalArgs: GlobalArgs): Promise<string> {
  if (globalArgs.dataDirSpecified) {
    return globalArgs.dataDir;
  }

  while (true) {
    const answer = await ask('Onde guardar os dados do servidor', formatDataDirForPrompt(globalArgs.dataDir));
    const resolved = resolveInputPath(answer);
    if (!hasServerDatabase(resolved)) {
      return resolved;
    }
    console.log(color(`Já existe um servidor Monky em: ${resolved}`, ANSI.yellow));
    console.log(color('Escolha outra pasta ou use "monky destroy" para apagar o servidor existente.', ANSI.dim));
  }
}

export async function createCommand(globalArgs: GlobalArgs, args: string[]): Promise<void> {
  const dataDir = await askDataDir(globalArgs);

  if (hasServerDatabase(dataDir)) {
    throw new Error(
      `Já existe um servidor Monky em: ${dataDir}\n` +
        'Use "monky config" para ajustá-lo ou "monky destroy" para apagá-lo.'
    );
  }

  const identityCode = parseOption(args, '--identity') || (await ask('Código de identidade do dono (MONKY-ID:...)'));
  const identityPassword = await promptPassword('Senha da identidade: ');
  const nickname = parseOption(args, '--nickname') || (await ask('Nickname do dono', DEFAULT_OWNER_NICKNAME));
  const serverName = parseOption(args, '--name') || (await ask('Nome do servidor', DEFAULT_SERVER_NAME));
  const portValue = parseOption(args, '--port') || (await ask('Porta do servidor', String(DEFAULT_BOOTSTRAP_PORT)));
  const serverPassword = parseOption(args, '--password') ?? (await promptPassword('Senha do servidor (deixe vazio para sem senha): '));
  const port = parsePositiveInt('port', portValue);

  console.log();
  console.log(color('Resumo do novo servidor', ANSI.bold));
  console.log(`dataDir: ${dataDir}`);
  console.log(`nickname: ${nickname}`);
  console.log(`serverName: ${serverName}`);
  console.log(`port: ${port}`);
  console.log(`serverPassword: ${serverPassword ? 'definida' : 'sem senha'}`);
  console.log(`identity: ${identityCode.slice(0, Math.min(identityCode.length, 40))}${identityCode.length > 40 ? '...' : ''}`);

  const accepted = await confirm('Confirma?', true);
  if (!accepted) {
    console.log(color('Criação cancelada.', ANSI.yellow));
    return;
  }

  await withContext(dataDir, async (ctx) => {
    await applyBootstrap(ctx, identityCode, identityPassword, nickname);
    await setConfig(ctx, 'name', serverName);
    await setConfig(ctx, 'password', serverPassword);
  });

  const config = readLocalConfig(dataDir);
  config.port = port;
  writeLocalConfig(dataDir, config);

  // Registering here is what lets start/stop/restart/update find this server
  // later from any directory.
  registerServer(dataDir, { name: serverName, port });

  if (await confirm('Deseja iniciar o servidor agora?', true)) {
    await startServerCommand({ ...globalArgs, dataDir, dataDirSpecified: true }, ['--port', String(port)]);
  }
}
