import { QualityPresetType, QualityProfile, DEFAULT_CUSTOM_PROFILE } from '@mini-voice/shared';
import { appEvents } from '../core/EventBus';

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

  constructor() {
    this.load();
  }

  public load(): void {
    try {
      const raw = localStorage.getItem('mini_voice_settings');
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

  public save(): void {
    try {
      localStorage.setItem('mini_voice_settings', JSON.stringify({
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
      }));
      appEvents.emit('settings.updated');
    } catch (e) {}
  }
}

export const settingsStore = new SettingsStore();
