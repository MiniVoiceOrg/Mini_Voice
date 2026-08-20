import {
  ProtocolErrorCode,
  VoiceParticipantState,
  WebRtcSignalPayload,
} from '@mini-voice/shared';
import { IChannelRepository } from '../../domain/repositories';
import { Logger } from '../../infrastructure/logger/Logger';

export class SignalingService {
  // Map of userId -> VoiceParticipantState
  private voiceStates: Map<string, VoiceParticipantState> = new Map();

  constructor(private channelRepo: IChannelRepository) {}

  public async joinVoiceChannel(
    userId: string,
    channelId: string
  ): Promise<{
    success: boolean;
    errorCode?: ProtocolErrorCode;
    errorMessage?: string;
    voiceState?: VoiceParticipantState;
    existingParticipants?: VoiceParticipantState[];
  }> {
    const channel = await this.channelRepo.findById(channelId);
    if (!channel || channel.type !== 'VOICE') {
      return {
        success: false,
        errorCode: ProtocolErrorCode.CHANNEL_NOT_FOUND,
        errorMessage: 'Canal de voz não encontrado',
      };
    }

    // Check channel capacity
    const currentInChannel = this.getParticipantsInChannel(channelId);
    if (currentInChannel.length >= channel.maxParticipants) {
      return {
        success: false,
        errorCode: ProtocolErrorCode.CHANNEL_FULL,
        errorMessage: `Canal de voz está cheio (${channel.maxParticipants} participantes max).`,
      };
    }

    // If user was already in another voice channel, leave first
    const previousState = this.voiceStates.get(userId);
    const existingParticipants = [...currentInChannel];

    const newState: VoiceParticipantState = {
      userId,
      channelId,
      isMuted: previousState?.isMuted ?? false,
      isDeafened: previousState?.isDeafened ?? false,
      isSpeaking: false,
      isCameraOn: false,
      isScreenSharing: false,
    };

    this.voiceStates.set(userId, newState);
    Logger.info('WEBRTC', `User ${userId} joined voice channel ${channelId}`);

    return {
      success: true,
      voiceState: newState,
      existingParticipants,
    };
  }

  public leaveVoiceChannel(userId: string): VoiceParticipantState | null {
    const current = this.voiceStates.get(userId);
    if (current) {
      this.voiceStates.delete(userId);
      Logger.info('WEBRTC', `User ${userId} left voice channel ${current.channelId}`);
      return current;
    }
    return null;
  }

  public updateVoiceState(
    userId: string,
    updates: Partial<VoiceParticipantState>
  ): VoiceParticipantState | null {
    const current = this.voiceStates.get(userId);
    if (!current) return null;

    const updated: VoiceParticipantState = {
      ...current,
      ...updates,
      userId: current.userId,
      channelId: current.channelId,
    };

    this.voiceStates.set(userId, updated);
    return updated;
  }

  public getVoiceState(userId: string): VoiceParticipantState | undefined {
    return this.voiceStates.get(userId);
  }

  public getParticipantsInChannel(channelId: string): VoiceParticipantState[] {
    const list: VoiceParticipantState[] = [];
    for (const state of this.voiceStates.values()) {
      if (state.channelId === channelId) {
        list.push(state);
      }
    }
    return list;
  }

  public getAllVoiceStates(): Record<string, VoiceParticipantState> {
    const obj: Record<string, VoiceParticipantState> = {};
    for (const [userId, state] of this.voiceStates.entries()) {
      obj[userId] = state;
    }
    return obj;
  }

  public validateSignalRouting(signal: WebRtcSignalPayload): boolean {
    const fromState = this.voiceStates.get(signal.fromUserId);
    const targetState = this.voiceStates.get(signal.targetUserId);

    if (!fromState || !targetState) {
      return false;
    }

    // Peers must be in the same voice channel to exchange WebRTC signals
    return fromState.channelId === targetState.channelId;
  }
}
