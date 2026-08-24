import { IDatabaseDriver } from './SqliteWrapper';
import { ChannelRecord, MentionRecord, MessageRecord, ServerRecord, UserRecord, AttachmentRecord } from '../../domain/entities';
import { IAttachmentRepository, IChannelRepository, IMentionRepository, IMessageRepository, IServerRepository, IUserRepository } from '../../domain/repositories';

/**
 * Note: all repository methods are declared `async` even though the underlying
 * sql.js driver is fully synchronous. This is a deliberate design choice: the
 * repository interfaces (domain/repositories.ts) return Promises so the storage
 * backend can later be swapped for a genuinely asynchronous driver (e.g.
 * better-sqlite3 on a worker thread, or PostgreSQL) without changing any caller.
 * The micro-task overhead is negligible for this application's scale.
 */

export class SqliteServerRepository implements IServerRepository {
  constructor(private db: IDatabaseDriver) {}

  async getServer(): Promise<ServerRecord | null> {
    const row = this.db.prepare('SELECT id, name, password_hash as passwordHash, created_at as createdAt, max_users as maxUsers, allow_soundboard as allowSoundboard, icon_path as iconPath, max_attachment_file_bytes as maxAttachmentFileBytes, max_attachment_storage_bytes as maxAttachmentStorageBytes FROM server_meta LIMIT 1').get() as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      passwordHash: row.passwordHash,
      createdAt: row.createdAt,
      maxUsers: row.maxUsers,
      allowSoundboard: row.allowSoundboard !== undefined ? Boolean(row.allowSoundboard) : true,
      iconPath: row.iconPath || null,
      maxAttachmentFileBytes: row.maxAttachmentFileBytes ?? null,
      maxAttachmentStorageBytes: row.maxAttachmentStorageBytes ?? null,
    };
  }

  async createServer(server: ServerRecord): Promise<void> {
    this.db.prepare(
      'INSERT INTO server_meta (id, name, password_hash, created_at, max_users, allow_soundboard, icon_path) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(server.id, server.name, server.passwordHash, server.createdAt, server.maxUsers, server.allowSoundboard !== false ? 1 : 0, server.iconPath || null);
  }

  async updateServer(server: Partial<ServerRecord>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (server.name !== undefined) {
      fields.push('name = ?');
      values.push(server.name);
    }
    if (server.passwordHash !== undefined) {
      fields.push('password_hash = ?');
      values.push(server.passwordHash);
    }
    if (server.maxUsers !== undefined) {
      fields.push('max_users = ?');
      values.push(server.maxUsers);
    }
    if (server.allowSoundboard !== undefined) {
      fields.push('allow_soundboard = ?');
      values.push(server.allowSoundboard ? 1 : 0);
    }
    if (server.iconPath !== undefined) {
      fields.push('icon_path = ?');
      values.push(server.iconPath);
    }
    if (server.maxAttachmentFileBytes !== undefined) {
      fields.push('max_attachment_file_bytes = ?');
      values.push(server.maxAttachmentFileBytes);
    }
    if (server.maxAttachmentStorageBytes !== undefined) {
      fields.push('max_attachment_storage_bytes = ?');
      values.push(server.maxAttachmentStorageBytes);
    }

    if (fields.length === 0) return;

    this.db.prepare(
      `UPDATE server_meta SET ${fields.join(', ')} WHERE id = (SELECT id FROM server_meta LIMIT 1)`
    ).run(...values);
  }
}

export class SqliteUserRepository implements IUserRepository {
  constructor(private db: IDatabaseDriver) {}

  async findById(id: string): Promise<UserRecord | null> {
    const row = this.db.prepare(
      'SELECT id, client_id as clientId, nickname, avatar_path as avatarPath, created_at as createdAt, last_seen_at as lastSeenAt FROM users WHERE id = ?'
    ).get(id) as UserRecord | undefined;
    return row || null;
  }

  async findByClientId(clientId: string): Promise<UserRecord | null> {
    const row = this.db.prepare(
      'SELECT id, client_id as clientId, nickname, avatar_path as avatarPath, created_at as createdAt, last_seen_at as lastSeenAt FROM users WHERE client_id = ?'
    ).get(clientId) as UserRecord | undefined;
    return row || null;
  }

  async findByNickname(nickname: string): Promise<UserRecord | null> {
    const row = this.db.prepare(
      'SELECT id, client_id as clientId, nickname, avatar_path as avatarPath, created_at as createdAt, last_seen_at as lastSeenAt FROM users WHERE nickname = ? COLLATE NOCASE'
    ).get(nickname) as UserRecord | undefined;
    return row || null;
  }

  async create(user: UserRecord): Promise<void> {
    this.db.prepare(
      'INSERT INTO users (id, client_id, nickname, avatar_path, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(user.id, user.clientId, user.nickname, user.avatarPath, user.createdAt, user.lastSeenAt);
  }

  async update(id: string, updates: Partial<UserRecord>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.nickname !== undefined) {
      fields.push('nickname = ?');
      values.push(updates.nickname);
    }
    if (updates.avatarPath !== undefined) {
      fields.push('avatar_path = ?');
      values.push(updates.avatarPath);
    }
    if (updates.lastSeenAt !== undefined) {
      fields.push('last_seen_at = ?');
      values.push(updates.lastSeenAt);
    }

    if (fields.length === 0) return;

    values.push(id);
    this.db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  async listAll(): Promise<UserRecord[]> {
    return this.db.prepare(
      'SELECT id, client_id as clientId, nickname, avatar_path as avatarPath, created_at as createdAt, last_seen_at as lastSeenAt FROM users'
    ).all() as UserRecord[];
  }

  async findByIds(ids: string[]): Promise<UserRecord[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    return this.db.prepare(
      `SELECT id, client_id as clientId, nickname, avatar_path as avatarPath, created_at as createdAt, last_seen_at as lastSeenAt FROM users WHERE id IN (${placeholders})`
    ).all(...ids) as UserRecord[];
  }
}

export class SqliteChannelRepository implements IChannelRepository {
  constructor(private db: IDatabaseDriver) {}

  async findById(id: string): Promise<ChannelRecord | null> {
    const row = this.db.prepare(
      'SELECT id, server_id as serverId, name, type, position, created_at as createdAt, max_participants as maxParticipants FROM channels WHERE id = ?'
    ).get(id) as ChannelRecord | undefined;
    return row || null;
  }

  async listByServerId(serverId: string): Promise<ChannelRecord[]> {
    return this.db.prepare(
      'SELECT id, server_id as serverId, name, type, position, created_at as createdAt, max_participants as maxParticipants FROM channels WHERE server_id = ? ORDER BY position ASC, created_at ASC'
    ).all(serverId) as ChannelRecord[];
  }

  async create(channel: ChannelRecord): Promise<void> {
    this.db.prepare(
      'INSERT INTO channels (id, server_id, name, type, position, created_at, max_participants) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(channel.id, channel.serverId, channel.name, channel.type, channel.position, channel.createdAt, channel.maxParticipants);
  }

  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM channels WHERE id = ?').run(id);
  }

  async updatePosition(id: string, position: number): Promise<void> {
    this.db.prepare('UPDATE channels SET position = ? WHERE id = ?').run(position, id);
  }
}

interface SqliteMessageRow {
  id: string;
  channelId: string;
  userId: string;
  content: string;
  createdAt: number;
  isSystem: number;
}

export class SqliteMessageRepository implements IMessageRepository {
  constructor(private db: IDatabaseDriver) {}

  async create(message: MessageRecord): Promise<void> {
    this.db.prepare(
      'INSERT INTO messages (id, channel_id, user_id, content, created_at, is_system) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(message.id, message.channelId, message.userId, message.content, message.createdAt, message.isSystem ? 1 : 0);
  }

  async listByChannel(channelId: string, limit: number, beforeTimestamp?: number): Promise<MessageRecord[]> {
    if (beforeTimestamp) {
      const rows = this.db.prepare(
        'SELECT id, channel_id as channelId, user_id as userId, content, created_at as createdAt, is_system as isSystem FROM messages WHERE channel_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?'
      ).all(channelId, beforeTimestamp, limit) as SqliteMessageRow[];

      return rows.reverse().map((r) => ({
        id: r.id,
        channelId: r.channelId,
        userId: r.userId,
        content: r.content,
        createdAt: r.createdAt,
        isSystem: Boolean(r.isSystem),
      }));
    }

    const rows = this.db.prepare(
      'SELECT id, channel_id as channelId, user_id as userId, content, created_at as createdAt, is_system as isSystem FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(channelId, limit) as SqliteMessageRow[];

    return rows.reverse().map((r) => ({
      id: r.id,
      channelId: r.channelId,
      userId: r.userId,
      content: r.content,
      createdAt: r.createdAt,
      isSystem: Boolean(r.isSystem),
    }));
  }

  async deleteByChannel(channelId: string): Promise<void> {
    this.db.prepare('DELETE FROM messages WHERE channel_id = ?').run(channelId);
  }
}

interface SqliteMentionChannelRow {
  channelId: string;
}

export class SqliteMentionRepository implements IMentionRepository {
  constructor(private db: IDatabaseDriver) {}

  async add(mention: MentionRecord): Promise<void> {
    this.db.prepare(
      'INSERT INTO mentions (id, user_id, channel_id, message_id, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(mention.id, mention.userId, mention.channelId, mention.messageId, mention.createdAt);
  }

  async listChannelIdsForUser(userId: string): Promise<string[]> {
    const rows = this.db.prepare(
      'SELECT DISTINCT channel_id as channelId FROM mentions WHERE user_id = ?'
    ).all(userId) as SqliteMentionChannelRow[];

    return rows.map((r) => r.channelId);
  }

  async clearForUserChannel(userId: string, channelId: string): Promise<void> {
    this.db.prepare('DELETE FROM mentions WHERE user_id = ? AND channel_id = ?').run(userId, channelId);
  }
}

interface SqliteAttachmentRow {
  id: string;
  messageId: string | null;
  channelId: string;
  userId: string;
  kind: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  evicted: number;
  createdAt: number;
}

export class SqliteAttachmentRepository implements IAttachmentRepository {
  constructor(private db: IDatabaseDriver) {}

  private static readonly SELECT =
    'SELECT id, message_id as messageId, channel_id as channelId, user_id as userId, kind, filename, original_name as originalName, mime_type as mimeType, size_bytes as sizeBytes, width, height, duration_ms as durationMs, evicted, created_at as createdAt FROM message_attachments';

  private map(r: SqliteAttachmentRow): AttachmentRecord {
    return {
      id: r.id,
      messageId: r.messageId,
      channelId: r.channelId,
      userId: r.userId,
      kind: r.kind as AttachmentRecord['kind'],
      filename: r.filename,
      originalName: r.originalName,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      width: r.width,
      height: r.height,
      durationMs: r.durationMs,
      evicted: Boolean(r.evicted),
      createdAt: r.createdAt,
    };
  }

  async create(att: AttachmentRecord): Promise<void> {
    this.db.prepare(
      'INSERT INTO message_attachments (id, message_id, channel_id, user_id, kind, filename, original_name, mime_type, size_bytes, width, height, duration_ms, evicted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      att.id,
      att.messageId,
      att.channelId,
      att.userId,
      att.kind,
      att.filename,
      att.originalName,
      att.mimeType,
      att.sizeBytes,
      att.width ?? null,
      att.height ?? null,
      att.durationMs ?? null,
      att.evicted ? 1 : 0,
      att.createdAt
    );
  }

  async findByIds(ids: string[]): Promise<AttachmentRecord[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`${SqliteAttachmentRepository.SELECT} WHERE id IN (${placeholders})`)
      .all(...ids) as SqliteAttachmentRow[];
    return rows.map((r) => this.map(r));
  }

  async listByMessageIds(messageIds: string[]): Promise<AttachmentRecord[]> {
    if (messageIds.length === 0) return [];
    const placeholders = messageIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`${SqliteAttachmentRepository.SELECT} WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`)
      .all(...messageIds) as SqliteAttachmentRow[];
    return rows.map((r) => this.map(r));
  }

  async linkToMessage(ids: string[], messageId: string): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    this.db
      .prepare(`UPDATE message_attachments SET message_id = ? WHERE id IN (${placeholders})`)
      .run(messageId, ...ids);
  }

  async sumActiveBytes(): Promise<number> {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(size_bytes), 0) as total FROM message_attachments WHERE evicted = 0')
      .get() as { total: number };
    return row?.total ?? 0;
  }

  async listOldestActive(limit: number): Promise<AttachmentRecord[]> {
    const rows = this.db
      .prepare(`${SqliteAttachmentRepository.SELECT} WHERE evicted = 0 ORDER BY created_at ASC LIMIT ?`)
      .all(limit) as SqliteAttachmentRow[];
    return rows.map((r) => this.map(r));
  }

  async markEvicted(id: string): Promise<void> {
    this.db.prepare("UPDATE message_attachments SET evicted = 1, filename = '' WHERE id = ?").run(id);
  }

  async listPendingBefore(timestamp: number): Promise<AttachmentRecord[]> {
    const rows = this.db
      .prepare(`${SqliteAttachmentRepository.SELECT} WHERE message_id IS NULL AND created_at < ?`)
      .all(timestamp) as SqliteAttachmentRow[];
    return rows.map((r) => this.map(r));
  }

  async deleteById(id: string): Promise<void> {
    this.db.prepare('DELETE FROM message_attachments WHERE id = ?').run(id);
  }

  async listActiveFilenames(): Promise<string[]> {
    const rows = this.db
      .prepare("SELECT filename FROM message_attachments WHERE evicted = 0 AND filename != ''")
      .all() as { filename: string }[];
    return rows.map((r) => r.filename);
  }
}
