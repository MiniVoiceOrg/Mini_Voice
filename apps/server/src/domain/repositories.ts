import { ChannelRecord, MentionRecord, MessageRecord, ServerRecord, UserRecord } from './entities';

export interface IServerRepository {
  getServer(): Promise<ServerRecord | null>;
  createServer(server: ServerRecord): Promise<void>;
  updateServer(server: Partial<ServerRecord>): Promise<void>;
}

export interface IUserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByClientId(clientId: string): Promise<UserRecord | null>;
  findByNickname(nickname: string): Promise<UserRecord | null>;
  create(user: UserRecord): Promise<void>;
  update(id: string, updates: Partial<UserRecord>): Promise<void>;
  findByIds(ids: string[]): Promise<UserRecord[]>;
  listAll(): Promise<UserRecord[]>;
}

export interface IChannelRepository {
  findById(id: string): Promise<ChannelRecord | null>;
  listByServerId(serverId: string): Promise<ChannelRecord[]>;
  create(channel: ChannelRecord): Promise<void>;
  delete(id: string): Promise<void>;
  updatePosition(id: string, position: number): Promise<void>;
}

export interface IMessageRepository {
  create(message: MessageRecord): Promise<void>;
  listByChannel(channelId: string, limit: number, beforeTimestamp?: number): Promise<MessageRecord[]>;
  deleteByChannel(channelId: string): Promise<void>;
}

export interface IMentionRepository {
  add(mention: MentionRecord): Promise<void>;
  /** Distinct channel ids where the user currently has unread mentions. */
  listChannelIdsForUser(userId: string): Promise<string[]>;
  /** Clears all unread mentions for a user in a specific channel (channel opened). */
  clearForUserChannel(userId: string, channelId: string): Promise<void>;
}
