import http from 'http';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { LIMITS } from '@mini-voice/shared';
import { AuthService } from './application/services/AuthService';
import { ChannelService } from './application/services/ChannelService';
import { ChatService } from './application/services/ChatService';
import { SignalingService } from './application/services/SignalingService';
import { UserService } from './application/services/UserService';
import { DatabaseConnection } from './infrastructure/database/DatabaseConnection';
import {
  SqliteChannelRepository,
  SqliteMessageRepository,
  SqliteServerRepository,
  SqliteUserRepository,
} from './infrastructure/database/SqliteRepositories';
import { Logger } from './infrastructure/logger/Logger';
import { LanBroadcaster } from './infrastructure/discovery/LanBroadcaster';
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

export class MiniVoiceServer {
  private dbConn: DatabaseConnection;
  private httpServer: http.Server;
  private wsServer: WebSocketServer;
  private avatarStorage: AvatarStorageService;
  private rateLimiter: RateLimiter;
  private lanBroadcaster: LanBroadcaster;

  private constructor(
    private config: ServerConfig,
    dbConn: DatabaseConnection,
    httpServer: http.Server,
    wsServer: WebSocketServer,
    avatarStorage: AvatarStorageService,
    rateLimiter: RateLimiter,
    lanBroadcaster: LanBroadcaster
  ) {
    this.dbConn = dbConn;
    this.httpServer = httpServer;
    this.wsServer = wsServer;
    this.avatarStorage = avatarStorage;
    this.rateLimiter = rateLimiter;
    this.lanBroadcaster = lanBroadcaster;
  }

  public static async create(config: ServerConfig): Promise<MiniVoiceServer> {
    const dbPath = path.join(config.dataDir, 'server.db');
    const dbConn = await DatabaseConnection.create(dbPath);

    const avatarStorage = new AvatarStorageService(config.dataDir);
    const rateLimiter = new RateLimiter();

    const db = dbConn.getDb();
    const serverRepo = new SqliteServerRepository(db);
    const userRepo = new SqliteUserRepository(db);
    const channelRepo = new SqliteChannelRepository(db);
    const messageRepo = new SqliteMessageRepository(db);

    const signalingService = new SignalingService(channelRepo);
    const channelService = new ChannelService(channelRepo, serverRepo);
    const chatService = new ChatService(messageRepo, channelRepo, userRepo, avatarStorage, rateLimiter);

    let getOnlineUsers: () => any = () => new Map();

    const authService = new AuthService(
      serverRepo,
      userRepo,
      channelRepo,
      avatarStorage,
      () => getOnlineUsers()
    );

    const userService = new UserService(
      userRepo,
      avatarStorage,
      () => getOnlineUsers()
    );

    // Seed server and default channels if new database
    await MiniVoiceServer.seedServer(config, serverRepo, channelRepo);

    const httpServer = http.createServer((req, res) => {
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
                name: server?.name || config.serverName || 'Mini Voice Server',
                hasPassword: !!(server?.passwordHash && server.passwordHash.length > 0),
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
      serverRepo
    );

    getOnlineUsers = () => wsServer.getOnlineUsersMap();

    const lanBroadcaster = new LanBroadcaster({
      serverName: config.serverName || 'Mini Voice Server',
      serverPort: config.port,
      discoveryPort: config.discoveryPort,
    });

    return new MiniVoiceServer(config, dbConn, httpServer, wsServer, avatarStorage, rateLimiter, lanBroadcaster);
  }

  private static async seedServer(
    config: ServerConfig,
    serverRepo: SqliteServerRepository,
    channelRepo: SqliteChannelRepository
  ): Promise<void> {
    const server = await serverRepo.getServer();
    if (!server) {
      const serverId = uuidv4();
      const passwordHash = config.password ? PasswordService.hashPassword(config.password) : '';
      const now = Date.now();

      await serverRepo.createServer({
        id: serverId,
        name: config.serverName || 'Mini Voice Server',
        passwordHash,
        createdAt: now,
        maxUsers: config.maxUsers || LIMITS.MAX_USERS_DEFAULT,
        allowSoundboard: true,
      });

      // Create default text channel
      await channelRepo.create({
        id: uuidv4(),
        serverId,
        name: config.initialTextChannel || 'geral',
        type: 'TEXT',
        position: 0,
        createdAt: now,
        maxParticipants: 50,
      });

      // Create default voice channel
      await channelRepo.create({
        id: uuidv4(),
        serverId,
        name: config.initialVoiceChannel || 'Geral',
        type: 'VOICE',
        position: 1,
        createdAt: now,
        maxParticipants: LIMITS.MAX_PARTICIPANTS_PER_CHANNEL_DEFAULT,
      });

      Logger.info('DATABASE', `Server seeded successfully with default channels.`);
    }
  }

  public async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.config.port, '0.0.0.0', () => {
        Logger.info('INFO', `Mini Voice Server running on 0.0.0.0:${this.config.port}`);
        Logger.info('INFO', `Data directory: ${this.config.dataDir}`);
        this.lanBroadcaster
          .start()
          .catch((error) => Logger.warn('NETWORK', 'LAN discovery broadcast unavailable; continuing without it.', error))
          .finally(() => resolve());
      });
    });
  }

  public async stop(): Promise<void> {
    Logger.info('INFO', 'Stopping Mini Voice Server...');
    await this.lanBroadcaster.stop();
    this.rateLimiter.dispose();
    this.wsServer.close();
    await new Promise<void>((resolve) => this.httpServer.close(() => resolve()));
    this.dbConn.close();
    Logger.info('INFO', 'Server stopped.');
  }
}
