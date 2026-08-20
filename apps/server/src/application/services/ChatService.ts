import { v4 as uuidv4 } from 'uuid';
import {
  ChatMessage,
  LIMITS,
  ProtocolErrorCode,
  messageContentSchema,
} from '@mini-voice/shared';
import { MessageRecord } from '../../domain/entities';
import { IChannelRepository, IMessageRepository, IUserRepository } from '../../domain/repositories';
import { AvatarStorageService } from '../../infrastructure/security/AvatarStorageService';
import { RateLimiter } from '../../infrastructure/security/RateLimiter';

export class ChatService {
  constructor(
    private messageRepo: IMessageRepository,
    private channelRepo: IChannelRepository,
    private userRepo: IUserRepository,
    private avatarStorage: AvatarStorageService,
    private rateLimiter: RateLimiter
  ) {}

  public async sendMessage(
    userId: string,
    channelId: string,
    content: string
  ): Promise<{ success: boolean; errorCode?: ProtocolErrorCode; errorMessage?: string; message?: ChatMessage }> {
    // Check rate limit
    if (!this.rateLimiter.checkLimit(userId)) {
      return {
        success: false,
        errorCode: ProtocolErrorCode.RATE_LIMITED,
        errorMessage: 'Você está enviando mensagens muito rápido. Aguarde alguns segundos.',
      };
    }

    // Validate content
    const parseResult = messageContentSchema.safeParse(content);
    if (!parseResult.success) {
      return {
        success: false,
        errorCode: ProtocolErrorCode.MESSAGE_TOO_LONG,
        errorMessage: parseResult.error.errors[0]?.message || 'Mensagem inválida',
      };
    }

    // Check channel
    const channel = await this.channelRepo.findById(channelId);
    if (!channel || channel.type !== 'TEXT') {
      return {
        success: false,
        errorCode: ProtocolErrorCode.CHANNEL_NOT_FOUND,
        errorMessage: 'Canal de texto não encontrado',
      };
    }

    const user = await this.userRepo.findById(userId);
    if (!user) {
      return {
        success: false,
        errorCode: ProtocolErrorCode.UNAUTHORIZED,
        errorMessage: 'Usuário não autenticado',
      };
    }

    const now = Date.now();
    const messageRecord: MessageRecord = {
      id: uuidv4(),
      channelId,
      userId: user.id,
      content: parseResult.data,
      createdAt: now,
      isSystem: false,
    };

    await this.messageRepo.create(messageRecord);

    const chatMessage: ChatMessage = {
      id: messageRecord.id,
      channelId: messageRecord.channelId,
      userId: user.id,
      userNickname: user.nickname,
      userAvatarUrl: user.avatarPath ? this.avatarStorage.getAvatarAsDataUrl(user.avatarPath) : null,
      content: messageRecord.content,
      createdAt: messageRecord.createdAt,
      isSystem: false,
    };

    return {
      success: true,
      message: chatMessage,
    };
  }

  public async loadHistory(
    channelId: string,
    limit: number = LIMITS.MAX_HISTORY_MESSAGES_INITIAL,
    beforeTimestamp?: number
  ): Promise<ChatMessage[]> {
    const rawMessages = await this.messageRepo.listByChannel(channelId, limit, beforeTimestamp);
    const users = await this.userRepo.listAll();
    const userMap = new Map(users.map((u) => [u.id, u]));

    return rawMessages.map((m) => {
      const user = userMap.get(m.userId);
      return {
        id: m.id,
        channelId: m.channelId,
        userId: m.userId,
        userNickname: user ? user.nickname : 'Usuário Desconhecido',
        userAvatarUrl: user?.avatarPath ? this.avatarStorage.getAvatarAsDataUrl(user.avatarPath) : null,
        content: m.content,
        createdAt: m.createdAt,
        isSystem: m.isSystem,
      };
    });
  }
}
