import { v4 as uuidv4 } from 'uuid';
import {
  ChannelCreatePayload,
  ChannelSummary,
  ProtocolErrorCode,
  channelCreateSchema,
} from '@monky/shared';
import { ChannelRecord } from '../../domain/entities';
import { IChannelRepository, IServerRepository } from '../../domain/repositories';

export class ChannelService {
  constructor(
    private channelRepo: IChannelRepository,
    private serverRepo: IServerRepository
  ) {}

  public async listChannels(): Promise<ChannelSummary[]> {
    const server = await this.serverRepo.getServer();
    if (!server) return [];

    const channels = await this.channelRepo.listByServerId(server.id);
    return channels.map((c) => ({
      id: c.id,
      serverId: c.serverId,
      name: c.name,
      type: c.type,
      position: c.position,
      createdAt: c.createdAt,
      maxParticipants: c.maxParticipants,
    }));
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
    const channelRecord: ChannelRecord = {
      id: uuidv4(),
      serverId: server.id,
      name: parseResult.data.name,
      type: parseResult.data.type,
      position: existingChannels.length,
      createdAt: Date.now(),
      maxParticipants: parseResult.data.maxParticipants || 10,
    };

    await this.channelRepo.create(channelRecord);

    const channelSummary: ChannelSummary = {
      id: channelRecord.id,
      serverId: channelRecord.serverId,
      name: channelRecord.name,
      type: channelRecord.type,
      position: channelRecord.position,
      createdAt: channelRecord.createdAt,
      maxParticipants: channelRecord.maxParticipants,
    };

    return {
      success: true,
      channel: channelSummary,
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
