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
  UserChangeNicknamePayload,
  UserJoinedPayload,
  UserLeftPayload,
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
import { Logger } from '../logger/Logger';

interface ClientSession {
  ws: WebSocket;
  user?: UserSummary;
  isAlive: boolean;
  ip: string;
}

export class WebSocketServer {
  private wss: WSServer;
  private sessions: Map<WebSocket, ClientSession> = new Map();
  private userSockets: Map<string, WebSocket> = new Map();
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(
    private server: http.Server,
    private authService: AuthService,
    private userService: UserService,
    private channelService: ChannelService,
    private chatService: ChatService,
    private signalingService: SignalingService
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
    this.userSockets.set(result.user.id, session.ws);

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
    };

    // Broadcast updated server settings to all clients
    this.broadcast({
      type: MessageType.SERVER_SETTINGS_UPDATED,
      requestId,
      payload: broadcastPayload,
    });

    Logger.info('INFO', `Configurações do servidor atualizadas (Nome: ${result.name}, Senha: ${result.hasPassword ? 'Ativa' : 'Sem Senha'})`);
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

    if (session.user) {
      this.userSockets.delete(session.user.id);

      // Leave voice channel if in one
      const previousVoice = this.signalingService.leaveVoiceChannel(session.user.id);
      if (previousVoice) {
        const leavePayload: VoiceUserLeftPayload = {
          channelId: previousVoice.channelId,
          userId: session.user.id,
        };
        this.broadcast({
          type: MessageType.VOICE_USER_LEFT,
          payload: leavePayload,
        });
      }

      // Broadcast USER_LEFT
      const userLeftPayload: UserLeftPayload = {
        userId: session.user.id,
        nickname: session.user.nickname,
      };
      this.broadcast({
        type: MessageType.USER_LEFT,
        payload: userLeftPayload,
      });

      Logger.info('NETWORK', `User ${session.user.nickname} disconnected`);
    }
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
    for (const ws of this.sessions.keys()) {
      ws.close();
    }
    this.wss.close();
  }
}
