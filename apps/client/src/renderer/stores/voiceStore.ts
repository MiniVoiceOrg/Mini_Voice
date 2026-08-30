import { appEvents } from '../core/EventBus';
import { emitOutsideRouting } from '../core/sessionRouting';
import { settingsStore } from './settingsStore';
import { clientLog } from '../core/ClientLogService';

export class VoiceStore {
  public currentVoiceChannelId: string | null = null;
  /**
   * Which server the active call lives on (#400). Voice is a single physical
   * resource, so it stays on the server where it started even while the user
   * browses another one; this is what tells the UI where to point them back to.
   */
  public voiceSessionKey: string | null = null;
  public isMuted: boolean = settingsStore.isMuted;
  public isDeafened: boolean = settingsStore.isDeafened;
  public serverMuted: boolean = false;
  public serverDeafened: boolean = false;
  private micMutedBeforeDeafen: boolean = false;
  public isSpeaking: boolean = false;
  public isCameraOn: boolean = false;
  /**
   * Ids of the local screen shares currently being broadcast (#253).
   * `isScreenSharing` is kept as a derived convenience flag so the many call
   * sites that only care about "am I sharing anything?" keep working.
   */
  public screenShareIds: string[] = [];
  public isScreenSharing: boolean = false;
  /** Share whose system audio is being captured, if any (#253: at most one). */
  public screenAudioShareId: string | null = null;

  /** Hard cap on simultaneous screen shares per participant (#253). */
  public static readonly MAX_SCREEN_SHARES = 2;

  public setChannel(channelId: string | null, sessionKey: string | null = null): void {
    clientLog.info('CONNECTION', `Voice channel ${channelId ? 'joined' : 'left'}`, { channelId, sessionKey });
    this.currentVoiceChannelId = channelId;
    if (channelId) {
      this.voiceSessionKey = sessionKey;
    } else {
      this.voiceSessionKey = null;
      this.isCameraOn = false;
      this.screenShareIds = [];
      this.isScreenSharing = false;
      this.screenAudioShareId = null;
      this.isSpeaking = false;
    }
    emitOutsideRouting(() => appEvents.emit('voice.channel_changed', channelId));
  }

  public setMuted(muted: boolean): void {
    clientLog.info('AUDIO', `Muted: ${muted}`);
    this.isMuted = muted;
    settingsStore.isMuted = muted;
    settingsStore.save();
    appEvents.emit('voice.state_updated');
  }

  public setDeafened(deafened: boolean): void {
    clientLog.info('AUDIO', `Deafened: ${deafened}`);
    if (deafened && !this.isDeafened) {
      // Entering deafen: remember whether the mic was already muted, then mute it.
      this.micMutedBeforeDeafen = this.isMuted;
      this.isMuted = true;
    } else if (!deafened && this.isDeafened) {
      // Leaving deafen: restore the mic only if it wasn't muted before deafening (#74).
      if (!this.micMutedBeforeDeafen) {
        this.isMuted = false;
      }
    }
    this.isDeafened = deafened;
    settingsStore.isDeafened = deafened;
    settingsStore.isMuted = this.isMuted;
    settingsStore.save();
    appEvents.emit('voice.state_updated');
  }

  public setServerMuted(muted: boolean): void {
    clientLog.warn('AUDIO', `Server muted: ${muted}`);
    this.serverMuted = muted;
    appEvents.emit('voice.state_updated');
  }

  public setServerDeafened(deafened: boolean): void {
    clientLog.warn('AUDIO', `Server deafened: ${deafened}`);
    this.serverDeafened = deafened;
    appEvents.emit('voice.state_updated');
  }

  public getEffectiveMuted(): boolean {
    return this.isMuted || this.serverMuted || this.isDeafened || this.serverDeafened;
  }

  public getEffectiveDeafened(): boolean {
    return this.isDeafened || this.serverDeafened;
  }

  public setSpeaking(speaking: boolean): void {
    if (this.isSpeaking !== speaking) {
      this.isSpeaking = speaking;
      appEvents.emit('voice.speaking_changed', speaking);
      appEvents.emit('voice.state_updated');
    }
  }

  public setCameraOn(on: boolean): void {
    this.isCameraOn = on;
    appEvents.emit('voice.state_updated');
  }

  public setScreenSharing(sharing: boolean): void {
    this.isScreenSharing = sharing;
    if (!sharing) {
      this.screenShareIds = [];
      this.screenAudioShareId = null;
    }
    appEvents.emit('voice.state_updated');
  }

  public addScreenShare(shareId: string): void {
    if (!this.screenShareIds.includes(shareId)) {
      this.screenShareIds.push(shareId);
    }
    this.isScreenSharing = this.screenShareIds.length > 0;
    appEvents.emit('voice.state_updated');
  }

  public removeScreenShare(shareId: string): void {
    this.screenShareIds = this.screenShareIds.filter((id) => id !== shareId);
    this.isScreenSharing = this.screenShareIds.length > 0;
    if (this.screenAudioShareId === shareId) {
      this.screenAudioShareId = null;
    }
    appEvents.emit('voice.state_updated');
  }

  public setScreenAudioShare(shareId: string | null): void {
    this.screenAudioShareId = shareId;
    appEvents.emit('voice.state_updated');
  }

  public canAddScreenShare(): boolean {
    return this.screenShareIds.length < VoiceStore.MAX_SCREEN_SHARES;
  }

  public reset(): void {
    const hadChannel = this.currentVoiceChannelId !== null;
    this.currentVoiceChannelId = null;
    this.voiceSessionKey = null;
    // Note (#358): isMuted and isDeafened are persistent user privacy states
    // and are deliberately NOT reset when leaving a channel, server, or call.
    this.serverMuted = false;
    this.serverDeafened = false;
    this.isSpeaking = false;
    this.isCameraOn = false;
    this.screenShareIds = [];
    this.isScreenSharing = false;
    this.screenAudioShareId = null;
    emitOutsideRouting(() => {
      appEvents.emit('voice.state_updated');
      // Ending a call is a channel change: without this the sidebar row and the
      // rail badge would linger when the call's server drops while the user is
      // looking at another one (#400).
      if (hadChannel) appEvents.emit('voice.channel_changed', null);
    });
  }
}

export const voiceStore = new VoiceStore();
