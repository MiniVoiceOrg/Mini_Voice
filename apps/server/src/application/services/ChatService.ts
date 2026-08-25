import { v4 as uuidv4 } from 'uuid';
import {
  AttachmentMeta,
  ChatMessage,
  LIMITS,
  ProtocolErrorCode,
  attachmentCaptionSchema,
  messageContentSchema,
} from '@monky/shared';
import { MentionRecord, MessageRecord } from '../../domain/entities';
import {
  IChannelRepository,
  IMentionRepository,
  IMessageRepository,
  IUserRepository,
} from '../../domain/repositories';
import { AvatarStorageService } from '../../infrastructure/security/AvatarStorageService';
import { RateLimiter } from '../../infrastructure/security/RateLimiter';
import { AttachmentService } from './AttachmentService';

export class ChatService {
  constructor(
    private messageRepo: IMessageRepository,
    private channelRepo: IChannelRepository,
    private userRepo: IUserRepository,
    private mentionRepo: IMentionRepository,
    private avatarStorage: AvatarStorageService,
    private rateLimiter: RateLimiter,
    private attachmentService: AttachmentService
  ) {}

  public async sendMessage(
    userId: string,
    channelId: string,
    content: string,
    attachmentIds?: string[]
  ): Promise<{
    success: boolean;
    errorCode?: ProtocolErrorCode;
    errorMessage?: string;
    message?: ChatMessage;
    mentionedUserIds?: string[];
  }> {
    // Check rate limit
    if (!this.rateLimiter.checkLimit(userId)) {
      return {
        success: false,
        errorCode: ProtocolErrorCode.RATE_LIMITED,
        errorMessage: 'Você está enviando mensagens muito rápido. Aguarde alguns segundos.',
      };
    }

    // Validate content. Attachment messages may carry an empty caption; plain
    // text messages must be non-empty (#11).
    const hasAttachments = !!(attachmentIds && attachmentIds.length > 0);
    const schema = hasAttachments ? attachmentCaptionSchema : messageContentSchema;
    const parseResult = schema.safeParse(content ?? '');
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

    const mentionedUserIds = await this.persistMentions(user.id, channelId, messageRecord);

    const attachments = hasAttachments
      ? await this.attachmentService.linkToMessage(attachmentIds!, messageRecord.id, user.id, channelId)
      : [];

    const chatMessage: ChatMessage = {
      id: messageRecord.id,
      channelId: messageRecord.channelId,
      userId: user.id,
      userNickname: user.nickname,
      userAvatarUrl: this.avatarStorage.getPublicUrl(user.avatarPath),
      content: messageRecord.content,
      createdAt: messageRecord.createdAt,
      isSystem: false,
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    return {
      success: true,
      message: chatMessage,
      mentionedUserIds,
    };
  }

  /**
   * Detects @-mentions in a message and persists an unread mention row for every
   * mentioned user except the author (#14). Matching mirrors the client dropup:
   * a case-insensitive substring `@<nickname>` (nicknames may contain spaces, so
   * a token split is not reliable). Returns the list of mentioned user ids so the
   * caller can notify online users in real time.
   */
  private async persistMentions(
    authorId: string,
    channelId: string,
    message: MessageRecord
  ): Promise<string[]> {
    const lowerContent = message.content.toLowerCase();
    if (!lowerContent.includes('@')) return [];

    const allUsers = await this.userRepo.listAll();
    const mentionedUserIds: string[] = [];

    for (const candidate of allUsers) {
      if (candidate.id === authorId) continue;
      const nickname = candidate.nickname.trim().toLowerCase();
      if (!nickname) continue;
      if (!lowerContent.includes('@' + nickname)) continue;

      mentionedUserIds.push(candidate.id);
      const mention: MentionRecord = {
        id: uuidv4(),
        userId: candidate.id,
        channelId,
        messageId: message.id,
        createdAt: message.createdAt,
      };
      await this.mentionRepo.add(mention);
    }

    return mentionedUserIds;
  }

  /** Clears unread mentions for a user in a channel when they open it (#14). */
  public async markMentionsRead(userId: string, channelId: string): Promise<void> {
    await this.mentionRepo.clearForUserChannel(userId, channelId);
  }

  public async loadHistory(
    channelId: string,
    limit: number = LIMITS.MAX_HISTORY_MESSAGES_INITIAL,
    beforeTimestamp?: number
  ): Promise<ChatMessage[]> {
    const rawMessages = await this.messageRepo.listByChannel(channelId, limit, beforeTimestamp);
    const uniqueUserIds = [...new Set(rawMessages.map((m) => m.userId))];
    const users = await this.userRepo.findByIds(uniqueUserIds);
    const userMap = new Map(users.map((u) => [u.id, u]));

    const attachmentsByMessage = await this.attachmentService.getForMessages(rawMessages.map((m) => m.id));

    return rawMessages.map((m) => {
      const user = userMap.get(m.userId);
      const attachments = attachmentsByMessage.get(m.id);
      return {
        id: m.id,
        channelId: m.channelId,
        userId: m.userId,
        userNickname: user ? user.nickname : 'Usuário Desconhecido',
        userAvatarUrl: this.avatarStorage.getPublicUrl(user?.avatarPath),
        content: m.content,
        createdAt: m.createdAt,
        isSystem: m.isSystem,
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
      };
    });
  }
}
