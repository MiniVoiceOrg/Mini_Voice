import { IDatabaseDriver } from './SqliteWrapper';
import { ChannelRecord, MessageRecord, ServerRecord, UserRecord } from '../../domain/entities';
import { IChannelRepository, IMessageRepository, IServerRepository, IUserRepository } from '../../domain/repositories';

export class SqliteServerRepository implements IServerRepository {
  constructor(private db: IDatabaseDriver) {}

  async getServer(): Promise<ServerRecord | null> {
    const row = this.db.prepare('SELECT id, name, password_hash as passwordHash, created_at as createdAt, max_users as maxUsers FROM server_meta LIMIT 1').get() as ServerRecord | undefined;
    return row || null;
  }

  async createServer(server: ServerRecord): Promise<void> {
    this.db.prepare(
      'INSERT INTO server_meta (id, name, password_hash, created_at, max_users) VALUES (?, ?, ?, ?, ?)'
    ).run(server.id, server.name, server.passwordHash, server.createdAt, server.maxUsers);
  }

  async updateServer(server: Partial<ServerRecord>): Promise<void> {
    if (server.name) {
      this.db.prepare('UPDATE server_meta SET name = ?').run(server.name);
    }
    if (server.maxUsers) {
      this.db.prepare('UPDATE server_meta SET max_users = ?').run(server.maxUsers);
    }
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
