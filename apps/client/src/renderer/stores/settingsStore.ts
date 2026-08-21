import { QualityPresetType } from '@mini-voice/shared';
import { appEvents } from '../core/EventBus';

export class SettingsStore {
  public qualityPreset: QualityPresetType = 'NORMAL';
  public vadSensitivity: number = 25; // 0 - 100
  public selectedMicrophoneId: string = '';
  public selectedSpeakerId: string = '';
  public selectedCameraId: string = '';
  public maxUploadKbps: number = 1000;
  public maxDownloadKbps: number = 2000;
  public userVolumes: Record<string, number> = {};

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
      }));
      appEvents.emit('settings.updated');
    } catch (e) {}
  }
}

export const settingsStore = new SettingsStore();
