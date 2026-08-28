import { v4 as uuidv4 } from 'uuid';
import {
  ChannelCreatePayload,
  ChannelSummary,
  ChannelUpdatePayload,
  ProtocolErrorCode,
  canAccessChannel,
  channelCreateSchema,
  channelUpdateSchema,
} from '@monky/shared';
import { ChannelRecord } from '../../domain/entities';
import { IChannelRepository, IRoleRepository, IServerRepository } from '../../domain/repositories';
import { PermissionService } from './PermissionService';

/** Everything needed to decide what a member may see, resolved once per call. */
export interface ChannelAccessContext {
  permissions: number;
  roleIds: string[];
}

export class ChannelService {
  constructor(
    private channelRepo: IChannelRepository,
    private serverRepo: IServerRepository,
    private roleRepo: IRoleRepository,
    private permissionService: PermissionService
  ) {}

  private toSummary(record: ChannelRecord): ChannelSummary {
    return {
      id: record.id,
      serverId: record.serverId,
      name: record.name,
      type: record.type,
      position: record.position,
      createdAt: record.createdAt,
      maxParticipants: record.maxParticipants,
      isPrivate: record.isPrivate,
      allowedRoleIds: record.allowedRoleIds,
    };
  }

  /**
   * Drops role ids that do not exist (#384). The foreign key on
   * channel_allowed_roles is enforced, so an unknown id coming from a crafted
   * payload would throw mid-transaction instead of being quietly ignored.
   */
  private async sanitizeRoleIds(roleIds: string[]): Promise<string[]> {
    if (roleIds.length === 0) return [];
    const known = new Set((await this.roleRepo.listAll()).map((role) => role.id));
    return roleIds.filter((id) => known.has(id));
  }

  public async getAccessContext(userId: string): Promise<ChannelAccessContext> {
    const [permissions, roles] = await Promise.all([
      this.permissionService.getUserPermissions(userId),
      this.roleRepo.listRolesForUser(userId),
    ]);
    return { permissions, roleIds: roles.map((role) => role.id) };
  }

  public async listChannels(): Promise<ChannelSummary[]> {
    const server = await this.serverRepo.getServer();
    if (!server) return [];

    const channels = await this.channelRepo.listByServerId(server.id);
    return channels.map((c) => this.toSummary(c));
  }

  public async canUserAccessChannel(userId: string, channelId: string): Promise<boolean> {
    const channel = await this.channelRepo.findById(channelId);
    if (!channel) return false;

    const context = await this.getAccessContext(userId);
    return canAccessChannel(channel, context.permissions, context.roleIds);
  }

  /** Visibility metadata for one channel, used to scope broadcasts (#384). */
  public async getChannelSummary(channelId: string): Promise<ChannelSummary | null> {
    const channel = await this.channelRepo.findById(channelId);
    return channel ? this.toSummary(channel) : null;
  }

  public async createChannel(
    payload: ChannelCreatePayload
  ): Promise<{ success: boolean; errorCode?: ProtocolErrorCode; errorMessage?: string; channel?: ChannelSummary }> {
    const parseResult = channelCreateSchema.safeParse(payload);
    if (!parseResult.success) {
      return {
        success: false,
        errorCode: ProtocolErrorCode.BAD_REQUEST,
        errorMessage: parseResult.error.errors[0]?.message || 'Parâmetros de canal inválidos',
      };
    }

    const server = await this.serverRepo.getServer();
    if (!server) {
      return {
        success: false,
        errorCode: ProtocolErrorCode.INTERNAL_ERROR,
        errorMessage: 'Servidor não encontrado',
      };
    }

    const existingChannels = await this.channelRepo.listByServerId(server.id);
    const isPrivate = parseResult.data.isPrivate;
    const channelRecord: ChannelRecord = {
      id: uuidv4(),
      serverId: server.id,
      name: parseResult.data.name,
      type: parseResult.data.type,
      position: existingChannels.length,
      createdAt: Date.now(),
      maxParticipants: parseResult.data.maxParticipants || 10,
      isPrivate,
      // Links are meaningless on a public channel and would resurface if it were
      // later made private, so they are only stored while privacy is on.
      allowedRoleIds: isPrivate ? await this.sanitizeRoleIds(parseResult.data.allowedRoleIds) : [],
    };

    await this.channelRepo.create(channelRecord);

    return {
      success: true,
      channel: this.toSummary(channelRecord),
    };
  }

  public async updateChannel(
    payload: ChannelUpdatePayload
  ): Promise<{ success: boolean; errorCode?: ProtocolErrorCode; errorMessage?: string; channel?: ChannelSummary }> {
    const parseResult = channelUpdateSchema.safeParse(payload);
    if (!parseResult.success) {
      return {
        success: false,
        errorCode: ProtocolErrorCode.BAD_REQUEST,
        errorMessage: parseResult.error.errors[0]?.message || 'Parâmetros de canal inválidos',
      };
    }

    const { channelId, name, maxParticipants, isPrivate, allowedRoleIds } = parseResult.data;
    const existing = await this.channelRepo.findById(channelId);
    if (!existing) {
      return {
        success: false,
        errorCode: ProtocolErrorCode.CHANNEL_NOT_FOUND,
        errorMessage: 'Canal não encontrado',
      };
    }

    const nextIsPrivate = isPrivate ?? existing.isPrivate;
    // Turning privacy off clears the role list, so switching it back on later
    // starts from a blank slate instead of silently restoring the old audience.
    const nextRoleIds = !nextIsPrivate
      ? []
      : allowedRoleIds !== undefined
        ? await this.sanitizeRoleIds(allowedRoleIds)
        : existing.allowedRoleIds;

    await this.channelRepo.update(channelId, {
      ...(name !== undefined ? { name } : {}),
      ...(maxParticipants !== undefined ? { maxParticipants } : {}),
      isPrivate: nextIsPrivate,
      allowedRoleIds: nextRoleIds,
    });

    return {
      success: true,
      channel: this.toSummary({
        ...existing,
        name: name ?? existing.name,
        maxParticipants: maxParticipants ?? existing.maxParticipants,
        isPrivate: nextIsPrivate,
        allowedRoleIds: nextRoleIds,
      }),
    };
  }

  public async deleteChannel(
    channelId: string
  ): Promise<{ success: boolean; errorCode?: ProtocolErrorCode; errorMessage?: string }> {
    const channel = await this.channelRepo.findById(channelId);
    if (!channel) {
      return {
        success: false,
        errorCode: ProtocolErrorCode.CHANNEL_NOT_FOUND,
        errorMessage: 'Canal não encontrado',
      };
    }

    await this.channelRepo.delete(channelId);
    return { success: true };
  }
}
