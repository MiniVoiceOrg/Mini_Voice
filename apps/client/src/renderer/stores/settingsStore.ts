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

  constructor() {
    this.load();
  }

  public load(): void {
    try {
      const raw = localStorage.getItem('mini_voice_settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        Object.assign(this, parsed);
      }
    } catch (e) {}
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
      }));
      appEvents.emit('settings.updated');
    } catch (e) {}
  }
}

export const settingsStore = new SettingsStore();
