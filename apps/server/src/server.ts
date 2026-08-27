import http from 'http';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ADMIN_PERMISSIONS, DEFAULT_PERMISSIONS, LIMITS, Permission, ProtocolErrorCode, stripAdministrator } from '@monky/shared';
import { AuthService } from './application/services/AuthService';
import { AttachmentService } from './application/services/AttachmentService';
import { ChannelService } from './application/services/ChannelService';
import { ChatService } from './application/services/ChatService';
import { PermissionService } from './application/services/PermissionService';
import { RoleService } from './application/services/RoleService';
import { SignalingService } from './application/services/SignalingService';
import { UserService } from './application/services/UserService';
import { DatabaseConnection } from './infrastructure/database/DatabaseConnection';
import {
  SqliteAttachmentRepository,
  SqliteChannelRepository,
  SqliteMentionRepository,
  SqliteMessageRepository,
  SqliteRoleRepository,
  SqliteServerRepository,
  SqliteUserRepository,
} from './infrastructure/database/SqliteRepositories';
import { Logger } from './infrastructure/logger/Logger';
import { LanBroadcaster } from './infrastructure/discovery/LanBroadcaster';
import { scanServerNetworkInterfaces } from './infrastructure/discovery/ServerIpScanner';
import { AttachmentStorageService } from './infrastructure/security/AttachmentStorageService';
import { AvatarStorageService } from './infrastructure/security/AvatarStorageService';
import { PasswordService } from './infrastructure/security/PasswordService';
import { RateLimiter } from './infrastructure/security/RateLimiter';
import { WebSocketServer } from './infrastructure/websocket/WebSocketServer';

export interface ServerConfig {
  port: number;
  dataDir: string;
  serverName?: string;
  discoveryPort?: number;
  password?: string;
  maxUsers?: number;
  initialVoiceChannel?: string;
  initialTextChannel?: string;
}

type ServerSeedConfig = Pick<
  ServerConfig,
  'serverName' | 'password' | 'maxUsers' | 'initialVoiceChannel' | 'initialTextChannel'
>;

export async function ensureServerSeedData(
  config: ServerSeedConfig,
  serverRepo: SqliteServerRepository,
  channelRepo: SqliteChannelRepository,
  roleRepo: SqliteRoleRepository
): Promise<void> {
  const server = await serverRepo.getServer();
  const now = Date.now();
  if (!server) {
    const serverId = uuidv4();
    const passwordHash = config.password ? PasswordService.hashPassword(config.password) : '';

    await serverRepo.createServer({
      id: serverId,
      name: config.serverName || 'Monky Server',
      passwordHash,
      createdAt: now,
      maxUsers: config.maxUsers || LIMITS.MAX_USERS_DEFAULT,
      ownerUserId: null,
      allowSoundboard: true,
    });

    await channelRepo.create({
      id: uuidv4(),
      serverId,
      name: config.initialTextChannel || 'geral',
      type: 'TEXT',
      position: 0,
      createdAt: now,
      maxParticipants: 50,
    });

    await channelRepo.create({
      id: uuidv4(),
      serverId,
      name: config.initialVoiceChannel || 'Geral',
      type: 'VOICE',
      position: 1,
      createdAt: now,
      maxParticipants: LIMITS.MAX_PARTICIPANTS_PER_CHANNEL_DEFAULT,
    });

    Logger.info('DATABASE', 'Server seeded successfully with default channels.');
  }

  const adminRole = await roleRepo.findByName('Admin');
  if (!adminRole) {
    await roleRepo.create({
      id: uuidv4(),
      name: 'Admin',
      color: '#ed4245',
      position: 100,
      permissions: ADMIN_PERMISSIONS,
      isDefault: false,
      createdAt: now,
    });
  }

  const memberRole = await roleRepo.findByName('Membro');
  if (!memberRole) {
    await roleRepo.create({
      id: uuidv4(),
      name: 'Membro',
      color: '#5865f2',
      position: 0,
      permissions: DEFAULT_PERMISSIONS,
      isDefault: true,
      createdAt: now,
    });
  }

  await migrateAdministratorRoles(roleRepo);
}

/**
 * The ADMINISTRATOR permission was dropped from the role editor: admin rights
 * now come only from the Admin role. Legacy roles lose the bit and every member
 * who held one is promoted to Admin so nobody loses access (#277).
 */
async function migrateAdministratorRoles(roleRepo: SqliteRoleRepository): Promise<void> {
  const adminRole = await roleRepo.findByName('Admin');
  if (!adminRole) return;

  const legacyRoles = (await roleRepo.listAll()).filter(
    (role) => role.id !== adminRole.id && (role.permissions & Permission.ADMINISTRATOR) !== 0
  );
  if (legacyRoles.length === 0) return;

  const legacyRoleIds = new Set(legacyRoles.map((role) => role.id));
  const userRoles = await roleRepo.listUserRoles();
  const usersToPromote = new Set(
    userRoles.filter((entry) => legacyRoleIds.has(entry.roleId)).map((entry) => entry.userId)
  );

  for (const role of legacyRoles) {
    await roleRepo.update(role.id, { permissions: stripAdministrator(role.permissions) });
  }
  for (const userId of usersToPromote) {
    await roleRepo.assignRole(userId, adminRole.id);
  }

  Logger.info(
    'DATABASE',
    `Removed the legacy ADMINISTRATOR permission from ${legacyRoles.length} role(s) and promoted ${usersToPromote.size} member(s) to Admin.`
  );
}

export class MonkyServer {
  private dbConn: DatabaseConnection;
  private httpServer: http.Server;
  private wsServer: WebSocketServer;
  private avatarStorage: AvatarStorageService;
  private rateLimiter: RateLimiter;
  private lanBroadcaster: LanBroadcaster;
  private attachmentService: AttachmentService;

  private constructor(
    private config: ServerConfig,
    dbConn: DatabaseConnection,
    httpServer: http.Server,
    wsServer: WebSocketServer,
    avatarStorage: AvatarStorageService,
    rateLimiter: RateLimiter,
    lanBroadcaster: LanBroadcaster,
    attachmentService: AttachmentService
  ) {
    this.dbConn = dbConn;
    this.httpServer = httpServer;
    this.wsServer = wsServer;
    this.avatarStorage = avatarStorage;
    this.rateLimiter = rateLimiter;
    this.lanBroadcaster = lanBroadcaster;
    this.attachmentService = attachmentService;
  }

  public static async create(config: ServerConfig): Promise<MonkyServer> {
    const dbPath = path.join(config.dataDir, 'server.db');
    const dbConn = await DatabaseConnection.create(dbPath);

    const avatarStorage = new AvatarStorageService(config.dataDir);
    const attachmentStorage = new AttachmentStorageService(config.dataDir);
    const rateLimiter = new RateLimiter();

    const db = dbConn.getDb();
    const serverRepo = new SqliteServerRepository(db);
    const userRepo = new SqliteUserRepository(db);
    const channelRepo = new SqliteChannelRepository(db);
    const messageRepo = new SqliteMessageRepository(db);
    const mentionRepo = new SqliteMentionRepository(db);
    const attachmentRepo = new SqliteAttachmentRepository(db);
    const roleRepo = new SqliteRoleRepository(db);

    const attachmentService = new AttachmentService(attachmentRepo, serverRepo, attachmentStorage, rateLimiter);
    const permissionService = new PermissionService(serverRepo, roleRepo);
    const roleService = new RoleService(roleRepo, userRepo, permissionService);

    const signalingService = new SignalingService(channelRepo);
    const channelService = new ChannelService(channelRepo, serverRepo);
    const chatService = new ChatService(
      messageRepo,
      channelRepo,
      userRepo,
      mentionRepo,
      avatarStorage,
      rateLimiter,
      attachmentService
    );

    let getOnlineUsers: () => any = () => new Map();

    const authService = new AuthService(
      serverRepo,
      userRepo,
      channelRepo,
      mentionRepo,
      avatarStorage,
      () => getOnlineUsers(),
      attachmentService,
      permissionService,
      roleService
    );

    const userService = new UserService(
      userRepo,
      avatarStorage,
      () => getOnlineUsers()
    );

    // Seed server and default channels if new database
    await ensureServerSeedData(config, serverRepo, channelRepo, roleRepo);

    const httpServer = http.createServer((req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-File-Name',
          'Access-Control-Max-Age': '86400',
        });
        res.end();
        return;
      }
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', time: Date.now() }));
        return;
      }
      if (req.url === '/preview') {
        const online = getOnlineUsers() as Map<string, { user: { nickname: string; avatarUrl?: string | null } }>;
        const users = Array.from(online.values())
          .slice(0, 10)
          .map((entry) => ({
            nickname: entry.user.nickname,
            avatarUrl: entry.user.avatarUrl || null,
          }));
        serverRepo
          .getServer()
          .then((server) => {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            });
            res.end(
              JSON.stringify({
                name: server?.name || config.serverName || 'Monky Server',
                hasPassword: !!(server?.passwordHash && server.passwordHash.length > 0),
                iconUrl: avatarStorage.getPublicUrl(server?.iconPath),
                userCount: online.size,
                maxUsers: server?.maxUsers || LIMITS.MAX_USERS_DEFAULT,
                users,
              })
            );
          })
          .catch(() => {
            res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
            res.end();
          });
        return;
      }
      if (req.url === '/invite-info') {
        serverRepo
          .getServer()
          .then(async (server) => {
            const addr = httpServer.address();
            const port = addr && typeof addr === 'object' ? addr.port : config.port || LIMITS.DEFAULT_PORT;
            const networkInterfaces = await scanServerNetworkInterfaces();

            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            });
            res.end(
              JSON.stringify({
                port,
                serverName: server?.name || config.serverName || 'Monky Server',
                networkInterfaces,
              })
            );
          })
          .catch((err) => {
            res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: 'Erro ao obter dados de convite' }));
          });
        return;
      }
      if (req.url && req.url.startsWith('/avatars/')) {
        const requested = decodeURIComponent(req.url.slice('/avatars/'.length).split('?')[0]);
        const avatar = avatarStorage.getAvatarFile(requested);
        if (!avatar) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': avatar.mimeType,
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
        });
        fs.createReadStream(avatar.filePath).pipe(res);
        return;
      }
      if (req.url && req.url.split('?')[0] === '/attachments' && req.method === 'POST') {
        void MonkyServer.handleAttachmentUpload(req, res, attachmentService, attachmentStorage);
        return;
      }
      if (req.url && req.url.startsWith('/attachments/') && (req.method === 'GET' || req.method === 'HEAD')) {
        MonkyServer.handleAttachmentDownload(req, res, attachmentStorage);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const wsServer = new WebSocketServer(
      httpServer,
      authService,
      userService,
      channelService,
      chatService,
      signalingService,
      serverRepo,
      attachmentService,
      permissionService,
      roleService
    );

    getOnlineUsers = () => wsServer.getOnlineUsersMap();

    const lanBroadcaster = new LanBroadcaster({
      serverName: config.serverName || 'Monky Server',
      serverPort: config.port,
      discoveryPort: config.discoveryPort,
    });

    return new MonkyServer(config, dbConn, httpServer, wsServer, avatarStorage, rateLimiter, lanBroadcaster, attachmentService);
  }

  private static async handleAttachmentUpload(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    attachmentService: AttachmentService,
    attachmentStorage: AttachmentStorageService
  ): Promise<void> {
    const send = (status: number, obj: unknown) => {
      if (res.headersSent) return;
      res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(obj));
    };

    try {
      const url = new URL(req.url || '', 'http://localhost');
      const token = url.searchParams.get('token');
      const binding = attachmentService.consumeUploadToken(token);
      if (!binding) {
        send(401, { error: 'unauthorized' });
        return;
      }

      const originalName = (url.searchParams.get('name') || 'arquivo').slice(0, 255);
      const maxFileBytes = await attachmentService.getMaxFileBytes();

      const declaredLen = Number(req.headers['content-length'] || 0);
      if (declaredLen && declaredLen > maxFileBytes) {
        send(413, { error: ProtocolErrorCode.ATTACHMENT_TOO_LARGE });
        return;
      }

      const tempPath = attachmentStorage.createTempPath();
      const out = fs.createWriteStream(tempPath);
      let received = 0;
      let aborted = false;

      const abort = (status: number, obj: unknown) => {
        if (aborted) return;
        aborted = true;
        out.destroy();
        attachmentStorage.discardTemp(tempPath);
        send(status, obj);
        try {
          req.destroy();
        } catch {
          /* ignore */
        }
      };

      req.on('data', (chunk: Buffer) => {
        if (aborted) return;
        received += chunk.length;
        if (received > maxFileBytes) {
          abort(413, { error: ProtocolErrorCode.ATTACHMENT_TOO_LARGE });
          return;
        }
        if (!out.write(chunk)) {
          req.pause();
          out.once('drain', () => req.resume());
        }
      });

      req.on('error', () => abort(400, { error: ProtocolErrorCode.BAD_REQUEST }));

      req.on('end', () => {
        if (aborted) return;
        out.end(() => {
          void attachmentService
            .finalizeUpload({ tempPath, sizeBytes: received, userId: binding.userId, channelId: binding.channelId, originalName })
            .then((result) => {
              if (!result.success || !result.meta) {
                const status =
                  result.errorCode === ProtocolErrorCode.ATTACHMENT_TOO_LARGE
                    ? 413
                    : result.errorCode === ProtocolErrorCode.STORAGE_FULL
                      ? 507
                      : 400;
                send(status, { error: result.errorCode, message: result.errorMessage });
                return;
              }
              send(200, result.meta);
            })
            .catch(() => send(500, { error: ProtocolErrorCode.INTERNAL_ERROR }));
        });
      });
    } catch {
      send(500, { error: ProtocolErrorCode.INTERNAL_ERROR });
    }
  }

  private static handleAttachmentDownload(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    attachmentStorage: AttachmentStorageService
  ): void {
    const requested = decodeURIComponent((req.url || '').slice('/attachments/'.length).split('?')[0]);
    const file = attachmentStorage.getFile(requested);
    if (!file) {
      res.writeHead(404);
      res.end();
      return;
    }

    const { filePath, size, mimeType } = file;
    const previewable = mimeType.startsWith('image/') || mimeType.startsWith('video/');
    const headers: Record<string, string> = {
      'Content-Type': mimeType,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
    };
    // Force download for anything that is not a validated image/video so the host
    // never serves runnable HTML/SVG/JS inline (#11).
    if (!previewable) headers['Content-Disposition'] = 'attachment';

    const rangeHeader = req.headers['range'];
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
      if (match) {
        let start = match[1] ? parseInt(match[1], 10) : 0;
        let end = match[2] ? parseInt(match[2], 10) : size - 1;
        if (Number.isNaN(start)) start = 0;
        if (Number.isNaN(end) || end >= size) end = size - 1;
        if (start > end || start >= size) {
          res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Access-Control-Allow-Origin': '*' });
          res.end();
          return;
        }
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        fs.createReadStream(filePath, { start, end }).pipe(res);
        return;
      }
    }

    res.writeHead(200, { ...headers, 'Content-Length': String(size) });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  }

  public async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.config.port, '0.0.0.0', () => {
        Logger.info('INFO', `Monky Server running on 0.0.0.0:${this.config.port}`);
        Logger.info('INFO', `Data directory: ${this.config.dataDir}`);
        void this.attachmentService.reconcile();
        this.lanBroadcaster
          .start()
          .catch((error) => Logger.warn('NETWORK', 'LAN discovery broadcast unavailable; continuing without it.', error))
          .finally(() => resolve());
      });
    });
  }

  public async stop(): Promise<void> {
    Logger.info('INFO', 'Stopping Monky Server...');
    await this.lanBroadcaster.stop();
    this.rateLimiter.dispose();
    this.wsServer.close();
    await new Promise<void>((resolve) => this.httpServer.close(() => resolve()));
    this.dbConn.close();
    Logger.info('INFO', 'Server stopped.');
  }
}
