import { UserSummary, VoiceParticipantState } from '@mini-voice/shared';
import { appEvents } from './EventBus';

export interface ParticipantViewModel {
  user: UserSummary;
  voiceState?: VoiceParticipantState;
  remoteStream?: MediaStream;
  isSpeaking: boolean;
}

export class ParticipantManager {
  private participants: Map<string, ParticipantViewModel> = new Map();

  public setUsers(users: UserSummary[]): void {
    for (const u of users) {
      this.addUser(u);
    }
  }

  public addUser(user: UserSummary): void {
    const existing = this.participants.get(user.id);
    if (existing) {
      existing.user = user;
    } else {
      this.participants.set(user.id, {
        user,
        isSpeaking: false,
      });
    }
    appEvents.emit('participants.updated');
  }

  public removeUser(userId: string): void {
    this.participants.delete(userId);
    appEvents.emit('participants.updated');
  }

  public updateUser(user: UserSummary): void {
    this.addUser(user);
  }

  public updateVoiceState(voiceState: VoiceParticipantState): void {
    const participant = this.participants.get(voiceState.userId);
    if (participant) {
      participant.voiceState = voiceState;
      participant.isSpeaking = voiceState.isSpeaking;
      appEvents.emit('participants.updated');
    }
  }

  public removeVoiceState(userId: string): void {
    const participant = this.participants.get(userId);
    if (participant) {
      participant.voiceState = undefined;
      participant.isSpeaking = false;
      appEvents.emit('participants.updated');
    }
  }

  public setRemoteStream(userId: string, stream: MediaStream): void {
    const participant = this.participants.get(userId);
    if (participant) {
      participant.remoteStream = stream;
      appEvents.emit('participants.updated');
    }
  }

  public setSpeaking(userId: string, speaking: boolean): void {
    const participant = this.participants.get(userId);
    if (participant && participant.isSpeaking !== speaking) {
      participant.isSpeaking = speaking;
      appEvents.emit('participants.updated');
    }
  }

  public get(userId: string): ParticipantViewModel | undefined {
    return this.participants.get(userId);
  }

  public getAll(): ParticipantViewModel[] {
    return Array.from(this.participants.values());
  }

  public getInVoiceChannel(channelId: string): ParticipantViewModel[] {
    return this.getAll().filter((p) => p.voiceState?.channelId === channelId);
  }

  public clear(): void {
    this.participants.clear();
    appEvents.emit('participants.updated');
  }
}

export const participantManager = new ParticipantManager();
