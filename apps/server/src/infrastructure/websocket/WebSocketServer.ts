import http from 'http';
import { WebSocket, WebSocketServer as WSServer } from 'ws';
import {
  AuthConnectPayload,
  AuthSuccessPayload,
  ChannelCreatePayload,
  ChannelCreatedPayload,
  ChannelDeletePayload,
  ChannelDeletedPayload,
  ChatHistoryPayload,
  ChatLoadHistoryPayload,
  ChatMessage,
  ChatSendPayload,
  LIMITS,
  MessageType,
  ProtocolErrorCode,
  ProtocolMessage,
  ServerErrorPayload,
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
} from '@mini-voice/shared';
import { AuthService } from '../../application/services/AuthService';
import { ChannelService } from '../../application/services/ChannelService';
import { ChatService } from '../../application/services/ChatService';
import { SignalingService } from '../../application/services/SignalingService';
import { UserService } from '../../application/services/UserService';
import { IServerRepository } from '../../domain/repositories';
import { Logger } from '../logger/Logger';

interface ClientSession {
  ws: WebSocket;
  user?: UserSummary;
  isAlive: boolean;
  ip: string;
  /** True when this session was replaced by a newer connection of the same user. */
  replaced?: boolean;
  /** True when the client explicitly logged out (graceful disconnect). */
  intentionalLogout?: boolean;
}

export class WebSocketServer {
  private wss: WSServer;
  private sessions: Map<WebSocket, ClientSession> = new Map();
  private userSockets: Map<string, WebSocket> = new Map();
  /** Pending "user left" timers for users that dropped and may still reconnect. */
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(
    private server: http.Server,
    private authService: AuthService,
    private userService: UserService,
    private channelService: ChannelService,
    private chatService: ChatService,
    private signalingService: SignalingService,
    private serverRepo: IServerRepository
  ) {
    this.wss = new WSServer({ server: this.server });
    this.setupWss();
    this.startHeartbeat();
  }

  public getOnlineUsersMap(): Map<string, { user: UserSummary }> {
    const map = new Map<string, { user: UserSummary }>();
    for (const session of this.sessions.values()) {
      if (session.user) {
        map.set(session.user.id, { user: session.user });
      }
    }
    return map;
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

    // Require authentication for all subsequent messages
    if (!session.user) {
      this.sendError(session.ws, ProtocolErrorCode.UNAUTHORIZED, 'Não autenticado no servidor', requestId);
      return;
    }

    switch (type) {
      case MessageType.CHAT_SEND:
        await this.handleChatSend(session, payload as ChatSendPayload, requestId);
        break;

      case MessageType.CHAT_LOAD_HISTORY:
        await this.handleChatLoadHistory(session, payload as ChatLoadHistoryPayload, requestId);
        break;

      case MessageType.CHANNEL_CREATE:
        await this.handleChannelCreate(session, payload as ChannelCreatePayload, requestId);
        break;

      case MessageType.CHANNEL_DELETE:
        await this.handleChannelDelete(session, payload as ChannelDeletePayload, requestId);
        break;

      case MessageType.USER_CHANGE_NICKNAME:
        await this.handleUserChangeNickname(session, payload as UserChangeNicknamePayload, requestId);
        break;

      case MessageType.USER_UPDATE_AVATAR:
        await this.handleUserUpdateAvatar(session, payload as UserUpdateAvatarPayload, requestId);
        break;

      case MessageType.SERVER_UPDATE_SETTINGS:
        await this.handleServerUpdateSettings(session, payload as ServerUpdateSettingsPayload, requestId);
        break;

      case MessageType.VOICE_JOIN:
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
        await this.handleSoundboardPlay(session, payload as SoundboardPlayPayload, requestId);
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
    const result = await this.authService.authenticate(payload);

    if (!result.success || !result.user || !result.serverDetails) {
      this.sendError(
        session.ws,
        result.errorCode || ProtocolErrorCode.INTERNAL_ERROR,
        result.errorMessage || 'Falha na autenticação',
        requestId
      );
      return;
    }

    session.user = result.user;

    // Prevent duplicate sessions for the same user. A lingering/zombie socket
    // (e.g. after a reconnect where the old TCP connection was not yet cleaned
    // up) would otherwise receive every broadcast twice, causing duplicated
    // messages/channels on the client. Replace the old session cleanly.
    const existingWs = this.userSockets.get(result.user.id);
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
      Logger.info('NETWORK', `Replaced stale session for user ${result.user.id}`);
    }

    this.userSockets.set(result.user.id, session.ws);

    // If this user had a pending "reconnecting" grace timer (from a recent
    // ungraceful drop), cancel it and tell everyone they are back online (#44).
    const pendingTimer = this.reconnectTimers.get(result.user.id);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.reconnectTimers.delete(result.user.id);
      const backOnlinePayload: UserConnectionStatePayload = {
        userId: result.user.id,
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

    Logger.info('NETWORK', `User ${result.user.nickname} (${result.user.id}) joined the server.`);
  }

  private async handleChatSend(
    session: ClientSession,
    payload: ChatSendPayload,
    requestId?: string
  ): Promise<void> {
    if (!session.user) return;

    const result = await this.chatService.sendMessage(session.user.id, payload.channelId, payload.content);
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
      this.signalingService.leaveVoiceChannel(participant.userId);
      const leavePayload: VoiceUserLeftPayload = {
        channelId: payload.channelId,
        userId: participant.userId,
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

    session.user = result.updatedUser;
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

    session.user = result.updatedUser;
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
        const sock = this.userSockets.get(p.userId);
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
    if (!session.user) return;

    const result = await this.signalingService.joinVoiceChannel(session.user.id, payload.channelId);
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
    if (!session.user) return;

    const previous = this.signalingService.leaveVoiceChannel(session.user.id);
    if (previous) {
      const leavePayload: VoiceUserLeftPayload = {
        channelId: previous.channelId,
        userId: session.user.id,
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
    if (!session.user) return;

    const updated = this.signalingService.updateVoiceState(session.user.id, payload);
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
    if (!session.user) return;

    // Enforce that fromUserId matches the authenticated user
    payload.fromUserId = session.user.id;

    if (!this.signalingService.validateSignalRouting(payload)) {
      Logger.warn('WEBRTC', `Invalid signal routing attempt from ${session.user.id} to ${payload.targetUserId}`);
      return;
    }

    const targetSocket = this.userSockets.get(payload.targetUserId);
    if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
      this.send(targetSocket, {
        type: MessageType.RTC_SIGNAL,
        requestId,
        payload,
      });
    }
  }

  private handleDisconnect(session: ClientSession): void {
    this.sessions.delete(session.ws);

    // If this session was replaced by a newer connection of the same user, it
    // is a stale/zombie socket. Do not broadcast USER_LEFT nor touch the
    // userSockets mapping (which now points at the newer session).
    if (session.replaced) {
      return;
    }

    if (!session.user) {
      return;
    }

    const user = session.user;

    // Only clear the mapping if it still points at this exact socket.
    if (this.userSockets.get(user.id) === session.ws) {
      this.userSockets.delete(user.id);
    }

    // Graceful logout (user clicked disconnect / switched servers): remove them
    // immediately. Otherwise treat it as a possible temporary connection loss
    // and give them a grace period to reconnect before announcing USER_LEFT.
    if (session.intentionalLogout) {
      this.finalizeUserLeave(user);
      return;
    }

    // Notify everyone else that this user lost connection (#44).
    const reconnectingPayload: UserConnectionStatePayload = {
      userId: user.id,
      nickname: user.nickname,
      status: 'reconnecting',
    };
    this.broadcast({
      type: MessageType.USER_CONNECTION_STATE,
      payload: reconnectingPayload,
    });
    Logger.info('NETWORK', `User ${user.nickname} lost connection (aguardando reconexão)`);

    // Clear any previous timer just in case, then start the grace period.
    const existingTimer = this.reconnectTimers.get(user.id);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(user.id);
      // Only finalize if the user hasn't reconnected in the meantime.
      if (this.userSockets.has(user.id)) return;
      this.finalizeUserLeave(user);
    }, LIMITS.RECONNECT_GRACE_MS);
    this.reconnectTimers.set(user.id, timer);
  }

  /**
   * Removes a user from voice, announces USER_LEFT and logs the departure. Used
   * both for graceful logouts and when the reconnection grace period expires.
   */
  private finalizeUserLeave(user: UserSummary): void {
    // Leave voice channel if in one
    const previousVoice = this.signalingService.leaveVoiceChannel(user.id);
    if (previousVoice) {
      const leavePayload: VoiceUserLeftPayload = {
        channelId: previousVoice.channelId,
        userId: user.id,
      };
      this.broadcast({
        type: MessageType.VOICE_USER_LEFT,
        payload: leavePayload,
      });
    }

    const userLeftPayload: UserLeftPayload = {
      userId: user.id,
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
    this.wss.close();
  }
}
