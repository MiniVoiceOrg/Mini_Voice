import { AttachmentRecord, ChannelRecord, MentionRecord, MessageRecord, RoleRecord, ServerRecord, UserRecord, UserRoleRecord } from './entities';

export interface IServerRepository {
  getServer(): Promise<ServerRecord | null>;
  createServer(server: ServerRecord): Promise<void>;
  updateServer(server: Partial<ServerRecord>): Promise<void>;
}

export interface IUserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByClientId(clientId: string): Promise<UserRecord | null>;
  findByPublicKey(publicKey: string): Promise<UserRecord | null>;
  findByNickname(nickname: string): Promise<UserRecord | null>;
  create(user: UserRecord): Promise<void>;
  update(id: string, updates: Partial<UserRecord>): Promise<void>;
  delete(id: string): Promise<void>;
  findByIds(ids: string[]): Promise<UserRecord[]>;
  listAll(): Promise<UserRecord[]>;
}

export interface IChannelRepository {
  findById(id: string): Promise<ChannelRecord | null>;
  listByServerId(serverId: string): Promise<ChannelRecord[]>;
  create(channel: ChannelRecord): Promise<void>;
  /** Applies a partial edit; `allowedRoleIds`, when given, replaces the set (#384). */
  update(id: string, updates: Partial<Omit<ChannelRecord, 'id' | 'serverId'>>): Promise<void>;
  delete(id: string): Promise<void>;
  updatePosition(id: string, position: number): Promise<void>;
}

export interface IMessageRepository {
  create(message: MessageRecord): Promise<void>;
  listByChannel(channelId: string, limit: number, beforeTimestamp?: number): Promise<MessageRecord[]>;
  deleteByChannel(channelId: string): Promise<void>;
  countAll(): Promise<number>;
}

export interface IMentionRepository {
  add(mention: MentionRecord): Promise<void>;
  /** Distinct channel ids where the user currently has unread mentions. */
  listChannelIdsForUser(userId: string): Promise<string[]>;
  /** Clears all unread mentions for a user in a specific channel (channel opened). */
  clearForUserChannel(userId: string, channelId: string): Promise<void>;
}

export interface IAttachmentRepository {
  create(att: AttachmentRecord): Promise<void>;
  findByIds(ids: string[]): Promise<AttachmentRecord[]>;
  listByMessageIds(messageIds: string[]): Promise<AttachmentRecord[]>;
  /** Links pending uploads to a message once it is sent (#11). */
  linkToMessage(ids: string[], messageId: string): Promise<void>;
  /** Sum of size_bytes across non-evicted rows — the current storage usage. */
  sumActiveBytes(): Promise<number>;
  /** Oldest non-evicted attachments first, for FIFO eviction. */
  listOldestActive(limit: number): Promise<AttachmentRecord[]>;
  /** Marks a row evicted: clears filename and sets evicted=1 (keeps the row). */
  markEvicted(id: string): Promise<void>;
  /** Pending uploads (never linked to a message) older than a cutoff. */
  listPendingBefore(timestamp: number): Promise<AttachmentRecord[]>;
  /** Hard-deletes a row (used for pending uploads that were never linked). */
  deleteById(id: string): Promise<void>;
  /** All on-disk filenames still referenced by non-evicted rows (reconciliation). */
  listActiveFilenames(): Promise<string[]>;
}

export interface IRoleRepository {
  findById(id: string): Promise<RoleRecord | null>;
  findByName(name: string): Promise<RoleRecord | null>;
  listAll(): Promise<RoleRecord[]>;
  listRolesForUser(userId: string): Promise<RoleRecord[]>;
  listUserRoles(): Promise<UserRoleRecord[]>;
  getDefaultRoles(): Promise<RoleRecord[]>;
  create(role: RoleRecord): Promise<void>;
  update(roleId: string, updates: Partial<RoleRecord>): Promise<void>;
  delete(roleId: string): Promise<void>;
  assignRole(userId: string, roleId: string): Promise<void>;
  unassignRole(userId: string, roleId: string): Promise<void>;
  hasRole(userId: string, roleId: string): Promise<boolean>;
}
