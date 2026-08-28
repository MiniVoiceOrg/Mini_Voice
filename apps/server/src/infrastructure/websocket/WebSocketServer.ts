import http from 'http';
import { WebSocket, WebSocketServer as WSServer } from 'ws';
import {
  AdminDeafenUserPayload,
  AdminKickVoicePayload,
  AdminMoveUserPayload,
  AdminMuteUserPayload,
  AuthConnectPayload,
  AuthChallengePayload,
  AuthChallengeResponsePayload,
  AuthFailedPayload,
  AuthSuccessPayload,
  ChannelCreatePayload,
  ChannelCreatedPayload,
  ChannelDeletePayload,
  ChannelDeletedPayload,
  ChatHistoryPayload,
  ChatLoadHistoryPayload,
  ChatMentionsReadPayload,
  ChatMessage,
  ChatRequestUploadTokenPayload,
  ChatSendPayload,
  ChatUploadTokenPayload,
  LIMITS,
  MessageType,
  MemberKickPayload,
  MemberKickedPayload,
  Permission,
  ProtocolErrorCode,
  ProtocolMessage,
  RoleAssignPayload,
  RoleCreatePayload,
  RoleDeletePayload,
  RoleUpdatePayload,
  RolesListPayload,
  ServerErrorPayload,
  ServerInviteInfoPayload,
  ServerNetworkInterface,
  ServerSettingsUpdatedPayload,
  ServerUpdateSettingsPayload,
  SoundboardPlayPayload,
  SoundboardPlayedPayload,
  UserChangeNicknamePayload,
  UserJoinedPayload,
  UserLeftPayload,
  UserConnectionStatePayload,
  UserSummary,
  UserUpdateAvatarPayload,
  UserUpdatedPayload,
  VoiceJoinPayload,
  VoiceLeavePayload,
  VoiceStateChangedPayload,
  VoiceStateUpdatePayload,
  VoiceUserJoinedPayload,
  VoiceUserLeftPayload,
  WebRtcSignalPayload,
} from '@monky/shared';
import { AuthService } from '../../application/services/AuthService';
import { AttachmentService } from '../../application/services/AttachmentService';
import { ChannelService } from '../../application/services/ChannelService';
import { ChatService } from '../../application/services/ChatService';
import { PermissionService } from '../../application/services/PermissionService';
import { RoleService } from '../../application/services/RoleService';
import { SignalingService } from '../../application/services/SignalingService';
import { UserService } from '../../application/services/UserService';
import { IServerRepository } from '../../domain/repositories';
import { scanServerNetworkInterfaces } from '../discovery/ServerIpScanner';
import { Logger } from '../logger/Logger';

interface ClientSession {
  ws: WebSocket;
  user?: UserSummary;
  /**
   * `userId:deviceId` of this connection, set once authenticated (#309). It is
   * stable across reconnects of the same install, which is what lets the server
   * tell a returning device from a second one.
   */
  sessionId?: string;
  isAlive: boolean;
  ip: string;
  /** True when this session was replaced by a newer connection of the same device. */
  replaced?: boolean;
  /** True when the client explicitly logged out (graceful disconnect). */
  intentionalLogout?: boolean;
}

export class WebSocketServer {
  private wss: WSServer;
  private sessions: Map<WebSocket, ClientSession> = new Map();
  /** Live sockets keyed by sessionId: one person may hold several at once (#309). */
  private sessionSockets: Map<string, WebSocket> = new Map();
  /** Pending "user left" timers for sessions that dropped and may still reconnect. */
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(
    private server: http.Server,
    private authService: AuthService,
    private userService: UserService,
    private channelService: ChannelService,
    private chatService: ChatService,
    private signalingService: SignalingService,
    private serverRepo: IServerRepository,
    private attachmentService: AttachmentService,
    private permissionService: PermissionService,
    private roleService: RoleService
  ) {
    this.wss = new WSServer({ server: this.server });
    this.setupWss();
    this.startHeartbeat();
  }

  /** Live connections keyed by sessionId — one person may hold several (#309). */
  public getOnlineUsersMap(): Map<string, { user: UserSummary }> {
    const map = new Map<string, { user: UserSummary }>();
    for (const session of this.sessions.values()) {
      if (session.user && session.sessionId) {
        map.set(session.sessionId, { user: session.user });
      }
    }
    return map;
  }

  /**
   * Disconnects every device of a person. Callers address people by user id and
   * must not leave the other devices online (#309). Returns how many live
   * sessions were closed.
   */
  public closeSessionsOfUser(userId: string): number {
    for (const [pendingSessionId, pendingTimer] of this.reconnectTimers.entries()) {
      if (pendingSessionId.startsWith(`${userId}:`)) {
        clearTimeout(pendingTimer);
        this.reconnectTimers.delete(pendingSessionId);
      }
    }

    const targets = this.getSessionsOfUser(userId);
    for (const target of targets) {
      if (target.sessionId) this.sessionSockets.delete(target.sessionId);
      try {
        target.ws.close();
      } catch {
        // ignore
      }
    }
    return targets.length;
  }

  private setupWss(): void {
    this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      const ip = req.socket.remoteAddress || 'unknown';
      Logger.info('NETWORK', `New connection established from ${ip}`);

      const session: ClientSession = {
        ws,
        isAlive: true,
        ip,
      };
      this.sessions.set(ws, session);

      ws.on('pong', () => {
        session.isAlive = true;
      });

      ws.on('message', async (data: Buffer) => {
        try {
          const rawStr = data.toString('utf8');
          const message: ProtocolMessage = JSON.parse(rawStr);
          await this.handleMessage(session, message);
        } catch (err: any) {
          Logger.error('NETWORK', 'Failed to process message', err);
          this.sendError(ws, ProtocolErrorCode.BAD_REQUEST, 'Mensagem malformada');
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(session);
      });

      ws.on('error', (err) => {
        Logger.error('NETWORK', `Socket error for ${ip}`, err);
        this.handleDisconnect(session);
      });
    });
  }

  private async handleMessage(session: ClientSession, message: ProtocolMessage): Promise<void> {
    const { type, requestId, payload } = message;

    // A revoked session — one kicked from the server or replaced by a newer
    // connection of the same user — must not mutate or observe any state.
    if (session.replaced) {
      return;
    }

    // Heartbeat ping
    if (type === MessageType.PING) {
      session.isAlive = true;
      this.send(session.ws, { type: MessageType.PONG, requestId, payload: { timestamp: Date.now() } });
      return;
    }

    // Connect / Auth
    if (type === MessageType.AUTH_CONNECT) {
      await this.handleAuthConnect(session, payload as AuthConnectPayload, requestId);
      return;
    }

    if (type === MessageType.AUTH_CHALLENGE_RESPONSE) {
      await this.handleAuthChallengeResponse(session, payload as AuthChallengeResponsePayload, requestId);
      return;
    }

    // Require authentication for all subsequent messages
    if (!session.user) {
      this.sendError(session.ws, ProtocolErrorCode.UNAUTHORIZED, 'Não autenticado no servidor', requestId);
      return;
    }

    switch (type) {
      case MessageType.CHAT_SEND:
        if (!(await this.requirePermission(session, Permission.SEND_MESSAGES, requestId))) return;
        await this.handleChatSend(session, payload as ChatSendPayload, requestId);
        break;

      case MessageType.CHAT_LOAD_HISTORY:
        await this.handleChatLoadHistory(session, payload as ChatLoadHistoryPayload, requestId);
        break;

      case MessageType.CHAT_MENTIONS_READ:
        await this.handleChatMentionsRead(session, payload as ChatMentionsReadPayload);
        break;

      case MessageType.CHAT_REQUEST_UPLOAD_TOKEN:
        if (!(await this.requirePermission(session, Permission.ATTACH_FILES, requestId))) return;
        this.handleRequestUploadToken(session, payload as ChatRequestUploadTokenPayload, requestId);
        break;

      case MessageType.CHANNEL_CREATE:
        if (!(await this.requirePermission(session, Permission.MANAGE_CHANNELS, requestId))) return;
        await this.handleChannelCreate(session, payload as ChannelCreatePayload, requestId);
        break;

      case MessageType.CHANNEL_DELETE:
        if (!(await this.requirePermission(session, Permission.MANAGE_CHANNELS, requestId))) return;
        await this.handleChannelDelete(session, payload as ChannelDeletePayload, requestId);
        break;

      case MessageType.USER_CHANGE_NICKNAME:
        await this.handleUserChangeNickname(session, payload as UserChangeNicknamePayload, requestId);
        break;

      case MessageType.USER_UPDATE_AVATAR:
        await this.handleUserUpdateAvatar(session, payload as UserUpdateAvatarPayload, requestId);
        break;

      case MessageType.SERVER_UPDATE_SETTINGS:
        if (!(await this.requirePermission(session, Permission.MANAGE_SERVER, requestId))) return;
        await this.handleServerUpdateSettings(session, payload as ServerUpdateSettingsPayload, requestId);
        break;

      case MessageType.ROLE_CREATE:
        await this.handleRoleCreate(session, payload as RoleCreatePayload, requestId);
        break;

      case MessageType.ROLE_UPDATE:
        await this.handleRoleUpdate(session, payload as RoleUpdatePayload, requestId);
        break;

      case MessageType.ROLE_DELETE:
        await this.handleRoleDelete(session, payload as RoleDeletePayload, requestId);
        break;

      case MessageType.ROLE_ASSIGN:
        await this.handleRoleAssign(session, payload as RoleAssignPayload, requestId);
        break;

      case MessageType.ROLE_UNASSIGN:
        await this.handleRoleUnassign(session, payload as RoleAssignPayload, requestId);
        break;

      case MessageType.VOICE_JOIN:
        if (!(await this.requirePermission(session, Permission.SPEAK, requestId))) return;
        await this.handleVoiceJoin(session, payload as VoiceJoinPayload, requestId);
        break;

      case MessageType.VOICE_LEAVE:
        await this.handleVoiceLeave(session, payload as VoiceLeavePayload, requestId);
        break;

      case MessageType.VOICE_STATE_UPDATE:
        await this.handleVoiceStateUpdate(session, payload as VoiceStateUpdatePayload, requestId);
        break;

      case MessageType.RTC_SIGNAL:
        this.handleRtcSignal(session, payload as WebRtcSignalPayload, requestId);
        break;

      case MessageType.SOUNDBOARD_PLAY:
        if (!(await this.requirePermission(session, Permission.SPEAK, requestId))) return;
        await this.handleSoundboardPlay(session, payload as SoundboardPlayPayload, requestId);
        break;

      case MessageType.ADMIN_MUTE_USER:
        if (!(await this.requirePermission(session, Permission.MUTE_MEMBERS, requestId))) return;
        await this.handleAdminMuteUser(session, payload as AdminMuteUserPayload, requestId);
        break;

      case MessageType.ADMIN_DEAFEN_USER:
        if (!(await this.requirePermission(session, Permission.DEAFEN_MEMBERS, requestId))) return;
        await this.handleAdminDeafenUser(session, payload as AdminDeafenUserPayload, requestId);
        break;

      case MessageType.ADMIN_KICK_VOICE:
        if (!(await this.requirePermission(session, Permission.KICK_MEMBERS, requestId))) return;
        await this.handleAdminKickVoice(session, payload as AdminKickVoicePayload, requestId);
        break;

      case MessageType.ADMIN_MOVE_USER:
        if (!(await this.requirePermission(session, Permission.MOVE_MEMBERS, requestId))) return;
        await this.handleAdminMoveUser(session, payload as AdminMoveUserPayload, requestId);
        break;

      case MessageType.MEMBER_KICK:
        if (!(await this.requirePermission(session, Permission.KICK_MEMBERS, requestId))) return;
        await this.handleMemberKick(session, payload as MemberKickPayload, requestId);
        break;

      case MessageType.SERVER_GET_INVITE_INFO:
        await this.handleGetServerInviteInfo(session, requestId);
        break;

      case MessageType.USER_LOGOUT:
        // Graceful logout: mark the session so the disconnect handler treats it
        // as an intentional leave (immediate USER_LEFT, no reconnecting grace).
        session.intentionalLogout = true;
        break;

      default:
        Logger.warn('NETWORK', `Unknown message type received: ${type}`);
        this.sendError(session.ws, ProtocolErrorCode.BAD_REQUEST, `Tipo de mensagem não suportado: ${type}`, requestId);
    }
  }

  private async handleAuthConnect(
    session: ClientSession,
    payload: AuthConnectPayload,
    requestId?: string
  ): Promise<void> {
    const result = await this.authService.createChallenge(session.ws, payload);

    if (!result.success || !result.nonce) {
      this.sendError(
        session.ws,
        result.errorCode || ProtocolErrorCode.INTERNAL_ERROR,
        result.errorMessage || 'Falha na autenticação',
        requestId
      );
      return;
    }

    this.send(session.ws, {
      type: MessageType.AUTH_CHALLENGE,
      requestId,
      payload: { nonce: result.nonce } satisfies AuthChallengePayload,
    });
  }

  private async handleAuthChallengeResponse(
    session: ClientSession,
    payload: AuthChallengeResponsePayload,
    requestId?: string
  ): Promise<void> {
    const result = await this.authService.verifyChallengeResponse(session.ws, payload.signature);

    if (!result.success || !result.user || !result.serverDetails) {
      if (result.authFailed) {
        this.send(session.ws, {
          type: MessageType.AUTH_FAILED,
          requestId,
          payload: {
            code: result.errorCode,
            message: result.errorMessage || 'Falha na autenticação',
          } satisfies AuthFailedPayload,
        });
        return;
      }
      this.sendError(
        session.ws,
        result.errorCode || ProtocolErrorCode.INTERNAL_ERROR,
        result.errorMessage || 'Falha na autenticação',
        requestId
      );
      return;
    }

    session.user = result.user;
    const sessionId = result.user.sessionId!;
    session.sessionId = sessionId;

    // Prevent duplicate sessions for the *same device*. A lingering/zombie socket
    // (e.g. after a reconnect where the old TCP connection was not yet cleaned
    // up) would otherwise receive every broadcast twice. Note this is keyed by
    // sessionId, not by user: another device of the same person is a legitimate
    // second session and must be left alone (#309).
    const existingWs = this.sessionSockets.get(sessionId);
    if (existingWs && existingWs !== session.ws) {
      const staleSession = this.sessions.get(existingWs);
      if (staleSession) {
        staleSession.replaced = true;
        this.sessions.delete(existingWs);
      }
      try {
        existingWs.close();
      } catch {
        /* ignore */
      }
      Logger.info('NETWORK', `Replaced stale session ${sessionId}`);
    }

    this.sessionSockets.set(sessionId, session.ws);

    // If this session had a pending "reconnecting" grace timer (from a recent
    // ungraceful drop), cancel it and tell everyone they are back online (#44).
    const pendingTimer = this.reconnectTimers.get(sessionId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.reconnectTimers.delete(sessionId);
      const backOnlinePayload: UserConnectionStatePayload = {
        userId: result.user.id,
        sessionId,
        nickname: result.user.nickname,
        status: 'online',
      };
      this.broadcast({
        type: MessageType.USER_CONNECTION_STATE,
        payload: backOnlinePayload,
      }, session.ws);
    }

    // Populate current voice states into serverDetails
    result.serverDetails.voiceStates = this.signalingService.getAllVoiceStates();

    // Send AUTH_SUCCESS to the connecting client
    const successPayload: AuthSuccessPayload = {
      server: result.serverDetails,
      currentUser: result.user,
      roles: result.serverDetails.roles,
      userRoles: result.serverDetails.userRoles,
      ownerId: result.serverDetails.ownerId,
      myPermissions: result.serverDetails.myPermissions,
    };

    this.send(session.ws, {
      type: MessageType.AUTH_SUCCESS,
      requestId,
      payload: successPayload,
    });

    // Broadcast USER_JOINED to all other clients
    const userJoinedPayload: UserJoinedPayload = { user: result.user };
    this.broadcast({
      type: MessageType.USER_JOINED,
      payload: userJoinedPayload,
    }, session.ws);

    await this.broadcastRolesState(requestId);

    Logger.info('NETWORK', `User ${result.user.nickname} (${result.user.id}) joined the server.`);
  }

  private async handleChatSend(
    session: ClientSession,
    payload: ChatSendPayload,
    requestId?: string
  ): Promise<void> {
    if (!session.user) return;

    const result = await this.chatService.sendMessage(
      session.user.id,
      payload.channelId,
      payload.content,
      payload.attachmentIds
    );
    if (!result.success || !result.message) {
      this.sendError(
        session.ws,
        result.errorCode || ProtocolErrorCode.BAD_REQUEST,
        result.errorMessage || 'Erro ao enviar mensagem',
        requestId
      );
      return;
    }

    // Broadcast message to all connected users
    this.broadcast({
      type: MessageType.CHAT_MESSAGE,
      requestId,
      payload: result.message,
    });
  }

  private async handleChatLoadHistory(
    session: ClientSession,
    payload: ChatLoadHistoryPayload,
    requestId?: string
  ): Promise<void> {
    const messages = await this.chatService.loadHistory(
      payload.channelId,
      payload.limit || LIMITS.MAX_HISTORY_MESSAGES_INITIAL,
      payload.beforeTimestamp
    );

    const historyPayload: ChatHistoryPayload = {
      channelId: payload.channelId,
      messages,
    };

    this.send(session.ws, {
      type: MessageType.CHAT_HISTORY,
      requestId,
      payload: historyPayload,
    });
  }

  private async handleChatMentionsRead(
    session: ClientSession,
    payload: ChatMentionsReadPayload
  ): Promise<void> {
    if (!session.user) return;
    await this.chatService.markMentionsRead(session.user.id, payload.channelId);
  }

  private handleRequestUploadToken(
    session: ClientSession,
    payload: ChatRequestUploadTokenPayload,
    requestId?: string
  ): void {
    if (!session.user) return;
    const issued = this.attachmentService.issueUploadToken(session.user.id, payload.channelId);
    if (!issued) {
      this.sendError(
        session.ws,
        ProtocolErrorCode.RATE_LIMITED,
        'Muitos envios em pouco tempo. Aguarde alguns segundos.',
        requestId
      );
      return;
    }
    const tokenPayload: ChatUploadTokenPayload = { token: issued.token, expiresAt: issued.expiresAt };
    this.send(session.ws, {
      type: MessageType.CHAT_UPLOAD_TOKEN,
      requestId,
      payload: tokenPayload,
    });
  }

  private async handleChannelCreate(
    session: ClientSession,
    payload: ChannelCreatePayload,
    requestId?: string
  ): Promise<void> {
    const result = await this.channelService.createChannel(payload);
    if (!result.success || !result.channel) {
      this.sendError(
        session.ws,
        result.errorCode || ProtocolErrorCode.BAD_REQUEST,
        result.errorMessage || 'Erro ao criar canal',
        requestId
      );
      return;
    }

    const channelPayload: ChannelCreatedPayload = { channel: result.channel };
    this.broadcast({
      type: MessageType.CHANNEL_CREATED,
      requestId,
      payload: channelPayload,
    });
  }

  private async handleChannelDelete(
    session: ClientSession,
    payload: ChannelDeletePayload,
    requestId?: string
  ): Promise<void> {
    const result = await this.channelService.deleteChannel(payload.channelId);
    if (!result.success) {
      this.sendError(
        session.ws,
        result.errorCode || ProtocolErrorCode.CHANNEL_NOT_FOUND,
        result.errorMessage || 'Erro ao deletar canal',
        requestId
      );
      return;
    }

    // If it was a voice channel, disconnect any participants still in it so they
    // are not stranded in a "ghost" channel after it has been removed.
    const strandedParticipants = this.signalingService.getParticipantsInChannel(payload.channelId);
    for (const participant of strandedParticipants) {
      this.signalingService.leaveVoiceChannel(participant.sessionId);
      const leavePayload: VoiceUserLeftPayload = {
        channelId: payload.channelId,
        userId: participant.userId,
        sessionId: participant.sessionId,
      };
      this.broadcast({
        type: MessageType.VOICE_USER_LEFT,
        payload: leavePayload,
      });
    }

    const channelPayload: ChannelDeletedPayload = { channelId: payload.channelId };
    this.broadcast({
      type: MessageType.CHANNEL_DELETED,
      requestId,
      payload: channelPayload,
    });
  }

  private async handleUserChangeNickname(
    session: ClientSession,
    payload: UserChangeNicknamePayload,
    requestId?: string
  ): Promise<void> {
    if (!session.user) return;

    const result = await this.userService.changeNickname(session.user.id, payload.newNickname);
    if (!result.success || !result.updatedUser) {
      this.sendError(
        session.ws,
        result.errorCode || ProtocolErrorCode.NICKNAME_INVALID,
        result.errorMessage || 'Erro ao alterar nickname',
        requestId
      );
      return;
    }

    this.applyUserUpdate(result.updatedUser);
    const updatePayload: UserUpdatedPayload = { user: result.updatedUser };

    this.broadcast({
      type: MessageType.USER_UPDATED,
      requestId,
      payload: updatePayload,
    });
  }

  private async handleUserUpdateAvatar(
    session: ClientSession,
    payload: UserUpdateAvatarPayload,
    requestId?: string
  ): Promise<void> {
    if (!session.user) return;

    const result = await this.userService.updateAvatar(session.user.id, payload.avatarBase64);
    if (!result.success || !result.updatedUser) {
      this.sendError(
        session.ws,
        result.errorCode || ProtocolErrorCode.AVATAR_INVALID_TYPE,
        result.errorMessage || 'Erro ao atualizar avatar',
        requestId
      );
      return;
    }

    this.applyUserUpdate(result.updatedUser);
    const updatePayload: UserUpdatedPayload = { user: result.updatedUser };

    this.broadcast({
      type: MessageType.USER_UPDATED,
      requestId,
      payload: updatePayload,
    });
  }

  private async handleServerUpdateSettings(
    session: ClientSession,
    payload: ServerUpdateSettingsPayload,
    requestId?: string
  ): Promise<void> {
    if (!session.user) return;

    const result = await this.authService.updateServerSettings(payload);
    if (!result.success) {
      this.sendError(
        session.ws,
        ProtocolErrorCode.BAD_REQUEST,
        result.errorMessage || 'Erro ao atualizar configurações do servidor',
        requestId
      );
      return;
    }

    const broadcastPayload: ServerSettingsUpdatedPayload = {
      name: result.name!,
      hasPassword: result.hasPassword!,
      allowSoundboard: result.allowSoundboard,
      iconUrl: result.iconUrl,
      attachmentStorage: result.attachmentStorage,
    };

    // Broadcast updated server settings to all clients
    this.broadcast({
      type: MessageType.SERVER_SETTINGS_UPDATED,
      requestId,
      payload: broadcastPayload,
    });

    Logger.info(
      'INFO',
      `Configurações do servidor atualizadas (Nome: ${result.name}, Senha: ${
        result.hasPassword ? 'Ativa' : 'Sem Senha'
      }, Soundboard: ${result.allowSoundboard ? 'Habilitado' : 'Desabilitado'})`
    );
  }

  private async handleSoundboardPlay(
    session: ClientSession,
    payload: SoundboardPlayPayload,
    requestId?: string
  ): Promise<void> {
    if (!session.user) return;

    // Check if soundboard is allowed on the server
    const server = await this.serverRepo.getServer();
    if (server && server.allowSoundboard === false) {
      this.sendError(
        session.ws,
        ProtocolErrorCode.BAD_REQUEST,
        'A reprodução de soundboard está desabilitada neste servidor.',
        requestId
      );
      return;
    }

    if (!payload || !payload.channelId || !payload.audioBase64 || !payload.soundName) {
      this.sendError(session.ws, ProtocolErrorCode.BAD_REQUEST, 'Dados de som inválidos', requestId);
      return;
    }

    // Limit audioBase64 to ~4MB to prevent flood abuse
    if (payload.audioBase64.length > 4 * 1024 * 1024) {
      this.sendError(session.ws, ProtocolErrorCode.BAD_REQUEST, 'Áudio muito grande (máximo 15 segundos / ~2MB)', requestId);
      return;
    }

    const soundName = String(payload.soundName).slice(0, 100);

    const broadcastPayload: SoundboardPlayedPayload = {
      channelId: payload.channelId,
      userId: session.user.id,
      userName: session.user.nickname,
      soundName,
      audioBase64: payload.audioBase64,
      mimeType: payload.mimeType || 'audio/mp3',
    };

    // Broadcast SOUNDBOARD_PLAYED to participants in this channel
    const participants = this.signalingService.getParticipantsInChannel(payload.channelId);
    if (participants.length > 0) {
      for (const p of participants) {
        const sock = this.sessionSockets.get(p.sessionId);
        if (sock && sock.readyState === WebSocket.OPEN) {
          this.send(sock, {
            type: MessageType.SOUNDBOARD_PLAYED,
            requestId,
            payload: broadcastPayload,
          });
        }
      }
    } else {
      this.broadcast({
        type: MessageType.SOUNDBOARD_PLAYED,
        requestId,
        payload: broadcastPayload,
      });
    }

    Logger.info('SOUNDBOARD', `User ${session.user.nickname} played sound "${soundName}" in channel ${payload.channelId}`);
  }

  private async handleVoiceJoin(
    session: ClientSession,
    payload: VoiceJoinPayload,
    requestId?: string
  ): Promise<void> {
    if (!session.user || !session.sessionId) return;

    const result = await this.signalingService.joinVoiceChannel(
      session.sessionId,
      session.user.id,
      payload.channelId,
      payload.isMuted,
      payload.isDeafened
    );
    if (!result.success || !result.voiceState) {
      this.sendError(
        session.ws,
        result.errorCode || ProtocolErrorCode.CHANNEL_NOT_FOUND,
        result.errorMessage || 'Erro ao entrar no canal de voz',
        requestId
      );
      return;
    }

    const joinPayload: VoiceUserJoinedPayload = {
      channelId: payload.channelId,
      userId: session.user.id,
      sessionId: session.sessionId,
      voiceState: result.voiceState,
    };

    // Broadcast to all clients so everyone knows who is in which voice channel
    this.broadcast({
      type: MessageType.VOICE_USER_JOINED,
      requestId,
      payload: joinPayload,
    });
  }

  private async handleVoiceLeave(
    session: ClientSession,
    payload: VoiceLeavePayload,
    requestId?: string
  ): Promise<void> {
    if (!session.user || !session.sessionId) return;

    const previous = this.signalingService.leaveVoiceChannel(session.sessionId);
    if (previous) {
      const leavePayload: VoiceUserLeftPayload = {
        channelId: previous.channelId,
        userId: session.user.id,
        sessionId: session.sessionId,
      };

      this.broadcast({
        type: MessageType.VOICE_USER_LEFT,
        requestId,
        payload: leavePayload,
      });
    }
  }

  private async handleVoiceStateUpdate(
    session: ClientSession,
    payload: VoiceStateUpdatePayload,
    requestId?: string
  ): Promise<void> {
    if (!session.user || !session.sessionId) return;

    const current = this.signalingService.getVoiceState(session.sessionId);
    const effectivePayload: VoiceStateUpdatePayload = { ...payload };
    if (current?.serverMuted) {
      effectivePayload.isSpeaking = false;
    }

    const updated = this.signalingService.updateVoiceState(session.sessionId, effectivePayload);
    if (updated) {
      const changedPayload: VoiceStateChangedPayload = { voiceState: updated };
      this.broadcast({
        type: MessageType.VOICE_STATE_CHANGED,
        requestId,
        payload: changedPayload,
      });
    }
  }

  private handleRtcSignal(
    session: ClientSession,
    payload: WebRtcSignalPayload,
    requestId?: string
  ): void {
    if (!session.user || !session.sessionId) return;

    // Enforce that fromSessionId matches the authenticated connection
    payload.fromSessionId = session.sessionId;

    if (!this.signalingService.validateSignalRouting(payload)) {
      Logger.warn('WEBRTC', `Invalid signal routing attempt from ${session.sessionId} to ${payload.targetSessionId}`);
      return;
    }

    const targetSocket = this.sessionSockets.get(payload.targetSessionId);
    if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
      this.send(targetSocket, {
        type: MessageType.RTC_SIGNAL,
        requestId,
        payload,
      });
    }
  }

  private async requirePermission(
    session: ClientSession,
    permission: Permission,
    requestId?: string
  ): Promise<boolean> {
    if (!session.user) return false;
    const allowed = await this.permissionService.checkPermission(session.user.id, permission);
    if (allowed) return true;
    this.sendError(session.ws, ProtocolErrorCode.PERMISSION_DENIED, 'Você não tem permissão para executar esta ação.', requestId);
    return false;
  }

  private async broadcastRolesState(requestId?: string): Promise<void> {
    const state = await this.roleService.getRoleState();
    const payload: RolesListPayload = {
      roles: state.roles,
      userRoles: state.userRoles,
    };
    this.broadcast({
      type: MessageType.ROLES_LIST,
      requestId,
      payload,
    });
  }

  private async handleRoleCreate(session: ClientSession, payload: RoleCreatePayload, requestId?: string): Promise<void> {
    if (!session.user) return;
    const result = await this.roleService.createRole(session.user.id, payload);
    if (!result.success) {
      this.sendError(session.ws, result.errorCode || ProtocolErrorCode.BAD_REQUEST, result.errorMessage || 'Erro ao criar cargo.', requestId);
      return;
    }
    await this.broadcastRolesState(requestId);
  }

  private async handleRoleUpdate(session: ClientSession, payload: RoleUpdatePayload, requestId?: string): Promise<void> {
    if (!session.user) return;
    const result = await this.roleService.updateRole(session.user.id, payload);
    if (!result.success) {
      this.sendError(session.ws, result.errorCode || ProtocolErrorCode.BAD_REQUEST, result.errorMessage || 'Erro ao atualizar cargo.', requestId);
      return;
    }
    await this.broadcastRolesState(requestId);
  }

  private async handleRoleDelete(session: ClientSession, payload: RoleDeletePayload, requestId?: string): Promise<void> {
    if (!session.user) return;
    const result = await this.roleService.deleteRole(session.user.id, payload.roleId);
    if (!result.success) {
      this.sendError(session.ws, result.errorCode || ProtocolErrorCode.BAD_REQUEST, result.errorMessage || 'Erro ao excluir cargo.', requestId);
      return;
    }
    await this.broadcastRolesState(requestId);
  }

  private async handleRoleAssign(session: ClientSession, payload: RoleAssignPayload, requestId?: string): Promise<void> {
    if (!session.user) return;
    const result = await this.roleService.assignRole(session.user.id, payload);
    if (!result.success) {
      this.sendError(session.ws, result.errorCode || ProtocolErrorCode.BAD_REQUEST, result.errorMessage || 'Erro ao atribuir cargo.', requestId);
      return;
    }
    await this.broadcastRolesState(requestId);
  }

  private async handleRoleUnassign(session: ClientSession, payload: RoleAssignPayload, requestId?: string): Promise<void> {
    if (!session.user) return;
    const result = await this.roleService.unassignRole(session.user.id, payload);
    if (!result.success) {
      this.sendError(session.ws, result.errorCode || ProtocolErrorCode.BAD_REQUEST, result.errorMessage || 'Erro ao remover cargo.', requestId);
      return;
    }
    await this.broadcastRolesState(requestId);
  }

  private async handleAdminMuteUser(session: ClientSession, payload: AdminMuteUserPayload, requestId?: string): Promise<void> {
    const state = this.signalingService.getVoiceState(payload.targetSessionId);
    if (!state) {
      this.sendError(session.ws, ProtocolErrorCode.BAD_REQUEST, 'Usuário não está em um canal de voz.', requestId);
      return;
    }
    const updated = this.signalingService.updateVoiceState(payload.targetSessionId, { serverMuted: payload.muted, isSpeaking: false });
    if (!updated) return;
    this.broadcast({ type: MessageType.ADMIN_MUTE_USER, requestId, payload });
    this.broadcast({ type: MessageType.VOICE_STATE_CHANGED, requestId, payload: { voiceState: updated } });
  }

  private async handleAdminDeafenUser(session: ClientSession, payload: AdminDeafenUserPayload, requestId?: string): Promise<void> {
    const state = this.signalingService.getVoiceState(payload.targetSessionId);
    if (!state) {
      this.sendError(session.ws, ProtocolErrorCode.BAD_REQUEST, 'Usuário não está em um canal de voz.', requestId);
      return;
    }
    const updated = this.signalingService.updateVoiceState(payload.targetSessionId, { serverDeafened: payload.deafened, isSpeaking: false });
    if (!updated) return;
    this.broadcast({ type: MessageType.ADMIN_DEAFEN_USER, requestId, payload });
    this.broadcast({ type: MessageType.VOICE_STATE_CHANGED, requestId, payload: { voiceState: updated } });
  }

  private async handleAdminKickVoice(session: ClientSession, payload: AdminKickVoicePayload, requestId?: string): Promise<void> {
    const previous = this.signalingService.leaveVoiceChannel(payload.targetSessionId);
    if (!previous) {
      this.sendError(session.ws, ProtocolErrorCode.BAD_REQUEST, 'Usuário não está em um canal de voz.', requestId);
      return;
    }

    this.broadcast({ type: MessageType.ADMIN_KICK_VOICE, requestId, payload });
    this.broadcast({
      type: MessageType.VOICE_USER_LEFT,
      requestId,
      payload: { channelId: previous.channelId, userId: previous.userId, sessionId: previous.sessionId },
    });
  }

  private async handleAdminMoveUser(session: ClientSession, payload: AdminMoveUserPayload, requestId?: string): Promise<void> {
    const previous = this.signalingService.getVoiceState(payload.targetSessionId);
    if (!previous) {
      this.sendError(session.ws, ProtocolErrorCode.BAD_REQUEST, 'Usuário não está em um canal de voz.', requestId);
      return;
    }
    if (previous.channelId === payload.channelId) {
      return;
    }

    const joinResult = await this.signalingService.joinVoiceChannel(payload.targetSessionId, previous.userId, payload.channelId);
    if (!joinResult.success || !joinResult.voiceState) {
      this.sendError(session.ws, joinResult.errorCode || ProtocolErrorCode.BAD_REQUEST, joinResult.errorMessage || 'Não foi possível mover o usuário.', requestId);
      return;
    }

    this.broadcast({ type: MessageType.ADMIN_MOVE_USER, requestId, payload });
    this.broadcast({
      type: MessageType.VOICE_USER_LEFT,
      requestId,
      payload: { channelId: previous.channelId, userId: previous.userId, sessionId: previous.sessionId },
    });
    this.broadcast({
      type: MessageType.VOICE_USER_JOINED,
      requestId,
      payload: {
        channelId: payload.channelId,
        userId: previous.userId,
        sessionId: previous.sessionId,
        voiceState: joinResult.voiceState,
      },
    });
  }

  private async handleMemberKick(session: ClientSession, payload: MemberKickPayload, requestId?: string): Promise<void> {
    if (!session.user) return;

    const targetUserId = payload?.targetUserId;
    if (!targetUserId) {
      this.sendError(session.ws, ProtocolErrorCode.BAD_REQUEST, 'Usuário inválido.', requestId);
      return;
    }
    if (targetUserId === session.user.id) {
      this.sendError(session.ws, ProtocolErrorCode.BAD_REQUEST, 'Você não pode expulsar a si mesmo.', requestId);
      return;
    }
    if (await this.permissionService.isOwner(targetUserId)) {
      this.sendError(session.ws, ProtocolErrorCode.PERMISSION_DENIED, 'O dono do servidor não pode ser expulso.', requestId);
      return;
    }

    const result = await this.userService.deleteMember(targetUserId);
    if (!result.success) {
      this.sendError(session.ws, result.errorCode ?? ProtocolErrorCode.BAD_REQUEST, result.errorMessage ?? 'Não foi possível expulsar o membro.', requestId);
      return;
    }

    // Kicking removes the person, so every device they are signed in from has to
    // go — not just the most recent one (#309). Marked before any further await
    // so concurrent in-flight messages from them are dropped by handleMessage.
    const targetSessions = this.getSessionsOfUser(targetUserId);
    for (const targetSession of targetSessions) targetSession.replaced = true;

    // Invalidate any outstanding HTTP upload tokens the member still holds.
    this.attachmentService.revokeTokensForUser(targetUserId);

    // Remove the target from any voice channel they were in (one state per device).
    for (const previousVoice of this.signalingService.getSessionsOfUser(targetUserId)) {
      this.signalingService.leaveVoiceChannel(previousVoice.sessionId);
      this.broadcast({
        type: MessageType.VOICE_USER_LEFT,
        payload: {
          channelId: previousVoice.channelId,
          userId: targetUserId,
          sessionId: previousVoice.sessionId,
        },
      });
    }

    // Announce the removal. The initiator gets a direct reply carrying the
    // requestId (resolving their pending request) while everyone else — the
    // kicked user included — receives it via broadcast. Sent before closing the
    // target socket so it still arrives.
    const kickedPayload: MemberKickedPayload = { userId: targetUserId, nickname: result.nickname ?? '' };
    this.send(session.ws, { type: MessageType.MEMBER_KICKED, requestId, payload: kickedPayload });
    this.broadcast({ type: MessageType.MEMBER_KICKED, payload: kickedPayload }, session.ws);

    // Cancel pending reconnect-grace timers and forcefully disconnect every
    // live session of the kicked user.
    this.closeSessionsOfUser(targetUserId);

    // Role assignments were removed with the user, so refresh role state.
    await this.broadcastRolesState();

    Logger.info('NETWORK', `User ${result.nickname} was kicked from the server by ${session.user.nickname}`);
  }

  /**
   * Refreshes the cached summary on every live session of that person, keeping
   * the per-connection fields the service layer knows nothing about (#309).
   */
  private applyUserUpdate(updatedUser: UserSummary): void {
    for (const target of this.getSessionsOfUser(updatedUser.id)) {
      target.user = {
        ...updatedUser,
        sessionId: target.sessionId,
        connectedAt: target.user?.connectedAt,
      };
    }
  }

  /** Every live session of a person: they may be signed in from several devices (#309). */
  private getSessionsOfUser(userId: string): ClientSession[] {
    const found: ClientSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.user?.id === userId) found.push(session);
    }
    return found;
  }

  private handleDisconnect(session: ClientSession): void {
    this.sessions.delete(session.ws);
    this.authService.clearChallenge(session.ws);

    // If this session was replaced by a newer connection of the same device, it
    // is a stale/zombie socket. Do not broadcast USER_LEFT nor touch the
    // sessionSockets mapping (which now points at the newer session).
    if (session.replaced) {
      return;
    }

    if (!session.user || !session.sessionId) {
      return;
    }

    const user = session.user;
    const sessionId = session.sessionId;

    // Only clear the mapping if it still points at this exact socket.
    if (this.sessionSockets.get(sessionId) === session.ws) {
      this.sessionSockets.delete(sessionId);
    }

    // Graceful logout (user clicked disconnect / switched servers): remove them
    // immediately. Otherwise treat it as a possible temporary connection loss
    // and give them a grace period to reconnect before announcing USER_LEFT.
    if (session.intentionalLogout) {
      this.finalizeSessionLeave(user, sessionId);
      return;
    }

    // Notify everyone else that this session lost connection (#44).
    const reconnectingPayload: UserConnectionStatePayload = {
      userId: user.id,
      sessionId,
      nickname: user.nickname,
      status: 'reconnecting',
    };
    this.broadcast({
      type: MessageType.USER_CONNECTION_STATE,
      payload: reconnectingPayload,
    });
    Logger.info('NETWORK', `User ${user.nickname} lost connection (aguardando reconexão)`);

    // Clear any previous timer just in case, then start the grace period.
    const existingTimer = this.reconnectTimers.get(sessionId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(sessionId);
      // Only finalize if this session hasn't reconnected in the meantime.
      if (this.sessionSockets.has(sessionId)) return;
      this.finalizeSessionLeave(user, sessionId);
    }, LIMITS.RECONNECT_GRACE_MS);
    this.reconnectTimers.set(sessionId, timer);
  }

  /**
   * Removes one connection from voice, announces USER_LEFT for it and logs the
   * departure. Used both for graceful logouts and when the reconnection grace
   * period expires. The person may still be online from another device, which
   * the client resolves from the `sessionId` carried in the payload (#309).
   */
  private finalizeSessionLeave(user: UserSummary, sessionId: string): void {
    // Leave voice channel if in one
    const previousVoice = this.signalingService.leaveVoiceChannel(sessionId);
    if (previousVoice) {
      const leavePayload: VoiceUserLeftPayload = {
        channelId: previousVoice.channelId,
        userId: user.id,
        sessionId,
      };
      this.broadcast({
        type: MessageType.VOICE_USER_LEFT,
        payload: leavePayload,
      });
    }

    const userLeftPayload: UserLeftPayload = {
      userId: user.id,
      sessionId,
      nickname: user.nickname,
    };
    this.broadcast({
      type: MessageType.USER_LEFT,
      payload: userLeftPayload,
    });

    Logger.info('NETWORK', `User ${user.nickname} disconnected`);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const [ws, session] of this.sessions.entries()) {
        if (!session.isAlive) {
          Logger.warn('NETWORK', `Terminating dead socket for ${session.user?.nickname || session.ip}`);
          ws.terminate();
          this.handleDisconnect(session);
          continue;
        }
        session.isAlive = false;
        ws.ping();
      }
    }, LIMITS.HEARTBEAT_INTERVAL_MS);
  }

  public send(ws: WebSocket, message: ProtocolMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  public broadcast(message: ProtocolMessage, ignoreWs?: WebSocket): void {
    const raw = JSON.stringify(message);
    for (const [ws, session] of this.sessions.entries()) {
      if (ws !== ignoreWs && ws.readyState === WebSocket.OPEN && session.user) {
        ws.send(raw);
      }
    }
  }

  private async handleGetServerInviteInfo(session: ClientSession, requestId?: string): Promise<void> {
    try {
      const server = await this.serverRepo.getServer();
      const addr = this.server.address();
      const port = addr && typeof addr === 'object' ? addr.port : LIMITS.DEFAULT_PORT;
      const networkInterfaces = await scanServerNetworkInterfaces();

      this.send(session.ws, {
        type: MessageType.SERVER_INVITE_INFO,
        requestId,
        payload: {
          port,
          serverName: server?.name || 'Monky Server',
          networkInterfaces,
        },
      });
    } catch (err: any) {
      Logger.error('NETWORK', 'Error generating server invite info', err);
      this.sendError(
        session.ws,
        ProtocolErrorCode.INTERNAL_ERROR,
        'Erro ao obter informações de convite do servidor',
        requestId
      );
    }
  }

  public sendError(ws: WebSocket, code: ProtocolErrorCode, message: string, requestId?: string): void {
    const payload: ServerErrorPayload = { code, message, requestId };
    this.send(ws, {
      type: MessageType.SERVER_ERROR,
      requestId,
      payload,
    });
  }

  public close(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
    // Let connected clients know the host is shutting the server down so they can
    // show a friendly notice and return to the home screen instead of silently
    // trying to reconnect forever.
    this.broadcast({
      type: MessageType.SERVER_SHUTDOWN,
      payload: { reason: 'O anfitrião encerrou o servidor.' },
    });
    for (const ws of this.sessions.keys()) {
      ws.close();
    }
    // Closing gracefully lets clients show the shutdown notice, but a peer that
    // never answers the close frame would keep its socket — and the HTTP server
    // waiting on it — alive for the ws library's 30s close timeout. Unref'd so
    // it can never hold the process open by itself (#333).
    const forceClose = setTimeout(() => {
      for (const ws of this.sessions.keys()) {
        if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
      }
    }, LIMITS.SHUTDOWN_GRACE_MS);
    forceClose.unref?.();
    this.wss.close();
  }
}
