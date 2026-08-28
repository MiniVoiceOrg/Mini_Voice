import { createPublicKey, randomBytes, verify } from 'crypto';
import type { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import {
  AttachmentStorageInfo,
  AuthConnectPayload,
  LIMITS,
  PROTOCOL_VERSION,
  ProtocolErrorCode,
  ServerDetails,
  UserSummary,
  authChallengeResponseSchema,
  authConnectSchema,
  canAccessChannel,
  deriveClientIdFromPublicKey,
  normalizePublicKeyHex,
} from '@monky/shared';
import { ServerRecord, UserRecord } from '../../domain/entities';
import { IChannelRepository, IMentionRepository, IServerRepository, IUserRepository } from '../../domain/repositories';
import { AvatarStorageService } from '../../infrastructure/security/AvatarStorageService';
import { PasswordService } from '../../infrastructure/security/PasswordService';
import { Logger } from '../../infrastructure/logger/Logger';
import { AttachmentService } from './AttachmentService';
import { PermissionService } from './PermissionService';
import { RoleService } from './RoleService';

export interface AuthResult {
  success: boolean;
  errorCode?: ProtocolErrorCode;
  errorMessage?: string;
  authFailed?: boolean;
  user?: UserSummary;
  serverDetails?: ServerDetails;
}

interface PendingAuthChallenge {
  publicKey: string;
  clientId: string;
  nickname: string;
  password: string;
  nonce: string;
  /** Which installation is connecting, so two devices of the same person coexist (#309). */
  deviceId: string;
}

export class AuthService {
  private pendingChallenges = new Map<WebSocket, PendingAuthChallenge>();

  constructor(
    private serverRepo: IServerRepository,
    private userRepo: IUserRepository,
    private channelRepo: IChannelRepository,
    private mentionRepo: IMentionRepository,
    private avatarStorage: AvatarStorageService,
    private getActiveOnlineUsers: () => Map<string, { user: UserSummary }>,
    private attachmentService: AttachmentService,
    private permissionService: PermissionService,
    private roleService: RoleService
  ) {}

  public async createChallenge(
    ws: WebSocket,
    payload: AuthConnectPayload
  ): Promise<{
    success: boolean;
    nonce?: string;
    errorCode?: ProtocolErrorCode;
    errorMessage?: string;
    serverProtocolVersion?: number;
  }> {
    // Checked before the schema so a version mismatch reports itself as such.
    // The schema would flatten it into a generic BAD_REQUEST, and the client
    // then showed "invalid request" for what is really "one of you is outdated"
    // (#355).
    if (payload?.protocolVersion !== PROTOCOL_VERSION) {
      return {
        success: false,
        errorCode: ProtocolErrorCode.PROTOCOL_VERSION_UNSUPPORTED,
        errorMessage: `Versão de protocolo incompatível. Este servidor usa a versão ${PROTOCOL_VERSION}.`,
        serverProtocolVersion: PROTOCOL_VERSION,
      };
    }

    const parseResult = authConnectSchema.safeParse(payload);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]?.message || 'Dados de conexão inválidos';
      return {
        success: false,
        errorCode: ProtocolErrorCode.BAD_REQUEST,
        errorMessage: firstError,
      };
    }

    const publicKey = normalizePublicKeyHex(parseResult.data.publicKey);
    try {
      this.getNodePublicKey(publicKey);
    } catch {
      return {
        success: false,
        errorCode: ProtocolErrorCode.BAD_REQUEST,
        errorMessage: 'Chave pública inválida',
      };
    }

    const server = await this.serverRepo.getServer();
    if (!server) {
      return {
        success: false,
        errorCode: ProtocolErrorCode.INTERNAL_ERROR,
        errorMessage: 'Servidor não inicializado',
      };
    }

    if (server.passwordHash && server.passwordHash.length > 0) {
      const isValid = PasswordService.verifyPassword(parseResult.data.password || '', server.passwordHash);
      if (!isValid) {
        Logger.security(`Failed authentication attempt for nickname: ${parseResult.data.nickname}`);
        return {
          success: false,
          errorCode: ProtocolErrorCode.AUTH_INVALID_PASSWORD,
          errorMessage: 'Senha do servidor incorreta.',
        };
      }
    }

    const nonce = randomBytes(32).toString('hex');
    this.pendingChallenges.set(ws, {
      publicKey,
      clientId: deriveClientIdFromPublicKey(publicKey),
      nickname: parseResult.data.nickname.trim(),
      password: parseResult.data.password || '',
      nonce,
      // Clients that predate #309 send nothing; give them a random id so each of
      // their connections is still a distinct session.
      deviceId: parseResult.data.deviceId || randomBytes(16).toString('hex'),
    });

    return {
      success: true,
      nonce,
    };
  }

  public async verifyChallengeResponse(ws: WebSocket, signature: string): Promise<AuthResult> {
    const pending = this.pendingChallenges.get(ws);
    if (!pending) {
      return {
        success: false,
        authFailed: true,
        errorCode: ProtocolErrorCode.UNAUTHORIZED,
        errorMessage: 'Desafio de autenticação não encontrado ou expirado.',
      };
    }

    const parseResult = authChallengeResponseSchema.safeParse({ signature });
    if (!parseResult.success) {
      this.pendingChallenges.delete(ws);
      return {
        success: false,
        errorCode: ProtocolErrorCode.BAD_REQUEST,
        errorMessage: parseResult.error.errors[0]?.message || 'Assinatura inválida',
      };
    }

    const normalizedSignature = parseResult.data.signature.toLowerCase();

    let isValidSignature = false;
    try {
      isValidSignature = verify(
        null,
        Buffer.from(pending.nonce, 'hex'),
        this.getNodePublicKey(pending.publicKey),
        Buffer.from(normalizedSignature, 'hex')
      );
    } catch {
      isValidSignature = false;
    }

    if (!isValidSignature) {
      this.pendingChallenges.delete(ws);
      return {
        success: false,
        authFailed: true,
        errorCode: ProtocolErrorCode.UNAUTHORIZED,
        errorMessage: 'Falha ao validar a assinatura do desafio.',
      };
    }

    this.pendingChallenges.delete(ws);
    return await this.finishAuthentication(pending);
  }

  public clearChallenge(ws: WebSocket): void {
    this.pendingChallenges.delete(ws);
  }

  private async finishAuthentication(pending: PendingAuthChallenge): Promise<AuthResult> {
    const server = await this.serverRepo.getServer();
    if (!server) {
      return {
        success: false,
        errorCode: ProtocolErrorCode.INTERNAL_ERROR,
        errorMessage: 'Servidor não inicializado',
      };
    }

    const onlineMap = this.getActiveOnlineUsers();
    // Capacity counts people, not connections: a second device of someone who is
    // already here must not eat another slot (#309).
    const distinctUserIds = new Set<string>();
    let sameIdentityOnline = false;
    let otherDevicesOfIdentity = 0;
    for (const session of onlineMap.values()) {
      distinctUserIds.add(session.user.id);
      if (session.user.clientId !== pending.clientId) continue;
      sameIdentityOnline = true;
      // A reconnect from the same device replaces its own session instead of
      // adding one, so it must not count towards the device cap.
      if (session.user.sessionId !== `${session.user.id}:${pending.deviceId}`) {
        otherDevicesOfIdentity++;
      }
    }
    if (!sameIdentityOnline && distinctUserIds.size >= server.maxUsers) {
      return {
        success: false,
        errorCode: ProtocolErrorCode.SERVER_FULL,
        errorMessage: `O servidor atingiu a capacidade máxima (${server.maxUsers} usuários).`,
      };
    }
    // Waiving the capacity check for an already-online identity would otherwise
    // let one person open unlimited connections, so cap their devices (#309).
    if (otherDevicesOfIdentity >= LIMITS.MAX_SESSIONS_PER_USER) {
      return {
        success: false,
        errorCode: ProtocolErrorCode.SERVER_FULL,
        errorMessage: `Você já está conectado em ${LIMITS.MAX_SESSIONS_PER_USER} dispositivos. Desconecte um deles para entrar deste.`,
      };
    }

    const trimmedNick = pending.nickname.trim();
    for (const session of onlineMap.values()) {
      if (
        session.user.nickname.toLowerCase() === trimmedNick.toLowerCase() &&
        session.user.clientId !== pending.clientId
      ) {
        return {
          success: false,
          errorCode: ProtocolErrorCode.NICKNAME_ALREADY_EXISTS,
          errorMessage: 'Este nickname já está sendo utilizado por outro usuário no momento.',
        };
      }
    }

    let userRecord = await this.userRepo.findByPublicKey(pending.publicKey);
    if (!userRecord) {
      userRecord = await this.userRepo.findByClientId(pending.clientId);
    }

    const now = Date.now();
    if (!userRecord) {
      userRecord = {
        id: uuidv4(),
        clientId: pending.clientId,
        publicKey: pending.publicKey,
        nickname: trimmedNick,
        avatarPath: null,
        createdAt: now,
        lastSeenAt: now,
      };
      await this.userRepo.create(userRecord);
    } else {
      await this.userRepo.update(userRecord.id, {
        nickname: trimmedNick,
        publicKey: pending.publicKey,
        lastSeenAt: now,
      });
      userRecord.nickname = trimmedNick;
      userRecord.publicKey = pending.publicKey;
      userRecord.lastSeenAt = now;
    }

    await this.roleService.ensureDefaultRolesAssigned(userRecord.id);

    if (!server.ownerUserId) {
      await this.serverRepo.updateServer({ ownerUserId: userRecord.id });
      await this.roleService.assignAdminRole(userRecord.id);
      server.ownerUserId = userRecord.id;
    }

    const userSummary = this.toUserSummary(userRecord, 'ONLINE', now, {
      sessionId: `${userRecord.id}:${pending.deviceId}`,
      connectedAt: now,
    });

    const channels = await this.channelRepo.listByServerId(server.id);
    // One entry per live connection, so the other devices of this person are
    // visible to the newcomer (#309).
    const members: UserSummary[] = Array.from(onlineMap.values()).map((s) => s.user);
    if (!members.some((m) => m.sessionId === userSummary.sessionId)) {
      members.push(userSummary);
    }

    const allUsers = await this.userRepo.listAll();
    // The known-members list describes people, so collapse a user's sessions to
    // a single (online) record.
    const onlineByUserId = new Map<string, UserSummary>();
    for (const session of onlineMap.values()) {
      if (!onlineByUserId.has(session.user.id)) onlineByUserId.set(session.user.id, session.user);
    }
    const knownMembers: UserSummary[] = allUsers.map((user) => {
      const online = onlineByUserId.get(user.id);
      return online ?? this.toUserSummary(user, 'DISCONNECTED', user.lastSeenAt);
    });
    if (!knownMembers.some((m) => m.id === userSummary.id)) {
      knownMembers.push(userSummary);
    }

    const mentionedChannelIds = await this.mentionRepo.listChannelIdsForUser(userRecord.id);
    const roleState = await this.roleService.getRoleState();
    const myPermissions = await this.permissionService.getUserPermissions(userRecord.id);
    // Private channels are filtered out here rather than on the client, so a
    // channel the member cannot access never reaches them — not even its name (#384).
    const myRoleIds = roleState.userRoles.find((ur) => ur.userId === userRecord.id)?.roleIds ?? [];
    const visibleChannels = channels.filter((c) => canAccessChannel(c, myPermissions, myRoleIds));

    const serverDetails: ServerDetails = {
      id: server.id,
      name: server.name,
      createdAt: server.createdAt,
      maxUsers: server.maxUsers,
      hasPassword: !!(server.passwordHash && server.passwordHash.length > 0),
      allowSoundboard: server.allowSoundboard !== false,
      iconUrl: this.avatarStorage.getPublicUrl(server.iconPath),
      channels: visibleChannels.map((c) => ({
        id: c.id,
        serverId: c.serverId,
        name: c.name,
        type: c.type,
        position: c.position,
        createdAt: c.createdAt,
        maxParticipants: c.maxParticipants,
        isPrivate: c.isPrivate,
        allowedRoleIds: c.allowedRoleIds,
      })),
      members,
      knownMembers,
      mentionedChannelIds,
      voiceStates: {},
      roles: roleState.roles,
      userRoles: roleState.userRoles,
      ownerId: server.ownerUserId ?? null,
      myPermissions,
      attachmentStorage: await this.attachmentService.getStorageInfo(),
    };

    return {
      success: true,
      user: userSummary,
      serverDetails,
    };
  }

  private toUserSummary(
    user: UserRecord,
    status: UserSummary['status'],
    joinedAt: number,
    session?: { sessionId: string; connectedAt: number }
  ): UserSummary {
    return {
      id: user.id,
      clientId: user.clientId,
      nickname: user.nickname,
      avatarUrl: this.avatarStorage.getPublicUrl(user.avatarPath),
      status,
      joinedAt,
      sessionId: session?.sessionId,
      connectedAt: session?.connectedAt,
    };
  }

  private getNodePublicKey(publicKeyHex: string) {
    return createPublicKey({
      key: Buffer.from(publicKeyHex, 'hex'),
      format: 'der',
      type: 'spki',
    });
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
        if (server.iconPath) {
          this.avatarStorage.deleteAvatar(server.iconPath);
        }
        updates.iconPath = null;
      } else {
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
