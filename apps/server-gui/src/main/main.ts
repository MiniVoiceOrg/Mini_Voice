import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { MonkyServer } from '@monky/server';
import { ADMIN_PERMISSIONS, DEFAULT_PERMISSIONS, LIMITS, type ChannelType } from '@monky/shared';
import { DatabaseConnection } from '@monky/server/dist/infrastructure/database/DatabaseConnection';
import {
  SqliteChannelRepository,
  SqliteRoleRepository,
  SqliteServerRepository,
  SqliteUserRepository,
} from '@monky/server/dist/infrastructure/database/SqliteRepositories';
import type { IDatabaseDriver } from '@monky/server/dist/infrastructure/database/SqliteWrapper';
import { Logger } from '@monky/server/dist/infrastructure/logger/Logger';
import { PasswordService } from '@monky/server/dist/infrastructure/security/PasswordService';

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

interface StoredConfig {
  serverName: string;
  port: number;
  maxUsers: number;
  dataDir: string;
  allowSoundboard: boolean;
}

interface GuiLogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  category: string;
  message: string;
}

interface GuiStats {
  members: number;
  channels: number;
  messages: number;
}

interface GuiStatus {
  running: boolean;
  startedAt: number | null;
  uptimeMs: number;
  serverName: string;
  port: number;
  connectedUsers: number;
  dataDir: string;
  diskUsageBytes: number;
  maxUsers: number;
  allowSoundboard: boolean;
  stats: GuiStats;
}

interface GuiChannel {
  id: string;
  serverId: string;
  name: string;
  type: ChannelType;
  position: number;
  createdAt: number;
  maxParticipants: number;
}

interface GuiConfig extends StoredConfig {
  hasPassword: boolean;
  channels: GuiChannel[];
}

interface GuiMember {
  id: string;
  nickname: string;
  clientId: string;
  roles: string[];
  lastSeenAt: number;
  online: boolean;
  isAdmin: boolean;
}

interface SetConfigInput extends StoredConfig {
  password?: string;
  clearPassword?: boolean;
}

interface DbContext {
  db: IDatabaseDriver;
  serverRepo: SqliteServerRepository;
  userRepo: SqliteUserRepository;
  channelRepo: SqliteChannelRepository;
  roleRepo: SqliteRoleRepository;
}

type RunningServer = {
  dbConn: DatabaseConnection;
  wsServer: {
    getOnlineUsersMap(): Map<string, { user: { id: string } }>;
    closeSessionsOfUser(userId: string): number;
  };
};

const WINDOW_BG = '#1a1a2e';
const DEFAULT_DATA_DIR_NAME = 'server-data';
const CONFIG_FILE_NAME = 'server-gui.config.json';
const LOG_LIMIT = 500;

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

class ServerGuiController {
  private server: MonkyServer | null = null;
  private startedAt: number | null = null;
  private logs: GuiLogEntry[] = [];

  constructor(private getWindow: () => BrowserWindow | null) {}

  public async getStatus(): Promise<GuiStatus> {
    const config = this.readStoredConfig();
    const snapshot = await this.readServerSnapshot(true);
    return {
      running: this.server !== null,
      startedAt: this.startedAt,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      serverName: snapshot.serverName ?? config.serverName,
      port: config.port,
      connectedUsers: this.getOnlineUserCount(),
      dataDir: config.dataDir,
      diskUsageBytes: await this.getDirectorySize(config.dataDir),
      maxUsers: snapshot.maxUsers ?? config.maxUsers,
      allowSoundboard: snapshot.allowSoundboard ?? config.allowSoundboard,
      stats: snapshot.stats,
    };
  }

  public async startServer(): Promise<GuiStatus> {
    if (this.server) {
      return this.getStatus();
    }

    const config = this.readStoredConfig();
    await this.withDbContext(true, undefined, async () => undefined);

    const server = await MonkyServer.create({
      port: config.port,
      dataDir: config.dataDir,
      serverName: config.serverName,
      maxUsers: config.maxUsers,
    });

    this.server = server;
    this.startedAt = Date.now();

    await server.start();
    this.pushLog('INFO', 'INFO', `Monky Server GUI started ${config.serverName} on port ${config.port}`);

    return this.getStatus();
  }

  public async stopServer(): Promise<GuiStatus> {
    if (!this.server) {
      return this.getStatus();
    }

    const activeServer = this.server;
    this.server = null;
    this.startedAt = null;
    await activeServer.stop();
    this.pushLog('INFO', 'INFO', 'Monky Server GUI stopped the hosted server');

    return this.getStatus();
  }

  public async getMembers(): Promise<GuiMember[]> {
    return this.withDbContext(true, undefined, async (ctx) => {
      const users = await ctx.userRepo.listAll();
      const roles = await ctx.roleRepo.listAll();
      const roleById = new Map(roles.map((role) => [role.id, role.name]));
      const adminRoleIds = new Set(roles.filter((role) => role.name.toLowerCase() === 'admin').map((role) => role.id));
      const userRoles = await ctx.roleRepo.listUserRoles();
      const userRoleMap = new Map<string, string[]>();

      for (const entry of userRoles) {
        const current = userRoleMap.get(entry.userId) ?? [];
        current.push(entry.roleId);
        userRoleMap.set(entry.userId, current);
      }

      const onlineIds = this.getOnlineUserIds();

      return users
        .map((user) => {
          const assignedRoleIds = userRoleMap.get(user.id) ?? [];
          const roleNames = assignedRoleIds
            .map((roleId) => roleById.get(roleId))
            .filter((name): name is string => Boolean(name));

          return {
            id: user.id,
            nickname: user.nickname,
            clientId: user.clientId,
            roles: roleNames,
            lastSeenAt: Number(user.lastSeenAt),
            online: onlineIds.has(user.id),
            isAdmin: assignedRoleIds.some((roleId) => adminRoleIds.has(roleId)),
          };
        })
        .sort((left, right) => {
          if (left.online !== right.online) {
            return left.online ? -1 : 1;
          }
          return left.nickname.localeCompare(right.nickname, 'pt-BR');
        });
    });
  }

  public async setMemberAdmin(userId: string, makeAdmin: boolean): Promise<GuiMember[]> {
    await this.withDbContext(true, undefined, async (ctx) => {
      const adminRole = await ctx.roleRepo.findByName('Admin');
      if (!adminRole) {
        throw new Error('Cargo Admin não encontrado.');
      }

      if (makeAdmin) {
        await ctx.roleRepo.assignRole(userId, adminRole.id);
      } else {
        await ctx.roleRepo.unassignRole(userId, adminRole.id);
      }
    });

    return this.getMembers();
  }

  public async kickMember(userId: string): Promise<GuiMember[]> {
    const running = this.server as unknown as RunningServer | null;
    if (!running) {
      throw new Error('O servidor precisa estar em execução para expulsar membros.');
    }

    const closed = running.wsServer.closeSessionsOfUser(userId);
    if (closed === 0) {
      throw new Error('Usuário não está online.');
    }

    this.pushLog(
      'WARN',
      'NETWORK',
      `User ${userId} was disconnected by the GUI host (${closed} session(s))`
    );
    return this.getMembers();
  }

  public async getConfig(): Promise<GuiConfig> {
    const stored = this.readStoredConfig();

    return this.withDbContext(true, undefined, async (ctx) => {
      const server = await ctx.serverRepo.getServer();
      const channels = server ? await ctx.channelRepo.listByServerId(server.id) : [];

      return {
        serverName: server?.name ?? stored.serverName,
        port: stored.port,
        maxUsers: server?.maxUsers ?? stored.maxUsers,
        dataDir: stored.dataDir,
        allowSoundboard: server?.allowSoundboard !== false,
        hasPassword: Boolean(server?.passwordHash),
        channels: channels.map((channel) => ({
          id: channel.id,
          serverId: channel.serverId,
          name: channel.name,
          type: channel.type,
          position: Number(channel.position),
          createdAt: Number(channel.createdAt),
          maxParticipants: Number(channel.maxParticipants),
        })),
      };
    });
  }

  public async setConfig(input: SetConfigInput): Promise<GuiConfig> {
    const current = this.readStoredConfig();
    if (this.server && input.dataDir !== current.dataDir) {
      throw new Error('Pare o servidor antes de alterar o diretório de dados.');
    }

    const next = this.normalizeConfig(input);
    this.writeStoredConfig(next);

    await this.withDbContext(
      true,
      input.clearPassword ? { clear: true } : input.password ? { set: input.password } : undefined,
      async () => undefined
    );

    return this.getConfig();
  }

  public async createChannel(input: { name: string; type: ChannelType }): Promise<GuiConfig> {
    const name = input.name.trim();
    if (name.length < 2) {
      throw new Error('O nome do canal precisa ter pelo menos 2 caracteres.');
    }

    await this.withDbContext(true, undefined, async (ctx) => {
      const server = await ctx.serverRepo.getServer();
      if (!server) {
        throw new Error('Servidor não encontrado.');
      }

      const channels = await ctx.channelRepo.listByServerId(server.id);
      await ctx.channelRepo.create({
        id: randomUUID(),
        serverId: server.id,
        name,
        type: input.type,
        position: channels.length,
        createdAt: Date.now(),
        maxParticipants: input.type === 'VOICE' ? LIMITS.MAX_PARTICIPANTS_PER_CHANNEL_DEFAULT : 50,
      });
    });

    return this.getConfig();
  }

  public async renameChannel(channelId: string, name: string): Promise<GuiConfig> {
    const nextName = name.trim();
    if (nextName.length < 2) {
      throw new Error('O nome do canal precisa ter pelo menos 2 caracteres.');
    }

    await this.withDbContext(true, undefined, async (ctx) => {
      ctx.db.prepare('UPDATE channels SET name = ? WHERE id = ?').run(nextName, channelId);
    });

    return this.getConfig();
  }

  public async deleteChannel(channelId: string): Promise<GuiConfig> {
    await this.withDbContext(true, undefined, async (ctx) => {
      await ctx.channelRepo.delete(channelId);
    });

    return this.getConfig();
  }

  public async getLogs(): Promise<GuiLogEntry[]> {
    return this.logs;
  }

  public async clearLogs(): Promise<void> {
    this.logs = [];
  }

  private readStoredConfig(): StoredConfig {
    const defaults: StoredConfig = {
      serverName: 'Monky Server',
      port: LIMITS.DEFAULT_PORT,
      maxUsers: LIMITS.MAX_USERS_DEFAULT,
      dataDir: path.join(app.getPath('userData'), DEFAULT_DATA_DIR_NAME),
      allowSoundboard: true,
    };

    const configPath = this.getConfigPath();
    if (!fs.existsSync(configPath)) {
      return defaults;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<StoredConfig>;
      return this.normalizeConfig({ ...defaults, ...parsed });
    } catch {
      return defaults;
    }
  }

  private writeStoredConfig(config: StoredConfig): void {
    const configPath = this.getConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  private getConfigPath(): string {
    return path.join(app.getPath('userData'), CONFIG_FILE_NAME);
  }

  private normalizeConfig(input: Partial<StoredConfig>): StoredConfig {
    const port = Number(input.port ?? LIMITS.DEFAULT_PORT);
    const maxUsers = Number(input.maxUsers ?? LIMITS.MAX_USERS_DEFAULT);
    const dataDir = String(input.dataDir ?? '').trim();

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('A porta deve estar entre 1 e 65535.');
    }

    if (!Number.isInteger(maxUsers) || maxUsers < 1 || maxUsers > 500) {
      throw new Error('O limite de usuários deve estar entre 1 e 500.');
    }

    if (!dataDir) {
      throw new Error('Informe um diretório de dados válido.');
    }

    return {
      serverName: String(input.serverName ?? 'Monky Server').trim() || 'Monky Server',
      port,
      maxUsers,
      dataDir: path.resolve(dataDir),
      allowSoundboard: input.allowSoundboard !== false,
    };
  }

  private async withDbContext<T>(
    ensureSeed: boolean,
    passwordUpdate: { set: string } | { clear: true } | undefined,
    run: (ctx: DbContext) => Promise<T>
  ): Promise<T> {
    if (this.server) {
      const ctx = this.createDbContext((this.server as unknown as RunningServer).dbConn.getDb());
      if (ensureSeed) {
        await this.ensureSeedData(ctx, this.readStoredConfig(), passwordUpdate);
      }
      return run(ctx);
    }

    const config = this.readStoredConfig();
    const connection = await DatabaseConnection.create(path.join(config.dataDir, 'server.db'));
    const ctx = this.createDbContext(connection.getDb());

    try {
      if (ensureSeed) {
        await this.ensureSeedData(ctx, config, passwordUpdate);
      }
      return await run(ctx);
    } finally {
      connection.close();
    }
  }

  private createDbContext(db: IDatabaseDriver): DbContext {
    return {
      db,
      serverRepo: new SqliteServerRepository(db),
      userRepo: new SqliteUserRepository(db),
      channelRepo: new SqliteChannelRepository(db),
      roleRepo: new SqliteRoleRepository(db),
    };
  }

  private async ensureSeedData(
    ctx: DbContext,
    config: StoredConfig,
    passwordUpdate: { set: string } | { clear: true } | undefined
  ): Promise<void> {
    const server = await ctx.serverRepo.getServer();
    const now = Date.now();

    if (!server) {
      const serverId = randomUUID();
      await ctx.serverRepo.createServer({
        id: serverId,
        name: config.serverName,
        passwordHash: '',
        createdAt: now,
        maxUsers: config.maxUsers,
        ownerUserId: null,
        allowSoundboard: config.allowSoundboard,
      });

      await ctx.channelRepo.create({
        id: randomUUID(),
        serverId,
        name: 'geral',
        type: 'TEXT',
        position: 0,
        createdAt: now,
        maxParticipants: 50,
      });

      await ctx.channelRepo.create({
        id: randomUUID(),
        serverId,
        name: 'Geral',
        type: 'VOICE',
        position: 1,
        createdAt: now,
        maxParticipants: LIMITS.MAX_PARTICIPANTS_PER_CHANNEL_DEFAULT,
      });
    }

    const adminRole = await ctx.roleRepo.findByName('Admin');
    if (!adminRole) {
      await ctx.roleRepo.create({
        id: randomUUID(),
        name: 'Admin',
        color: '#ed4245',
        position: 100,
        permissions: ADMIN_PERMISSIONS,
        isDefault: false,
        createdAt: now,
      });
    }

    const memberRole = await ctx.roleRepo.findByName('Membro');
    if (!memberRole) {
      await ctx.roleRepo.create({
        id: randomUUID(),
        name: 'Membro',
        color: '#5865f2',
        position: 0,
        permissions: DEFAULT_PERMISSIONS,
        isDefault: true,
        createdAt: now,
      });
    }

    const updates: {
      name?: string;
      maxUsers?: number;
      allowSoundboard?: boolean;
      passwordHash?: string;
    } = {
      name: config.serverName,
      maxUsers: config.maxUsers,
      allowSoundboard: config.allowSoundboard,
    };

    if (passwordUpdate && 'clear' in passwordUpdate) {
      updates.passwordHash = '';
    } else if (passwordUpdate && 'set' in passwordUpdate) {
      updates.passwordHash = PasswordService.hashPassword(passwordUpdate.set);
    }

    await ctx.serverRepo.updateServer(updates);
  }

  private async readServerSnapshot(ensureSeed: boolean): Promise<{
    serverName: string | null;
    maxUsers: number | null;
    allowSoundboard: boolean | null;
    stats: GuiStats;
  }> {
    return this.withDbContext(ensureSeed, undefined, async (ctx) => {
      const server = await ctx.serverRepo.getServer();
      const members = await ctx.userRepo.listAll();
      const channels = server ? await ctx.channelRepo.listByServerId(server.id) : [];
      const result = ctx.db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count?: number } | undefined;
      return {
        serverName: server?.name ?? null,
        maxUsers: server?.maxUsers ?? null,
        allowSoundboard: server ? server.allowSoundboard !== false : null,
        stats: {
          members: members.length,
          channels: channels.length,
          messages: Number(result?.count ?? 0),
        },
      };
    });
  }

  /**
   * People currently online. The websocket map is keyed by sessionId since
   * #309, so it is folded back to distinct user ids — the GUI reasons about
   * people, not devices.
   */
  private getOnlineUserIds(): Set<string> {
    const running = this.server as unknown as RunningServer | null;
    if (!running) {
      return new Set();
    }
    const ids = new Set<string>();
    for (const entry of running.wsServer.getOnlineUsersMap().values()) {
      ids.add(entry.user.id);
    }
    return ids;
  }

  private getOnlineUserCount(): number {
    return this.getOnlineUserIds().size;
  }

  private async getDirectorySize(targetPath: string): Promise<number> {
    try {
      const stat = await fs.promises.stat(targetPath);
      if (stat.isFile()) {
        return stat.size;
      }
      const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
      const sizes = await Promise.all(
        entries.map((entry) => this.getDirectorySize(path.join(targetPath, entry.name)))
      );
      return sizes.reduce((total, current) => total + current, 0);
    } catch {
      return 0;
    }
  }

  public pushLog(level: LogLevel, category: string, message: string): void {
    const entry: GuiLogEntry = {
      id: randomUUID(),
      timestamp: Date.now(),
      level,
      category,
      message,
    };

    this.logs = [...this.logs.slice(-(LOG_LIMIT - 1)), entry];
    this.getWindow()?.webContents.send('server-gui:log', entry);
  }
}

const controller = new ServerGuiController(() => mainWindow);

function hookLogger(): void {
  const originalLog = Logger.log.bind(Logger);
  const originalWarn = Logger.warn.bind(Logger);
  const originalError = Logger.error.bind(Logger);

  Logger.log = ((category, message, meta) => {
    originalLog(category, message, meta);
    controller.pushLog('INFO', category, meta ? `${message} | ${JSON.stringify(meta)}` : message);
  }) as typeof Logger.log;

  Logger.warn = ((category, message, meta) => {
    originalWarn(category, message, meta);
    controller.pushLog('WARN', category, meta ? `${message} | ${JSON.stringify(meta)}` : message);
  }) as typeof Logger.warn;

  Logger.error = ((category, message, error) => {
    originalError(category, message, error);
    const detail = error instanceof Error ? error.stack ?? error.message : error ? JSON.stringify(error) : '';
    controller.pushLog('ERROR', category, detail ? `${message} | ${detail}` : message);
  }) as typeof Logger.error;
}

function createWindow(): void {
  const iconPath = path.join(__dirname, '../../build/icon.ico');

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 900,
    minHeight: 620,
    frame: false,
    backgroundColor: WINDOW_BG,
    title: 'Monky Server GUI',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../../src/renderer/index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('server-gui:get-status', () => controller.getStatus());
  ipcMain.handle('server-gui:start-server', () => controller.startServer());
  ipcMain.handle('server-gui:stop-server', () => controller.stopServer());
  ipcMain.handle('server-gui:get-members', () => controller.getMembers());
  ipcMain.handle('server-gui:set-member-admin', (_event, payload: { userId: string; makeAdmin: boolean }) =>
    controller.setMemberAdmin(payload.userId, payload.makeAdmin)
  );
  ipcMain.handle('server-gui:kick-member', (_event, userId: string) => controller.kickMember(userId));
  ipcMain.handle('server-gui:get-config', () => controller.getConfig());
  ipcMain.handle('server-gui:set-config', (_event, config: SetConfigInput) => controller.setConfig(config));
  ipcMain.handle('server-gui:create-channel', (_event, input: { name: string; type: ChannelType }) =>
    controller.createChannel(input)
  );
  ipcMain.handle('server-gui:rename-channel', (_event, payload: { channelId: string; name: string }) =>
    controller.renameChannel(payload.channelId, payload.name)
  );
  ipcMain.handle('server-gui:delete-channel', (_event, channelId: string) => controller.deleteChannel(channelId));
  ipcMain.handle('server-gui:get-logs', () => controller.getLogs());
  ipcMain.handle('server-gui:clear-logs', () => controller.clearLogs());
  ipcMain.handle('server-gui:pick-data-directory', async () => {
    const targetWindow = mainWindow ?? BrowserWindow.getFocusedWindow() ?? undefined;
    const result = targetWindow
      ? await dialog.showOpenDialog(targetWindow, {
          properties: ['openDirectory', 'createDirectory'],
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
        });

    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('server-gui:minimize-window', () => mainWindow?.minimize());
  ipcMain.handle('server-gui:toggle-maximize-window', () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.handle('server-gui:close-window', () => {
    isQuitting = true;
    mainWindow?.close();
  });
}

async function shutdownServer(): Promise<void> {
  try {
    await controller.stopServer();
  } catch {
    // Ignore shutdown errors.
  }
}

hookLogger();

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', async (event) => {
  if (isQuitting) {
    return;
  }
  event.preventDefault();
  isQuitting = true;
  await shutdownServer();
  app.quit();
});

app.on('window-all-closed', async () => {
  await shutdownServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
