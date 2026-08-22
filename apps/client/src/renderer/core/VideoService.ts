import { QUALITY_PRESETS, QualityProfile, QualityPresetType } from '@mini-voice/shared';
import { appEvents } from './EventBus';
import { settingsStore } from '../stores/settingsStore';

export class VideoService {
  private cameraStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private currentPreset: QualityPresetType = 'NORMAL';

  public setQualityPreset(preset: QualityPresetType): void {
    this.currentPreset = preset;
  }

  public getProfile(): QualityProfile {
    if (this.currentPreset === 'CUSTOM') return settingsStore.customProfile;
    return QUALITY_PRESETS[this.currentPreset];
  }

  public async startCamera(deviceId?: string): Promise<MediaStream> {
    this.stopCamera();

    const profile = this.getProfile();
    const targetDeviceId = deviceId || settingsStore.selectedCameraId || undefined;
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: {
        deviceId: targetDeviceId ? { exact: targetDeviceId } : undefined,
        width: { ideal: profile.cameraWidth },
        height: { ideal: profile.cameraHeight },
        frameRate: { ideal: profile.cameraFps, max: profile.cameraFps },
      },
    };

    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err: any) {
      if (targetDeviceId) {
        console.warn('[VideoService] Could not open specific camera, falling back to default camera:', err);
        this.cameraStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: { ideal: profile.cameraWidth },
            height: { ideal: profile.cameraHeight },
            frameRate: { ideal: profile.cameraFps, max: profile.cameraFps },
          },
        });
      } else {
        throw err;
      }
    }
    appEvents.emit('local.camera_started', this.cameraStream);
    return this.cameraStream;
  }

  public stopCamera(): void {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((t) => t.stop());
      this.cameraStream = null;
      appEvents.emit('local.camera_stopped');
    }
  }

  public async startScreenShare(sourceId?: string): Promise<MediaStream> {
    this.stopScreenShare();

    const profile = this.getProfile();

    if (sourceId) {
      // Electron desktopCapturer source
      const constraints: any = {
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            maxWidth: profile.screenWidth,
            maxHeight: profile.screenHeight,
            maxFrameRate: profile.screenFps,
          },
        },
      };

      this.screenStream = await (navigator.mediaDevices as any).getUserMedia(constraints);
    } else {
      // Standard DisplayMedia fallback
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: profile.screenWidth },
          height: { ideal: profile.screenHeight },
          frameRate: { ideal: profile.screenFps, max: profile.screenFps },
        },
        audio: false,
      });
    }

    // Auto-detect when user stops sharing via browser UI
    const screenTrack = this.screenStream!.getVideoTracks()[0];

    // Hint the encoder about the content type so it optimizes correctly:
    // gaming favors fluid motion, desktop sharing favors sharp detail.
    screenTrack.contentHint = this.currentPreset === 'GAMING' ? 'motion' : 'detail';

    screenTrack.onended = () => {
      this.stopScreenShare();
    };

    appEvents.emit('local.screen_started', this.screenStream);
    return this.screenStream!;
  }

  public stopScreenShare(): void {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
      appEvents.emit('local.screen_stopped');
    }
  }

  public getCameraStream(): MediaStream | null {
    return this.cameraStream;
  }

  public getScreenStream(): MediaStream | null {
    return this.screenStream;
  }
}

export const videoService = new VideoService();
