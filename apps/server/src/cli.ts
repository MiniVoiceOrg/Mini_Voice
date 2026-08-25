#!/usr/bin/env node

import { createDecipheriv, createPrivateKey, createPublicKey, pbkdf2Sync } from 'crypto';
import path from 'path';
import readline from 'readline';
import { v4 as uuidv4 } from 'uuid';
import { deriveClientIdFromPublicKey, normalizePublicKeyHex, LIMITS } from '@monky/shared';
import { RoleRecord, UserRecord } from './domain/entities';
import { DatabaseConnection } from './infrastructure/database/DatabaseConnection';
import {
  SqliteChannelRepository,
  SqliteRoleRepository,
  SqliteServerRepository,
  SqliteUserRepository,
} from './infrastructure/database/SqliteRepositories';
import { PasswordService } from './infrastructure/security/PasswordService';
import { ensureServerSeedData } from './server';

const EXPORT_PREFIX = 'MONKY-ID:';
const PBKDF2_ITERATIONS = 210_000;
const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'data');

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
};

interface ExportEnvelope {
  version: 1;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

interface ExportPayload {
  version?: number;
  publicKey?: string;
  privateKeyDerBase64: string;
}

interface DecryptedIdentity {
  publicKey: string;
  clientId: string;
  privateKeyDerBase64: string;
}

interface CliContext {
  dataDir: string;
  dbConn: DatabaseConnection;
  serverRepo: SqliteServerRepository;
  userRepo: SqliteUserRepository;
  roleRepo: SqliteRoleRepository;
}

function color(text: string, code: string): string {
  return `${code}${text}${ANSI.reset}`;
}

function printUsage(): void {
  console.log(`
${color('Monky CLI', ANSI.bold)}

Uso:
  monky-cli [--data <pasta>] members list
  monky-cli [--data <pasta>] members info <nickname|clientId>
  monky-cli [--data <pasta>] admin add <nickname|clientId>
  monky-cli [--data <pasta>] admin remove <nickname|clientId>
  monky-cli [--data <pasta>] roles list
  monky-cli [--data <pasta>] config show
  monky-cli [--data <pasta>] config set <chave> <valor>
  monky-cli [--data <pasta>] bootstrap --identity <codigo> [--nickname <apelido>]

Configurações suportadas:
  name
  password          (use "clear" para remover)
  maxUsers
  allowSoundboard   (true/false)
  maxAttachmentFileBytes
  maxAttachmentStorageBytes
`.trim());
}

function parseGlobalArgs(argv: string[]): { dataDir: string; args: string[] } {
  const args: string[] = [];
  let dataDir = DEFAULT_DATA_DIR;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--data') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Informe um caminho após --data.');
      }
      dataDir = path.resolve(value);
      i++;
      continue;
    }
    args.push(arg);
  }

  return { dataDir, args };
}

async function withContext<T>(dataDir: string, fn: (ctx: CliContext) => Promise<T>): Promise<T> {
  const dbPath = path.join(dataDir, 'server.db');
  const dbConn = await DatabaseConnection.create(dbPath);
  const db = dbConn.getDb();
  const serverRepo = new SqliteServerRepository(db);
  const userRepo = new SqliteUserRepository(db);
  const channelRepo = new SqliteChannelRepository(db);
  const roleRepo = new SqliteRoleRepository(db);

  await ensureServerSeedData(
    {
      serverName: 'Servidor dos Amigos',
      password: '',
      maxUsers: LIMITS.MAX_USERS_DEFAULT,
      initialTextChannel: 'geral',
      initialVoiceChannel: 'Geral',
    },
    serverRepo,
    channelRepo,
    roleRepo
  );

  try {
    return await fn({ dataDir, dbConn, serverRepo, userRepo, roleRepo });
  } finally {
    dbConn.close();
  }
}

function formatDate(timestamp?: number | null): string {
  if (!timestamp) return '-';
  return new Date(timestamp).toISOString();
}

function formatBool(value: boolean): string {
  return value ? color('true', ANSI.green) : color('false', ANSI.yellow);
}

function pad(value: string, size: number): string {
  return value.length >= size ? value : value.padEnd(size, ' ');
}

async function resolveUser(ctx: CliContext, query: string): Promise<UserRecord> {
  const normalized = query.trim();
  if (!normalized) {
    throw new Error('Informe um nickname ou clientId.');
  }

  const byClientId = await ctx.userRepo.findByClientId(normalized);
  if (byClientId) {
    return byClientId;
  }

  const byNickname = await ctx.userRepo.findByNickname(normalized);
  if (byNickname) {
    return byNickname;
  }

  throw new Error(`Usuário não encontrado: ${normalized}`);
}

async function getRolesByUserId(ctx: CliContext): Promise<Map<string, RoleRecord[]>> {
  const roles = await ctx.roleRepo.listAll();
  const rolesById = new Map(roles.map((role) => [role.id, role]));
  const userRoles = await ctx.roleRepo.listUserRoles();
  const grouped = new Map<string, RoleRecord[]>();

  for (const entry of userRoles) {
    const role = rolesById.get(entry.roleId);
    if (!role) continue;
    const list = grouped.get(entry.userId) ?? [];
    list.push(role);
    grouped.set(entry.userId, list);
  }

  for (const list of grouped.values()) {
    list.sort((a, b) => b.position - a.position || a.name.localeCompare(b.name));
  }

  return grouped;
}

async function listMembers(ctx: CliContext): Promise<void> {
  const users = (await ctx.userRepo.listAll()).sort((a, b) => a.nickname.localeCompare(b.nickname));
  const rolesByUser = await getRolesByUserId(ctx);

  if (users.length === 0) {
    console.log(color('Nenhum membro registrado.', ANSI.yellow));
    return;
  }

  const idWidth = Math.max(2, ...users.map((user) => user.id.length));
  const nickWidth = Math.max(8, ...users.map((user) => user.nickname.length));
  const clientWidth = Math.max(8, ...users.map((user) => user.clientId.length));

  console.log(
    `${color(pad('ID', idWidth), ANSI.cyan)}  ${color(pad('Nickname', nickWidth), ANSI.cyan)}  ${color(
      pad('Client ID', clientWidth),
      ANSI.cyan
    )}  ${color('Roles', ANSI.cyan)}`
  );

  for (const user of users) {
    const roleNames = (rolesByUser.get(user.id) ?? []).map((role) => role.name).join(', ') || '-';
    console.log(
      `${pad(user.id, idWidth)}  ${pad(user.nickname, nickWidth)}  ${pad(user.clientId, clientWidth)}  ${roleNames}`
    );
  }
}

async function showMemberInfo(ctx: CliContext, query: string): Promise<void> {
  const user = await resolveUser(ctx, query);
  const roles = await ctx.roleRepo.listRolesForUser(user.id);
  const server = await ctx.serverRepo.getServer();

  console.log(color(`Membro: ${user.nickname}`, ANSI.bold));
  console.log(`id: ${user.id}`);
  console.log(`clientId: ${user.clientId}`);
  console.log(`publicKey: ${user.publicKey ?? '-'}`);
  console.log(`avatarPath: ${user.avatarPath ?? '-'}`);
  console.log(`createdAt: ${formatDate(user.createdAt)}`);
  console.log(`lastSeenAt: ${formatDate(user.lastSeenAt)}`);
  console.log(`owner: ${formatBool(server?.ownerUserId === user.id)}`);
  console.log(`roles: ${roles.map((role) => role.name).join(', ') || '-'}`);
}

async function changeAdminRole(ctx: CliContext, query: string, assign: boolean): Promise<void> {
  const user = await resolveUser(ctx, query);
  const adminRole = await ctx.roleRepo.findByName('Admin');
  if (!adminRole) {
    throw new Error('Cargo Admin não encontrado.');
  }

  if (assign) {
    await ctx.roleRepo.assignRole(user.id, adminRole.id);
    console.log(color(`Admin concedido para ${user.nickname}.`, ANSI.green));
    return;
  }

  await ctx.roleRepo.unassignRole(user.id, adminRole.id);
  console.log(color(`Admin removido de ${user.nickname}.`, ANSI.green));
}

async function listRoles(ctx: CliContext): Promise<void> {
  const roles = await ctx.roleRepo.listAll();
  const userRoles = await ctx.roleRepo.listUserRoles();
  const counts = new Map<string, number>();

  for (const entry of userRoles) {
    counts.set(entry.roleId, (counts.get(entry.roleId) ?? 0) + 1);
  }

  if (roles.length === 0) {
    console.log(color('Nenhum cargo cadastrado.', ANSI.yellow));
    return;
  }

  for (const role of roles) {
    console.log(color(`${role.name} (${role.id})`, ANSI.bold));
    console.log(`  color: ${role.color ?? '-'}`);
    console.log(`  position: ${role.position}`);
    console.log(`  permissions: ${role.permissions}`);
    console.log(`  isDefault: ${formatBool(role.isDefault)}`);
    console.log(`  members: ${counts.get(role.id) ?? 0}`);
  }
}

async function showConfig(ctx: CliContext): Promise<void> {
  const server = await ctx.serverRepo.getServer();
  if (!server) {
    throw new Error('Servidor não encontrado.');
  }

  const owner = server.ownerUserId ? await ctx.userRepo.findById(server.ownerUserId) : null;
  console.log(color('Configuração do servidor', ANSI.bold));
  console.log(`dataDir: ${ctx.dataDir}`);
  console.log(`id: ${server.id}`);
  console.log(`name: ${server.name}`);
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

function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'sim', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'nao', 'não', 'off'].includes(normalized)) return false;
  throw new Error(`Valor booleano inválido: ${value}`);
}

function parsePositiveInt(key: string, value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Valor inválido para ${key}: ${value}`);
  }
  return parsed;
}

async function setConfig(ctx: CliContext, key: string, value: string): Promise<void> {
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    throw new Error('Informe uma chave de configuração.');
  }

  switch (normalizedKey) {
    case 'name': {
      const nextName = value.trim();
      if (nextName.length < 2) {
        throw new Error('O nome do servidor deve ter pelo menos 2 caracteres.');
      }
      await ctx.serverRepo.updateServer({ name: nextName });
      break;
    }
    case 'password': {
      const normalizedValue = value.trim().toLowerCase();
      const shouldClear = ['clear', 'none', 'null', 'empty', 'remove'].includes(normalizedValue);
      await ctx.serverRepo.updateServer({
        passwordHash: shouldClear ? '' : PasswordService.hashPassword(value),
      });
      break;
    }
    case 'maxUsers':
      await ctx.serverRepo.updateServer({ maxUsers: parsePositiveInt(normalizedKey, value) });
      break;
    case 'allowSoundboard':
      await ctx.serverRepo.updateServer({ allowSoundboard: parseBoolean(value) });
      break;
    case 'maxAttachmentFileBytes':
      await ctx.serverRepo.updateServer({ maxAttachmentFileBytes: parsePositiveInt(normalizedKey, value) });
      break;
    case 'maxAttachmentStorageBytes':
      await ctx.serverRepo.updateServer({ maxAttachmentStorageBytes: parsePositiveInt(normalizedKey, value) });
      break;
    default:
      throw new Error(`Chave não suportada: ${key}`);
  }

  console.log(color(`Configuração "${key}" atualizada com sucesso.`, ANSI.green));
}

function buildExportKey(password: string, salt: Buffer): Buffer {
  if (!password.trim()) {
    throw new Error('Informe a senha da identidade.');
  }
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
}

function decryptIdentityExport(exportedIdentity: string, password: string): DecryptedIdentity {
  const normalized = exportedIdentity.trim();
  if (!normalized.startsWith(EXPORT_PREFIX)) {
    throw new Error('Código de identidade inválido.');
  }

  const encodedPayload = normalized.slice(EXPORT_PREFIX.length);
  const envelope = JSON.parse(Buffer.from(encodedPayload, 'base64').toString('utf8')) as ExportEnvelope;
  if (!envelope?.salt || !envelope?.iv || !envelope?.tag || !envelope?.ciphertext) {
    throw new Error('Conteúdo da identidade inválido.');
  }

  const key = buildExportKey(password, Buffer.from(envelope.salt, 'hex'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));

  let payload: ExportPayload;
  try {
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'hex')),
      decipher.final(),
    ]).toString('utf8');
    payload = JSON.parse(decrypted) as ExportPayload;
  } catch {
    throw new Error('Senha incorreta ou identidade corrompida.');
  }

  if (!payload?.privateKeyDerBase64) {
    throw new Error('Identidade descriptografada inválida.');
  }

  const privateKey = createPrivateKey({
    key: Buffer.from(payload.privateKeyDerBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = normalizePublicKeyHex(
    createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('hex')
  );

  if (payload.publicKey && normalizePublicKeyHex(payload.publicKey) !== publicKey) {
    throw new Error('A identidade descriptografada não corresponde à chave pública informada.');
  }

  return {
    publicKey,
    clientId: deriveClientIdFromPublicKey(publicKey),
    privateKeyDerBase64: payload.privateKeyDerBase64,
  };
}

async function promptPassword(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  return new Promise((resolve, reject) => {
    let value = '';
    const stdin = process.stdin;
    const stdout = process.stdout;

    const cleanup = () => {
      stdin.off('data', onData);
      if (stdin.isTTY) {
        stdin.setRawMode(false);
      }
      stdin.pause();
    };

    const onData = (chunk: Buffer | string) => {
      const input = chunk.toString('utf8');
      for (const char of input) {
        if (char === '\r' || char === '\n') {
          stdout.write('\n');
          cleanup();
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          stdout.write('\n');
          cleanup();
          reject(new Error('Operação cancelada.'));
          return;
        }
        if (char === '\b' || char === '\u007f') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    stdout.write(question);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.on('data', onData);
  });
}

function parseOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

async function findUserByPublicIdentity(ctx: CliContext, identity: DecryptedIdentity): Promise<UserRecord | null> {
  const byClientId = await ctx.userRepo.findByClientId(identity.clientId);
  if (byClientId) return byClientId;
  return ctx.userRepo.findByPublicKey(identity.publicKey);
}

async function getUniqueNickname(ctx: CliContext, preferred?: string, excludeUserId?: string): Promise<string> {
  const base = (preferred?.trim() || 'Owner').slice(0, 32);
  const direct = await ctx.userRepo.findByNickname(base);
  if (!direct || direct.id === excludeUserId) return base;

  for (let i = 1; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    const existing = await ctx.userRepo.findByNickname(candidate);
    if (!existing || existing.id === excludeUserId) return candidate;
  }

  return `owner-${Date.now().toString(36)}`;
}

async function bootstrapServer(ctx: CliContext, args: string[]): Promise<void> {
  const identityCode = parseOption(args, '--identity');
  const nicknameOverride = parseOption(args, '--nickname');
  if (!identityCode) {
    throw new Error('Use bootstrap --identity <codigo>.');
  }

  const password = await promptPassword('Senha da identidade: ');
  const identity = decryptIdentityExport(identityCode, password);
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
      nickname: nicknameOverride?.trim() ? await getUniqueNickname(ctx, nicknameOverride, user.id) : user.nickname,
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

  console.log(color('Bootstrap concluído com sucesso.', ANSI.green));
  console.log(`nickname: ${user.nickname}`);
  console.log(`userId: ${user.id}`);
  console.log(`clientId: ${user.clientId}`);
}

async function runCommand(dataDir: string, args: string[]): Promise<void> {
  const [section, action, ...rest] = args;

  if (!section || section === 'help' || section === '--help' || section === '-h') {
    printUsage();
    return;
  }

  await withContext(dataDir, async (ctx) => {
    if (section === 'members' && action === 'list') {
      await listMembers(ctx);
      return;
    }
    if (section === 'members' && action === 'info') {
      await showMemberInfo(ctx, rest.join(' '));
      return;
    }
    if (section === 'admin' && action === 'add') {
      await changeAdminRole(ctx, rest.join(' '), true);
      return;
    }
    if (section === 'admin' && action === 'remove') {
      await changeAdminRole(ctx, rest.join(' '), false);
      return;
    }
    if (section === 'roles' && action === 'list') {
      await listRoles(ctx);
      return;
    }
    if (section === 'config' && action === 'show') {
      await showConfig(ctx);
      return;
    }
    if (section === 'config' && action === 'set') {
      if (rest.length < 2) {
        throw new Error('Use config set <chave> <valor>.');
      }
      await setConfig(ctx, rest[0], rest.slice(1).join(' '));
      return;
    }
    if (section === 'bootstrap') {
      await bootstrapServer(ctx, [action, ...rest].filter(Boolean));
      return;
    }

    throw new Error('Comando inválido.');
  });
}

async function main(): Promise<void> {
  const { dataDir, args } = parseGlobalArgs(process.argv.slice(2));
  await runCommand(dataDir, args);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(color(`Erro: ${error instanceof Error ? error.message : String(error)}`, ANSI.red));
    printUsage();
    process.exit(1);
  });
}
