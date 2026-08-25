#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { createDecipheriv, createPrivateKey, createPublicKey, pbkdf2Sync } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { deriveClientIdFromPublicKey, LIMITS, normalizePublicKeyHex, Permission } from '@monky/shared';
import { RoleRecord, UserRecord } from './domain/entities';
import { DatabaseConnection } from './infrastructure/database/DatabaseConnection';
import {
  SqliteChannelRepository,
  SqliteRoleRepository,
  SqliteServerRepository,
  SqliteUserRepository,
} from './infrastructure/database/SqliteRepositories';
import { PasswordService } from './infrastructure/security/PasswordService';
import { ensureServerSeedData, MonkyServer, ServerConfig } from './server';

const EXPORT_PREFIX = 'MONKY-ID:';
const PBKDF2_ITERATIONS = 210_000;
const DEFAULT_DATA_INPUT = './data';
const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'data');
const DEFAULT_OWNER_NICKNAME = 'Owner';
const DEFAULT_SERVER_NAME = 'Servidor dos Amigos';
const DEFAULT_BOOTSTRAP_PORT = 3001;
const PID_FILE_NAME = 'monky.pid';
const SERVER_DB_NAME = 'server.db';
const CONFIG_KEYS = [
  'name',
  'password',
  'maxUsers',
  'allowSoundboard',
  'maxAttachmentFileBytes',
  'maxAttachmentStorageBytes',
] as const;
const PERMISSION_OPTIONS = Object.keys(Permission)
  .filter((key) => Number.isNaN(Number(key)))
  .map((key) => ({ name: key as keyof typeof Permission, value: Permission[key as keyof typeof Permission] as number }));

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

interface GlobalArgs {
  dataDir: string;
  dataDirSpecified: boolean;
  args: string[];
}

type ConfigKey = (typeof CONFIG_KEYS)[number];

function color(text: string, code: string): string {
  return `${code}${text}${ANSI.reset}`;
}

function printUsage(): void {
  console.log(`
${color('Monky CLI - Ferramenta de administração do servidor Monky', ANSI.bold)}

Uso:
  monky bootstrap          Configura um novo servidor (interativo)
  monky start              Inicia o servidor
  monky stop               Para o servidor
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

Opções globais:
  --data <pasta>   Caminho dos dados (padrão: ./data)
  --help, -h       Mostra esta ajuda

Instalação global:
  cd apps/server && npm install -g .
  Depois use "monky" de qualquer lugar.
`.trim());
}

function parseGlobalArgs(argv: string[]): GlobalArgs {
  const args: string[] = [];
  let dataDir = DEFAULT_DATA_DIR;
  let dataDirSpecified = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--data') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Informe um caminho após --data.');
      }
      dataDir = path.resolve(value);
      dataDirSpecified = true;
      i++;
      continue;
    }
    args.push(arg);
  }

  return { dataDir, dataDirSpecified, args };
}

function dataDbPath(dataDir: string): string {
  return path.join(dataDir, SERVER_DB_NAME);
}

function dataPidPath(dataDir: string): string {
  return path.join(dataDir, PID_FILE_NAME);
}

function formatDataDirForPrompt(dataDir: string): string {
  return dataDir === DEFAULT_DATA_DIR ? DEFAULT_DATA_INPUT : dataDir;
}

async function ask(question: string, defaultValue?: string): Promise<string> {
  const label = defaultValue !== undefined ? `${question} (${defaultValue}): ` : `${question}: `;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question(label, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed || defaultValue || '');
    });
  });
}

function renderChoiceList(choices: string[], cursor: number, selected?: Set<number>): void {
  const stdout = process.stdout;
  for (let i = 0; i < choices.length; i++) {
    const isCursor = i === cursor;
    const prefix = selected
      ? (selected.has(i) ? (isCursor ? '❯ ✔ ' : '  ✔ ') : (isCursor ? '❯   ' : '    '))
      : (isCursor ? '❯ ' : '  ');
    const line = `${prefix}${choices[i]}`;
    stdout.write(isCursor ? color(line, ANSI.cyan) : `${ANSI.dim}${line}${ANSI.reset}`);
    stdout.write('\n');
  }
}

function clearLines(count: number): void {
  const stdout = process.stdout;
  for (let i = 0; i < count; i++) {
    stdout.write('\u001b[1A\u001b[2K');
  }
}

async function askChoiceArrows(question: string, choices: string[]): Promise<string> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  stdout.write(`${color(question, ANSI.bold)}\n`);
  stdout.write(color('  Use ↑↓ para navegar, Enter para selecionar\n', ANSI.dim));

  let cursor = 0;
  renderChoiceList(choices, cursor);

  return new Promise((resolve, reject) => {
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };

    const onData = (data: string) => {
      if (data === '\u0003') {
        cleanup();
        reject(new Error('Operação cancelada.'));
        return;
      }
      if (data === '\r' || data === '\n') {
        cleanup();
        clearLines(choices.length);
        stdout.write(`${color('❯', ANSI.cyan)} ${choices[cursor]}\n`);
        resolve(choices[cursor]);
        return;
      }
      if (data === '\u001b[A' || data === 'k') {
        clearLines(choices.length);
        cursor = (cursor - 1 + choices.length) % choices.length;
        renderChoiceList(choices, cursor);
        return;
      }
      if (data === '\u001b[B' || data === 'j') {
        clearLines(choices.length);
        cursor = (cursor + 1) % choices.length;
        renderChoiceList(choices, cursor);
        return;
      }
      const numeric = Number.parseInt(data, 10);
      if (Number.isInteger(numeric) && numeric >= 1 && numeric <= choices.length) {
        cleanup();
        clearLines(choices.length);
        stdout.write(`${color('❯', ANSI.cyan)} ${choices[numeric - 1]}\n`);
        resolve(choices[numeric - 1]);
      }
    };

    stdin.on('data', onData);
  });
}

async function askChoiceFallback(question: string, choices: string[]): Promise<string> {
  console.log(question);
  choices.forEach((choice, index) => {
    console.log(`  ${index + 1}. ${choice}`);
  });

  while (true) {
    const answer = await ask('Selecione uma opção');
    const numeric = Number.parseInt(answer, 10);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= choices.length) {
      return choices[numeric - 1];
    }
    const direct = choices.find((choice) => choice.toLowerCase() === answer.toLowerCase());
    if (direct) return direct;
    console.log(color('Opção inválida. Tente novamente.', ANSI.yellow));
  }
}

async function askChoice(question: string, choices: string[]): Promise<string> {
  if (choices.length === 0) {
    throw new Error('Nenhuma opção disponível.');
  }
  if (process.stdin.isTTY) {
    return askChoiceArrows(question, choices);
  }
  return askChoiceFallback(question, choices);
}

async function confirm(question: string, defaultYes: boolean = true): Promise<boolean> {
  const suffix = defaultYes ? ' (S/n)' : ' (s/N)';
  while (true) {
    const answer = (await ask(`${question}${suffix}`)).trim().toLowerCase();
    if (!answer) return defaultYes;
    if (['s', 'sim', 'y', 'yes'].includes(answer)) return true;
    if (['n', 'nao', 'não', 'no'].includes(answer)) return false;
    console.log(color('Responda com S ou N.', ANSI.yellow));
  }
}

async function askMultiChoiceArrows(question: string, choices: string[]): Promise<string[]> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  stdout.write(`${color(question, ANSI.bold)}\n`);
  stdout.write(color('  Use ↑↓ para navegar, Espaço para marcar/desmarcar, Enter para confirmar\n', ANSI.dim));

  let cursor = 0;
  const selected = new Set<number>();
  renderChoiceList(choices, cursor, selected);

  return new Promise((resolve, reject) => {
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };

    const onData = (data: string) => {
      if (data === '\u0003') {
        cleanup();
        reject(new Error('Operação cancelada.'));
        return;
      }
      if (data === '\r' || data === '\n') {
        cleanup();
        clearLines(choices.length);
        const result = choices.filter((_, i) => selected.has(i));
        if (result.length) {
          stdout.write(`${color('✔', ANSI.green)} ${result.join(', ')}\n`);
        } else {
          stdout.write(`${color('—', ANSI.dim)} nenhuma selecionada\n`);
        }
        resolve(result);
        return;
      }
      if (data === '\u001b[A' || data === 'k') {
        clearLines(choices.length);
        cursor = (cursor - 1 + choices.length) % choices.length;
        renderChoiceList(choices, cursor, selected);
        return;
      }
      if (data === '\u001b[B' || data === 'j') {
        clearLines(choices.length);
        cursor = (cursor + 1) % choices.length;
        renderChoiceList(choices, cursor, selected);
        return;
      }
      if (data === ' ') {
        clearLines(choices.length);
        if (selected.has(cursor)) {
          selected.delete(cursor);
        } else {
          selected.add(cursor);
        }
        renderChoiceList(choices, cursor, selected);
        return;
      }
      if (data === 'a') {
        clearLines(choices.length);
        if (selected.size === choices.length) {
          selected.clear();
        } else {
          choices.forEach((_, i) => selected.add(i));
        }
        renderChoiceList(choices, cursor, selected);
      }
    };

    stdin.on('data', onData);
  });
}

async function askMultiChoiceFallback(question: string, choices: string[]): Promise<string[]> {
  console.log(question);
  choices.forEach((choice, index) => {
    console.log(`  ${index + 1}. [ ] ${choice}`);
  });
  console.log(color('Digite os números separados por vírgula. Deixe vazio para nenhuma permissão.', ANSI.dim));

  while (true) {
    const answer = await ask('Permissões');
    if (!answer.trim()) {
      return [];
    }

    const result = new Set<string>();
    let valid = true;
    for (const token of answer.split(',').map((item) => item.trim()).filter(Boolean)) {
      const numeric = Number.parseInt(token, 10);
      if (Number.isInteger(numeric) && numeric >= 1 && numeric <= choices.length) {
        result.add(choices[numeric - 1]);
        continue;
      }
      const direct = choices.find((choice) => choice.toLowerCase() === token.toLowerCase());
      if (direct) {
        result.add(direct);
        continue;
      }
      valid = false;
      break;
    }

    if (valid) return [...result];
    console.log(color('Seleção inválida. Use números separados por vírgula.', ANSI.yellow));
  }
}

async function askMultiChoice(question: string, choices: string[]): Promise<string[]> {
  if (process.stdin.isTTY) {
    return askMultiChoiceArrows(question, choices);
  }
  return askMultiChoiceFallback(question, choices);
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

function permissionLabel(name: keyof typeof Permission): string {
  return name
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

function encodePermissions(names: string[]): number {
  let permissions = 0;
  for (const selected of names) {
    const option = PERMISSION_OPTIONS.find((entry) => permissionLabel(entry.name) === selected || entry.name === selected);
    if (option) {
      permissions |= option.value;
    }
  }
  return permissions;
}

function parsePermissionNames(input: string): string[] {
  if (!input.trim()) return [];
  const selected = new Set<string>();
  for (const token of input.split(',').map((item) => item.trim()).filter(Boolean)) {
    const byEnum = PERMISSION_OPTIONS.find((entry) => entry.name.toLowerCase() === token.toLowerCase());
    if (byEnum) {
      selected.add(permissionLabel(byEnum.name));
      continue;
    }

    const byLabel = PERMISSION_OPTIONS.find((entry) => permissionLabel(entry.name).toLowerCase() === token.toLowerCase());
    if (byLabel) {
      selected.add(permissionLabel(byLabel.name));
      continue;
    }

    throw new Error(`Permissão inválida: ${token}`);
  }
  return [...selected];
}

function normalizeRoleColor(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^#?[0-9a-fA-F]{6}$/.test(trimmed)) {
    throw new Error('Cor inválida. Use formato #RRGGBB.');
  }
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

function resolveInputPath(value: string): string {
  return path.resolve(value.trim() || DEFAULT_DATA_INPUT);
}

function isHelpArg(value?: string): boolean {
  return value === 'help' || value === '--help' || value === '-h';
}

async function withContext<T>(dataDir: string, fn: (ctx: CliContext) => Promise<T>, seed: boolean = true): Promise<T> {
  const dbConn = await DatabaseConnection.create(dataDbPath(dataDir));
  const db = dbConn.getDb();
  const serverRepo = new SqliteServerRepository(db);
  const userRepo = new SqliteUserRepository(db);
  const channelRepo = new SqliteChannelRepository(db);
  const roleRepo = new SqliteRoleRepository(db);

  if (seed) {
    await ensureServerSeedData(
      {
        serverName: DEFAULT_SERVER_NAME,
        password: '',
        maxUsers: LIMITS.MAX_USERS_DEFAULT,
        initialTextChannel: 'geral',
        initialVoiceChannel: 'Geral',
      },
      serverRepo,
      channelRepo,
      roleRepo
    );
  }

  try {
    return await fn({ dataDir, dbConn, serverRepo, userRepo, roleRepo });
  } finally {
    dbConn.close();
  }
}

async function ensureExistingDataDir(dataDir: string, dataDirSpecified: boolean): Promise<string> {
  if (dataDirSpecified) {
    if (!fs.existsSync(dataDir) || !fs.existsSync(dataDbPath(dataDir))) {
      throw new Error(`Pasta de dados inválida: ${dataDir}`);
    }
    return dataDir;
  }

  if (fs.existsSync(dataDir) && fs.existsSync(dataDbPath(dataDir))) {
    return dataDir;
  }

  while (true) {
    const answer = await ask('Caminho dos dados', formatDataDirForPrompt(dataDir));
    const resolved = resolveInputPath(answer);
    if (fs.existsSync(resolved) && fs.existsSync(dataDbPath(resolved))) {
      return resolved;
    }
    console.log(color('Pasta ou banco não encontrado. Informe uma pasta de dados válida.', ANSI.yellow));
  }
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

async function resolveRole(ctx: CliContext, query: string): Promise<RoleRecord> {
  const normalized = query.trim();
  if (!normalized) {
    throw new Error('Informe um cargo.');
  }

  const byId = await ctx.roleRepo.findById(normalized);
  if (byId) return byId;

  const byName = await ctx.roleRepo.findByName(normalized);
  if (byName) return byName;

  throw new Error(`Cargo não encontrado: ${normalized}`);
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
  const normalized = query.trim() || (await ask('Nickname ou clientId do membro'));
  const user = await resolveUser(ctx, normalized);
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

async function selectUser(ctx: CliContext, question: string, query?: string): Promise<UserRecord> {
  if (query?.trim()) {
    return resolveUser(ctx, query);
  }

  const users = (await ctx.userRepo.listAll()).sort((a, b) => a.nickname.localeCompare(b.nickname));
  if (users.length === 0) {
    throw new Error('Nenhum membro registrado.');
  }

  const labels = users.map((u) => `${u.nickname} (${u.clientId})`);
  const selected = await askChoice(question, labels);
  return users[labels.indexOf(selected)];
}

async function selectRole(
  ctx: CliContext,
  question: string,
  query?: string,
  rolesOverride?: RoleRecord[]
): Promise<RoleRecord> {
  if (query?.trim()) {
    return resolveRole(ctx, query);
  }

  const roles = rolesOverride ?? (await ctx.roleRepo.listAll());
  if (roles.length === 0) {
    throw new Error('Nenhum cargo cadastrado.');
  }

  const labels = roles.map((r) => `${r.name} (${r.id})`);
  const selected = await askChoice(question, labels);
  return roles[labels.indexOf(selected)];
}

async function changeAdminRole(ctx: CliContext, query: string, assign: boolean): Promise<void> {
  const user = await selectUser(
    ctx,
    assign ? 'Membros do servidor:' : 'Selecione o membro para remover o admin:',
    query
  );
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

async function createRoleInteractive(ctx: CliContext, args: string[]): Promise<void> {
  const inlineName = args[0];
  const inlineColor = args[1];
  const inlinePermissions = args.slice(2).join(' ');

  const name = inlineName?.trim() || (await ask('Nome do cargo'));
  if (name.trim().length < 2) {
    throw new Error('O nome do cargo deve ter pelo menos 2 caracteres.');
  }

  const colorInput = inlineColor !== undefined ? inlineColor : await ask('Cor do cargo (#RRGGBB, opcional)');
  const roleColor = normalizeRoleColor(colorInput || '');

  const selectedPermissions = inlinePermissions.trim()
    ? parsePermissionNames(inlinePermissions)
    : await askMultiChoice(
        'Permissões do cargo:',
        PERMISSION_OPTIONS.map((entry) => `${permissionLabel(entry.name)} (${entry.name})`)
      );

  const permissions = inlinePermissions.trim()
    ? encodePermissions(selectedPermissions)
    : encodePermissions(
        selectedPermissions.map((entry) => (entry.includes('(') ? entry.slice(0, entry.indexOf(' (')) : entry))
      );

  const role: RoleRecord = {
    id: uuidv4(),
    name: name.trim(),
    color: roleColor,
    position: Date.now(),
    permissions,
    isDefault: false,
    createdAt: Date.now(),
  };

  await ctx.roleRepo.create(role);
  console.log(color(`Cargo "${role.name}" criado com sucesso.`, ANSI.green));
}

async function assignRoleInteractive(ctx: CliContext, args: string[], unassign: boolean): Promise<void> {
  const user = await selectUser(ctx, 'Membros do servidor:', args[0]);
  const availableRoles = unassign ? await ctx.roleRepo.listRolesForUser(user.id) : await ctx.roleRepo.listAll();

  if (availableRoles.length === 0) {
    console.log(color(unassign ? 'Esse membro não possui cargos removíveis.' : 'Nenhum cargo disponível.', ANSI.yellow));
    return;
  }

  const role = await selectRole(
    ctx,
    unassign ? 'Selecione o cargo para remover:' : 'Selecione o cargo para atribuir:',
    args[1],
    availableRoles
  );

  if (unassign && role.isDefault) {
    throw new Error('O cargo padrão não pode ser removido.');
  }

  if (unassign) {
    await ctx.roleRepo.unassignRole(user.id, role.id);
    console.log(color(`Cargo ${role.name} removido de ${user.nickname}.`, ANSI.green));
    return;
  }

  await ctx.roleRepo.assignRole(user.id, role.id);
  console.log(color(`Cargo ${role.name} atribuído para ${user.nickname}.`, ANSI.green));
}

async function deleteRoleInteractive(ctx: CliContext, args: string[]): Promise<void> {
  const role = await selectRole(ctx, 'Selecione o cargo para remover:', args[0]);
  const accepted = await confirm(`Confirma a remoção do cargo ${role.name}?`, false);
  if (!accepted) {
    console.log(color('Operação cancelada.', ANSI.yellow));
    return;
  }

  await ctx.roleRepo.delete(role.id);
  console.log(color(`Cargo ${role.name} removido com sucesso.`, ANSI.green));
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

async function askConfigKey(): Promise<ConfigKey> {
  const choice = await askChoice(
    'Qual configuração deseja alterar?',
    CONFIG_KEYS.map((key) => `${key}`)
  );
  return choice as ConfigKey;
}

async function setConfig(ctx: CliContext, key: string, value?: string): Promise<void> {
  const normalizedKey = (key.trim() || (await askConfigKey())) as ConfigKey;
  const server = await ctx.serverRepo.getServer();
  if (!server) {
    throw new Error('Servidor não encontrado.');
  }

  const currentValues: Record<ConfigKey, string> = {
    name: server.name,
    password: '',
    maxUsers: String(server.maxUsers),
    allowSoundboard: String(server.allowSoundboard !== false),
    maxAttachmentFileBytes: String(server.maxAttachmentFileBytes ?? ''),
    maxAttachmentStorageBytes: String(server.maxAttachmentStorageBytes ?? ''),
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
      case 'allowSoundboard':
        nextValue = await askChoice('Permitir soundboard?', ['true', 'false']);
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
    default:
      throw new Error(`Chave não suportada: ${key}`);
  }

  console.log(color(`Configuração "${normalizedKey}" atualizada com sucesso.`, ANSI.green));
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

async function findUserByPublicIdentity(ctx: CliContext, identity: DecryptedIdentity): Promise<UserRecord | null> {
  const byClientId = await ctx.userRepo.findByClientId(identity.clientId);
  if (byClientId) return byClientId;
  return ctx.userRepo.findByPublicKey(identity.publicKey);
}

async function getUniqueNickname(ctx: CliContext, preferred?: string, excludeUserId?: string): Promise<string> {
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

async function applyBootstrap(ctx: CliContext, identityCode: string, identityPassword: string, nicknameOverride: string): Promise<void> {
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

  console.log(color('Bootstrap concluído com sucesso.', ANSI.green));
  console.log(`nickname: ${user.nickname}`);
  console.log(`userId: ${user.id}`);
  console.log(`clientId: ${user.clientId}`);
}

async function bootstrapCommand(globalArgs: GlobalArgs, args: string[]): Promise<void> {
  const interactiveBootstrap = args.length === 0;
  const dataDir = globalArgs.dataDirSpecified
    ? globalArgs.dataDir
    : interactiveBootstrap
      ? resolveInputPath(await ask('Caminho dos dados do servidor', DEFAULT_DATA_INPUT))
      : globalArgs.dataDir;

  const identityCode = parseOption(args, '--identity') || (await ask('Código de identidade do dono (MONKY-ID:...)'));
  const identityPassword = await promptPassword('Senha da identidade: ');
  const nickname = parseOption(args, '--nickname') || (await ask('Nickname do dono', DEFAULT_OWNER_NICKNAME));
  const serverName = parseOption(args, '--name') || (await ask('Nome do servidor', DEFAULT_SERVER_NAME));
  const portValue = parseOption(args, '--port') || (await ask('Porta do servidor', String(DEFAULT_BOOTSTRAP_PORT)));
  const serverPassword = parseOption(args, '--password') ?? (await promptPassword('Senha do servidor (deixe vazio para sem senha): '));
  const port = parsePositiveInt('port', portValue);

  console.log();
  console.log(color('Resumo do bootstrap', ANSI.bold));
  console.log(`dataDir: ${dataDir}`);
  console.log(`nickname: ${nickname}`);
  console.log(`serverName: ${serverName}`);
  console.log(`port: ${port}`);
  console.log(`serverPassword: ${serverPassword ? 'definida' : 'sem senha'}`);
  console.log(`identity: ${identityCode.slice(0, Math.min(identityCode.length, 40))}${identityCode.length > 40 ? '...' : ''}`);

  const accepted = await confirm('Confirma?', true);
  if (!accepted) {
    console.log(color('Bootstrap cancelado.', ANSI.yellow));
    return;
  }

  await withContext(dataDir, async (ctx) => {
    await applyBootstrap(ctx, identityCode, identityPassword, nickname);
    await setConfig(ctx, 'name', serverName);
    await setConfig(ctx, 'password', serverPassword);
  });

  if (await confirm('Deseja iniciar o servidor agora?', true)) {
    await startServerCommand({ ...globalArgs, dataDir }, ['--port', String(port), '--name', serverName]);
  }
}

async function loadStoredServer(dataDir: string): Promise<Awaited<ReturnType<SqliteServerRepository['getServer']>>> {
  if (!fs.existsSync(dataDbPath(dataDir))) {
    return null;
  }
  return withContext(dataDir, async (ctx) => ctx.serverRepo.getServer(), false);
}

async function buildStartConfig(dataDir: string, args: string[]): Promise<ServerConfig> {
  const storedServer = await loadStoredServer(dataDir);
  const port = parseOption(args, '--port');
  const name = parseOption(args, '--name');
  const password = parseOption(args, '--password');
  const maxUsers = parseOption(args, '--max-users');
  const initialVoiceChannel = parseOption(args, '--voice-channel');
  const initialTextChannel = parseOption(args, '--text-channel');

  return {
    port: port ? parsePositiveInt('port', port) : LIMITS.DEFAULT_PORT,
    dataDir,
    serverName: name || storedServer?.name || DEFAULT_SERVER_NAME,
    password: storedServer ? '' : (password || ''),
    maxUsers: storedServer?.maxUsers || (maxUsers ? parsePositiveInt('max-users', maxUsers) : LIMITS.MAX_USERS_DEFAULT),
    initialVoiceChannel,
    initialTextChannel,
  };
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

async function removePidFile(pidPath: string): Promise<void> {
  if (fs.existsSync(pidPath)) {
    await fs.promises.rm(pidPath, { force: true });
  }
}

async function startServerCommand(globalArgs: GlobalArgs, args: string[]): Promise<void> {
  const dataDir = globalArgs.dataDir;
  await fs.promises.mkdir(dataDir, { recursive: true });

  const pidPath = dataPidPath(dataDir);
  if (fs.existsSync(pidPath)) {
    const raw = fs.readFileSync(pidPath, 'utf8').trim();
    const existingPid = Number.parseInt(raw, 10);
    if (Number.isInteger(existingPid) && isProcessRunning(existingPid)) {
      console.log(color(`O servidor já está em execução (PID ${existingPid}).`, ANSI.yellow));
      return;
    }
    await removePidFile(pidPath);
  }

  const config = await buildStartConfig(dataDir, args);
  const server = await MonkyServer.create(config);
  await fs.promises.writeFile(pidPath, String(process.pid), 'utf8');

  let stopping = false;
  const cleanup = async (signal?: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    try {
      if (signal) {
        console.log(color(`Recebido ${signal}. Encerrando servidor...`, ANSI.yellow));
      }
      await server.stop();
    } finally {
      await removePidFile(pidPath);
      process.exit(0);
    }
  };

  process.once('SIGINT', () => {
    void cleanup('SIGINT');
  });
  process.once('SIGTERM', () => {
    void cleanup('SIGTERM');
  });
  process.once('exit', () => {
    if (fs.existsSync(pidPath)) {
      fs.rmSync(pidPath, { force: true });
    }
  });

  console.log(color('Servidor Monky iniciando...', ANSI.green));
  console.log(`porta: ${config.port}`);
  console.log(`dataDir: ${config.dataDir}`);
  console.log(`serverName: ${config.serverName}`);
  console.log(color('Pressione Ctrl+C para encerrar.', ANSI.dim));

  await server.start();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopServerCommand(dataDir: string): Promise<void> {
  const pidPath = dataPidPath(dataDir);
  if (!fs.existsSync(pidPath)) {
    console.log(color('Nenhum servidor Monky em execução foi encontrado.', ANSI.yellow));
    return;
  }

  const raw = fs.readFileSync(pidPath, 'utf8').trim();
  const pid = Number.parseInt(raw, 10);
  if (!Number.isInteger(pid)) {
    await removePidFile(pidPath);
    console.log(color('Arquivo PID inválido removido. Nenhum servidor ativo encontrado.', ANSI.yellow));
    return;
  }

  if (!isProcessRunning(pid)) {
    await removePidFile(pidPath);
    console.log(color('O processo salvo no PID file não está mais em execução. Arquivo removido.', ANSI.yellow));
    return;
  }

  process.kill(pid, 'SIGTERM');

  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(250);
    if (!isProcessRunning(pid)) {
      await removePidFile(pidPath);
      console.log(color(`Servidor Monky parado com sucesso (PID ${pid}).`, ANSI.green));
      return;
    }
  }

  console.log(color(`Sinal SIGTERM enviado para o PID ${pid}. Aguarde alguns segundos.`, ANSI.green));
}

async function runDataCommand(
  globalArgs: GlobalArgs,
  fn: (dataDir: string) => Promise<void>
): Promise<void> {
  const dataDir = await ensureExistingDataDir(globalArgs.dataDir, globalArgs.dataDirSpecified);
  await fn(dataDir);
}

async function runCommand(globalArgs: GlobalArgs): Promise<void> {
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
