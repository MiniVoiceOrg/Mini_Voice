import { v4 as uuidv4 } from 'uuid';
import {
  AuthConnectPayload,
  LIMITS,
  ProtocolErrorCode,
  ServerDetails,
  UserSummary,
  authConnectSchema,
} from '@mini-voice/shared';
import { ServerRecord } from '../../domain/entities';
import { IChannelRepository, IServerRepository, IUserRepository } from '../../domain/repositories';
import { AvatarStorageService } from '../../infrastructure/security/AvatarStorageService';
import { PasswordService } from '../../infrastructure/security/PasswordService';
import { Logger } from '../../infrastructure/logger/Logger';

export interface AuthResult {
  success: boolean;
  errorCode?: ProtocolErrorCode;
  errorMessage?: string;
  user?: UserSummary;
  serverDetails?: ServerDetails;
}

export class AuthService {
  constructor(
    private serverRepo: IServerRepository,
    private userRepo: IUserRepository,
    private channelRepo: IChannelRepository,
    private avatarStorage: AvatarStorageService,
    private getActiveOnlineUsers: () => Map<string, { user: UserSummary }>
  ) {}

  public async authenticate(payload: AuthConnectPayload): Promise<AuthResult> {
    const parseResult = authConnectSchema.safeParse(payload);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]?.message || 'Dados de conexão inválidos';
      return {
        success: false,
        errorCode: ProtocolErrorCode.BAD_REQUEST,
        errorMessage: firstError,
      };
    }

    const { clientId, nickname, password } = parseResult.data;

    const server = await this.serverRepo.getServer();
    if (!server) {
      return {
        success: false,
        errorCode: ProtocolErrorCode.INTERNAL_ERROR,
        errorMessage: 'Servidor não inicializado',
      };
    }

    // Verify Password
    if (server.passwordHash && server.passwordHash.length > 0) {
      const isValid = PasswordService.verifyPassword(password || '', server.passwordHash);
      if (!isValid) {
        Logger.security(`Failed authentication attempt for nickname: ${nickname}`);
        return {
          success: false,
          errorCode: ProtocolErrorCode.AUTH_INVALID_PASSWORD,
          errorMessage: 'Senha do servidor incorreta.',
        };
      }
    }

    // Check online users limit
    const onlineMap = this.getActiveOnlineUsers();
    if (onlineMap.size >= server.maxUsers) {
      return {
        success: false,
        errorCode: ProtocolErrorCode.SERVER_FULL,
        errorMessage: `O servidor atingiu a capacidade máxima (${server.maxUsers} usuários).`,
      };
    }

    // Check unique nickname among currently online users
    const trimmedNick = nickname.trim();
    for (const [_, session] of onlineMap.entries()) {
      if (
        session.user.nickname.toLowerCase() === trimmedNick.toLowerCase() &&
        session.user.clientId !== clientId
      ) {
        return {
          success: false,
          errorCode: ProtocolErrorCode.NICKNAME_ALREADY_EXISTS,
          errorMessage: 'Este nickname já está sendo utilizado por outro usuário no momento.',
        };
      }
    }

    // Find or create user by clientId
    let userRecord = await this.userRepo.findByClientId(clientId);
    const now = Date.now();

    if (!userRecord) {
      userRecord = {
        id: uuidv4(),
        clientId,
        nickname: trimmedNick,
        avatarPath: null,
        createdAt: now,
        lastSeenAt: now,
      };
      await this.userRepo.create(userRecord);
    } else {
      // Update nickname and lastSeenAt
      await this.userRepo.update(userRecord.id, {
        nickname: trimmedNick,
        lastSeenAt: now,
      });
      userRecord.nickname = trimmedNick;
      userRecord.lastSeenAt = now;
    }

    const userSummary: UserSummary = {
      id: userRecord.id,
      clientId: userRecord.clientId,
      nickname: userRecord.nickname,
      avatarUrl: this.avatarStorage.getPublicUrl(userRecord.avatarPath),
      status: 'ONLINE',
      joinedAt: now,
    };

    // Load server details for client state
    const channels = await this.channelRepo.listByServerId(server.id);

    // Build active members list (including this new user)
    const members: UserSummary[] = Array.from(onlineMap.values()).map((s) => s.user);
    if (!members.some((m) => m.id === userSummary.id)) {
      members.push(userSummary);
    }

    const serverDetails: ServerDetails = {
      id: server.id,
      name: server.name,
      createdAt: server.createdAt,
      maxUsers: server.maxUsers,
      hasPassword: !!(server.passwordHash && server.passwordHash.length > 0),
      allowSoundboard: server.allowSoundboard !== false,
      channels: channels.map((c) => ({
        id: c.id,
        serverId: c.serverId,
        name: c.name,
        type: c.type,
        position: c.position,
        createdAt: c.createdAt,
        maxParticipants: c.maxParticipants,
      })),
      members,
      voiceStates: {},
    };

    return {
      success: true,
      user: userSummary,
      serverDetails,
    };
  }

  public async updateServerSettings(payload: {
    name?: string;
    password?: string | null;
    allowSoundboard?: boolean;
  }): Promise<{
    success: boolean;
    name?: string;
    hasPassword?: boolean;
    allowSoundboard?: boolean;
    errorMessage?: string;
  }> {
    const server = await this.serverRepo.getServer();
    if (!server) {
      return { success: false, errorMessage: 'Servidor não encontrado' };
    }

    const updates: Partial<ServerRecord> = {};

    if (payload.name && payload.name.trim().length >= 2) {
      updates.name = payload.name.trim();
    }

    if (payload.password !== undefined) {
      if (payload.password === null || payload.password === '') {
        updates.passwordHash = '';
      } else {
        updates.passwordHash = PasswordService.hashPassword(payload.password);
      }
    }

    if (payload.allowSoundboard !== undefined) {
      updates.allowSoundboard = Boolean(payload.allowSoundboard);
    }

    await this.serverRepo.updateServer(updates);
    const updatedServer = await this.serverRepo.getServer();

    return {
      success: true,
      name: updatedServer?.name || server.name,
      hasPassword: !!(updatedServer?.passwordHash && updatedServer.passwordHash.length > 0),
      allowSoundboard: updatedServer?.allowSoundboard !== false,
    };
  }
}
