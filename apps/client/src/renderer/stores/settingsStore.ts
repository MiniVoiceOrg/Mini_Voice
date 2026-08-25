import { QualityPresetType, QualityProfile, DEFAULT_CUSTOM_PROFILE } from '@monky/shared';
import { appEvents } from '../core/EventBus';

/**
 * Chat-notification-sound mode for the 3-level configuration (#153).
 * - `inherit`: fall back to the next level up (channel → server → global).
 * - `all`: play the cue for every message.
 * - `mentions`: play the cue only when the current user is @-mentioned.
 * - `none`: never play the cue.
 */
export type ChatSoundMode = 'inherit' | 'all' | 'mentions' | 'none';

/** The resolved (effective) mode, after `inherit` has been resolved away. */
export type ResolvedChatSoundMode = 'all' | 'mentions' | 'none';

const CHAT_SOUND_MODES: ChatSoundMode[] = ['inherit', 'all', 'mentions', 'none'];

export class SettingsStore {
  public qualityPreset: QualityPresetType = 'NORMAL';
  public customProfile: QualityProfile = { ...DEFAULT_CUSTOM_PROFILE };
  public vadSensitivity: number = 25; // 0 - 100
  public selectedMicrophoneId: string = '';
  public selectedSpeakerId: string = '';
  public selectedCameraId: string = '';
  public maxUploadKbps: number = 1000;
  public maxDownloadKbps: number = 2000;
  public userVolumes: Record<string, number> = {};
  public noiseSuppressionEnabled: boolean = true;
  public soundboardFolderPath: string = '';
  public soundboardVolume: number = 80; // 0 - 100
  public soundboardMuted: boolean = false;
  public screenAudioVolumes: Record<string, number> = {}; // per-user screen audio volume (#75)
  public screenShareTelemetryEnabled: boolean = false;
  public screenShareTelemetryPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' = 'top-right';
  public screenShareTelemetryMode: 'simple' | 'complete' = 'simple';
  public customSounds: Partial<Record<string, string>> = {}; // key → file path
  public soundboardShortcuts: Record<string, { accelerator: string; display: string }> = {};
  public chatMessageSoundEnabled: boolean = true; // play a cue when a chat message arrives (#152)
  public chatMessageSoundMentionsOnly: boolean = false; // only play the cue when you are mentioned (#153)
  public updateBetaChannel: boolean = false; // opt into receiving beta (pre-release) updates
  // Per-server / per-channel overrides of the global chat-sound mode (#153).
  // A missing entry (or 'inherit') means "use the level above".
  public chatSoundServerOverrides: Record<string, ChatSoundMode> = {};
  public chatSoundChannelOverrides: Record<string, ChatSoundMode> = {};

  constructor() {
    this.load();
  }

  public load(): void {
    try {
      const raw = localStorage.getItem('monky_settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        Object.assign(this, parsed);
        if (!this.userVolumes || typeof this.userVolumes !== 'object') {
          this.userVolumes = {};
        }
        if (typeof this.noiseSuppressionEnabled !== 'boolean') {
          this.noiseSuppressionEnabled = true;
        }
        if (typeof this.soundboardFolderPath !== 'string') {
          this.soundboardFolderPath = '';
        }
        if (typeof this.soundboardVolume !== 'number' || isNaN(this.soundboardVolume)) {
          this.soundboardVolume = 80;
        }
        if (typeof this.soundboardMuted !== 'boolean') {
          this.soundboardMuted = false;
        }
        if (!this.screenAudioVolumes || typeof this.screenAudioVolumes !== 'object') {
          this.screenAudioVolumes = {};
        }
        if (typeof this.screenShareTelemetryEnabled !== 'boolean') {
          this.screenShareTelemetryEnabled = false;
        }
        if (!['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(this.screenShareTelemetryPosition)) {
          this.screenShareTelemetryPosition = 'top-right';
        }
        if (!['simple', 'complete'].includes(this.screenShareTelemetryMode)) {
          this.screenShareTelemetryMode = 'simple';
        }
        if (!this.customProfile || typeof this.customProfile !== 'object' || !this.customProfile.audioBitrateKbps) {
          this.customProfile = { ...DEFAULT_CUSTOM_PROFILE };
        }
        if (!this.customSounds || typeof this.customSounds !== 'object') {
          this.customSounds = {};
        }
        if (!this.soundboardShortcuts || typeof this.soundboardShortcuts !== 'object') {
          this.soundboardShortcuts = {};
        }
        if (typeof this.chatMessageSoundEnabled !== 'boolean') {
          this.chatMessageSoundEnabled = true;
        }
        if (typeof this.chatMessageSoundMentionsOnly !== 'boolean') {
          this.chatMessageSoundMentionsOnly = false;
        }
        if (typeof this.updateBetaChannel !== 'boolean') {
          this.updateBetaChannel = false;
        }
        this.chatSoundServerOverrides = this.sanitizeModeMap(this.chatSoundServerOverrides);
        this.chatSoundChannelOverrides = this.sanitizeModeMap(this.chatSoundChannelOverrides);
      }
    } catch (e) {}
  }

  public getUserVolume(clientId: string): number {
    if (!clientId) return 100;
    const vol = this.userVolumes[clientId];
    return typeof vol === 'number' && !isNaN(vol) ? Math.max(0, Math.min(100, vol)) : 100;
  }

  public setUserVolume(clientId: string, volume: number): void {
    if (!clientId) return;
    const clamped = Math.max(0, Math.min(100, Math.round(volume)));
    this.userVolumes[clientId] = clamped;
    this.save();
    appEvents.emit('user_volume.changed', { clientId, volume: clamped });
  }

  public getScreenAudioVolume(clientId: string): number {
    if (!clientId) return 100;
    const vol = this.screenAudioVolumes[clientId];
    return typeof vol === 'number' && !isNaN(vol) ? Math.max(0, Math.min(100, vol)) : 100;
  }

  public setScreenAudioVolume(clientId: string, volume: number): void {
    if (!clientId) return;
    const clamped = Math.max(0, Math.min(100, Math.round(volume)));
    this.screenAudioVolumes[clientId] = clamped;
    this.save();
    appEvents.emit('screen_audio_volume.changed', { clientId, volume: clamped });
  }

  /** Keep only valid { id: ChatSoundMode } entries, dropping 'inherit'/garbage (#153). */
  private sanitizeModeMap(map: unknown): Record<string, ChatSoundMode> {
    const result: Record<string, ChatSoundMode> = {};
    if (map && typeof map === 'object') {
      for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
        if (typeof value === 'string' && CHAT_SOUND_MODES.includes(value as ChatSoundMode) && value !== 'inherit') {
          result[key] = value as ChatSoundMode;
        }
      }
    }
    return result;
  }

  /** The global (GERAL) chat-sound mode, derived from the app-wide toggles (#153). */
  public getGlobalChatSoundMode(): ResolvedChatSoundMode {
    if (!this.chatMessageSoundEnabled) return 'none';
    return this.chatMessageSoundMentionsOnly ? 'mentions' : 'all';
  }

  public getServerChatSoundOverride(serverId: string | undefined): ChatSoundMode {
    if (!serverId) return 'inherit';
    return this.chatSoundServerOverrides[serverId] ?? 'inherit';
  }

  public setServerChatSoundOverride(serverId: string, mode: ChatSoundMode): void {
    if (!serverId) return;
    if (mode === 'inherit') delete this.chatSoundServerOverrides[serverId];
    else this.chatSoundServerOverrides[serverId] = mode;
    this.save();
  }

  public getChannelChatSoundOverride(channelId: string | undefined): ChatSoundMode {
    if (!channelId) return 'inherit';
    return this.chatSoundChannelOverrides[channelId] ?? 'inherit';
  }

  public setChannelChatSoundOverride(channelId: string, mode: ChatSoundMode): void {
    if (!channelId) return;
    if (mode === 'inherit') delete this.chatSoundChannelOverrides[channelId];
    else this.chatSoundChannelOverrides[channelId] = mode;
    this.save();
  }

  /**
   * Resolve the effective chat-sound mode for a message, applying the 3-level
   * precedence channel → server → global (#153).
   */
  public getEffectiveChatSoundMode(
    serverId: string | undefined,
    channelId: string | undefined
  ): ResolvedChatSoundMode {
    const channelMode = this.getChannelChatSoundOverride(channelId);
    if (channelMode !== 'inherit') return channelMode;
    const serverMode = this.getServerChatSoundOverride(serverId);
    if (serverMode !== 'inherit') return serverMode;
    return this.getGlobalChatSoundMode();
  }

  public save(): void {
    try {
      localStorage.setItem('monky_settings', JSON.stringify({
        qualityPreset: this.qualityPreset,
        vadSensitivity: this.vadSensitivity,
        selectedMicrophoneId: this.selectedMicrophoneId,
        selectedSpeakerId: this.selectedSpeakerId,
        selectedCameraId: this.selectedCameraId,
        maxUploadKbps: this.maxUploadKbps,
        maxDownloadKbps: this.maxDownloadKbps,
        userVolumes: this.userVolumes,
        noiseSuppressionEnabled: this.noiseSuppressionEnabled,
        soundboardFolderPath: this.soundboardFolderPath,
        soundboardVolume: this.soundboardVolume,
        soundboardMuted: this.soundboardMuted,
        screenAudioVolumes: this.screenAudioVolumes,
        screenShareTelemetryEnabled: this.screenShareTelemetryEnabled,
        screenShareTelemetryPosition: this.screenShareTelemetryPosition,
        screenShareTelemetryMode: this.screenShareTelemetryMode,
        customProfile: this.customProfile,
        customSounds: this.customSounds,
        soundboardShortcuts: this.soundboardShortcuts,
        chatMessageSoundEnabled: this.chatMessageSoundEnabled,
        chatMessageSoundMentionsOnly: this.chatMessageSoundMentionsOnly,
        updateBetaChannel: this.updateBetaChannel,
        chatSoundServerOverrides: this.chatSoundServerOverrides,
        chatSoundChannelOverrides: this.chatSoundChannelOverrides,
      }));
      appEvents.emit('settings.updated');
    } catch (e) {}
  }
}

export const settingsStore = new SettingsStore();
