import { v4 as uuidv4 } from 'uuid';
import {
  AttachmentStorageInfo,
  AuthConnectPayload,
  LIMITS,
  ProtocolErrorCode,
  ServerDetails,
  UserSummary,
  authConnectSchema,
} from '@mini-voice/shared';
import { ServerRecord } from '../../domain/entities';
import { IChannelRepository, IMentionRepository, IServerRepository, IUserRepository } from '../../domain/repositories';
import { AvatarStorageService } from '../../infrastructure/security/AvatarStorageService';
import { PasswordService } from '../../infrastructure/security/PasswordService';
import { Logger } from '../../infrastructure/logger/Logger';
import { AttachmentService } from './AttachmentService';

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
    private mentionRepo: IMentionRepository,
    private avatarStorage: AvatarStorageService,
    private getActiveOnlineUsers: () => Map<string, { user: UserSummary }>,
    private attachmentService: AttachmentService
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

    // Build the full known-members list (everyone who ever connected) so offline
    // users can still be mentioned (#14). Online users keep their live summary;
    // offline users are marked DISCONNECTED.
    const allUsers = await this.userRepo.listAll();
    const knownMembers: UserSummary[] = allUsers.map((u) => {
      const online = onlineMap.get(u.id);
      if (online) return online.user;
      return {
        id: u.id,
        clientId: u.clientId,
        nickname: u.nickname,
        avatarUrl: this.avatarStorage.getPublicUrl(u.avatarPath),
        status: 'DISCONNECTED',
        joinedAt: u.lastSeenAt,
      };
    });
    if (!knownMembers.some((m) => m.id === userSummary.id)) {
      knownMembers.push(userSummary);
    }

    // Channels where this user has unread @-mentions, so the red @ badge shows
    // even for mentions received while they were offline (#14).
    const mentionedChannelIds = await this.mentionRepo.listChannelIdsForUser(userRecord.id);

    const serverDetails: ServerDetails = {
      id: server.id,
      name: server.name,
      createdAt: server.createdAt,
      maxUsers: server.maxUsers,
      hasPassword: !!(server.passwordHash && server.passwordHash.length > 0),
      allowSoundboard: server.allowSoundboard !== false,
      iconUrl: this.avatarStorage.getPublicUrl(server.iconPath),
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
      knownMembers,
      mentionedChannelIds,
      voiceStates: {},
      attachmentStorage: await this.attachmentService.getStorageInfo(),
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
    iconBase64?: string | null;
    maxAttachmentFileBytes?: number;
    maxAttachmentStorageBytes?: number;
  }): Promise<{
    success: boolean;
    name?: string;
    hasPassword?: boolean;
    allowSoundboard?: boolean;
    iconUrl?: string | null;
    attachmentStorage?: AttachmentStorageInfo;
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

    // Attachment storage limits (#11): validate positive and file <= total.
    if (payload.maxAttachmentFileBytes !== undefined || payload.maxAttachmentStorageBytes !== undefined) {
      const currentFile = server.maxAttachmentFileBytes ?? LIMITS.MAX_ATTACHMENT_FILE_SIZE_DEFAULT;
      const currentTotal = server.maxAttachmentStorageBytes ?? LIMITS.MAX_ATTACHMENT_STORAGE_TOTAL_DEFAULT;
      const nextFile = payload.maxAttachmentFileBytes ?? currentFile;
      const nextTotal = payload.maxAttachmentStorageBytes ?? currentTotal;
      if (!Number.isFinite(nextFile) || !Number.isFinite(nextTotal) || nextFile < 1 || nextTotal < 1) {
        return { success: false, errorMessage: 'Os limites de armazenamento devem ser positivos.' };
      }
      if (nextFile > nextTotal) {
        return { success: false, errorMessage: 'O limite por arquivo não pode exceder o total do servidor.' };
      }
      if (payload.maxAttachmentFileBytes !== undefined) updates.maxAttachmentFileBytes = Math.floor(nextFile);
      if (payload.maxAttachmentStorageBytes !== undefined) updates.maxAttachmentStorageBytes = Math.floor(nextTotal);
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

    if (payload.iconBase64 !== undefined) {
      if (!payload.iconBase64 || payload.iconBase64.trim() === '') {
        // Remove server icon
        if (server.iconPath) {
          this.avatarStorage.deleteAvatar(server.iconPath);
        }
        updates.iconPath = null;
      } else {
        // Save new server icon
        let rawBase64 = payload.iconBase64;
        if (payload.iconBase64.includes(',')) {
          rawBase64 = payload.iconBase64.split(',')[1];
        }
        const buffer = Buffer.from(rawBase64, 'base64');
        const validation = this.avatarStorage.validateAvatarBuffer(buffer);
        if (!validation.isValid || !validation.extension) {
          return {
            success: false,
            errorMessage: validation.error || 'Formato de imagem inválido para o ícone do servidor.',
          };
        }
        if (server.iconPath) {
          this.avatarStorage.deleteAvatar(server.iconPath);
        }
        const newFilename = await this.avatarStorage.saveAvatar(buffer, validation.extension);
        updates.iconPath = newFilename;
      }
    }

    await this.serverRepo.updateServer(updates);
    const updatedServer = await this.serverRepo.getServer();

    return {
      success: true,
      name: updatedServer?.name || server.name,
      hasPassword: !!(updatedServer?.passwordHash && updatedServer.passwordHash.length > 0),
      allowSoundboard: updatedServer?.allowSoundboard !== false,
      iconUrl: this.avatarStorage.getPublicUrl(updatedServer?.iconPath),
      attachmentStorage: await this.attachmentService.getStorageInfo(),
    };
  }
}
