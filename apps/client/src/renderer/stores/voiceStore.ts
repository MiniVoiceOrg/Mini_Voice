import { appEvents } from '../core/EventBus';

export class VoiceStore {
  public currentVoiceChannelId: string | null = null;
  public isMuted: boolean = false;
  public isDeafened: boolean = false;
  public isSpeaking: boolean = false;
  public isCameraOn: boolean = false;
  public isScreenSharing: boolean = false;

  public setChannel(channelId: string | null): void {
    this.currentVoiceChannelId = channelId;
    if (!channelId) {
      this.isCameraOn = false;
      this.isScreenSharing = false;
      this.isSpeaking = false;
    }
    appEvents.emit('voice.channel_changed', channelId);
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    appEvents.emit('voice.state_updated');
  }

  public setDeafened(deafened: boolean): void {
    this.isDeafened = deafened;
    if (deafened) {
      this.isMuted = true;
    }
    appEvents.emit('voice.state_updated');
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
    appEvents.emit('voice.state_updated');
  }

  public reset(): void {
    this.currentVoiceChannelId = null;
    this.isMuted = false;
    this.isDeafened = false;
    this.isSpeaking = false;
    this.isCameraOn = false;
    this.isScreenSharing = false;
    appEvents.emit('voice.state_updated');
  }
}

export const voiceStore = new VoiceStore();
