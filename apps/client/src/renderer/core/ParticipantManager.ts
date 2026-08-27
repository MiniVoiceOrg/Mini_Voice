import { UserSummary, VoiceParticipantState } from '@monky/shared';
import { appEvents } from './EventBus';

export interface ParticipantViewModel {
  user: UserSummary;
  voiceState?: VoiceParticipantState;
  remoteStream?: MediaStream;
  /** Remote screen streams keyed by share id (#253). */
  remoteScreenStreams: Map<string, MediaStream>;
  isSpeaking: boolean;
  isReconnecting?: boolean;
}

export class ParticipantManager {
  private participants: Map<string, ParticipantViewModel> = new Map();
  private updateScheduled = false;

  /**
   * Coalesces multiple rapid mutations (e.g. voice state + stream + speaking
   * changes during a voice join) into a single 'participants.updated' emit per
   * animation frame, avoiding redundant full re-renders of the sidebars.
   */
  private scheduleUpdate(): void {
    if (this.updateScheduled) return;
    this.updateScheduled = true;
    const flush = () => {
      this.updateScheduled = false;
      appEvents.emit('participants.updated');
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(flush);
    } else {
      setTimeout(flush, 0);
    }
  }

  public setUsers(users: UserSummary[]): void {
    for (const u of users) {
      this.addUser(u);
    }
  }

  public addUser(user: UserSummary): void {
    const existing = this.participants.get(user.id);
    if (existing) {
      existing.user = user;
      // A (re)join means the user is connected again.
      existing.isReconnecting = false;
    } else {
      this.participants.set(user.id, {
        user,
        isSpeaking: false,
        remoteScreenStreams: new Map(),
      });
    }
    this.scheduleUpdate();
  }

  public setReconnecting(userId: string, reconnecting: boolean): void {
    const participant = this.participants.get(userId);
    if (participant && participant.isReconnecting !== reconnecting) {
      participant.isReconnecting = reconnecting;
      this.scheduleUpdate();
    }
  }

  public removeUser(userId: string): void {
    this.participants.delete(userId);
    this.scheduleUpdate();
  }

  public updateUser(user: UserSummary): void {
    this.addUser(user);
  }

  public updateVoiceState(voiceState: VoiceParticipantState): void {
    const participant = this.participants.get(voiceState.userId);
    if (participant) {
      participant.voiceState = voiceState;
      participant.isSpeaking = voiceState.isSpeaking;
      this.scheduleUpdate();
    }
  }

  public removeVoiceState(userId: string): void {
    const participant = this.participants.get(userId);
    if (participant) {
      participant.voiceState = undefined;
      participant.isSpeaking = false;
      this.scheduleUpdate();
    }
  }

  public setRemoteStream(userId: string, stream: MediaStream): void {
    const participant = this.participants.get(userId);
    if (participant) {
      participant.remoteStream = stream;
      this.scheduleUpdate();
    }
  }

  public setRemoteScreenStream(userId: string, shareId: string, stream: MediaStream): void {
    const participant = this.participants.get(userId);
    if (participant) {
      participant.remoteScreenStreams.set(shareId, stream);
      this.scheduleUpdate();
    }
  }

  public removeRemoteScreenStream(userId: string, shareId: string): void {
    const participant = this.participants.get(userId);
    if (participant && participant.remoteScreenStreams.delete(shareId)) {
      this.scheduleUpdate();
    }
  }

  public setSpeaking(userId: string, speaking: boolean): void {
    const participant = this.participants.get(userId);
    if (participant && participant.isSpeaking !== speaking) {
      participant.isSpeaking = speaking;
      appEvents.emit('participants.speaking_changed', { userId, speaking });
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
    this.scheduleUpdate();
  }
}

export const participantManager = new ParticipantManager();
