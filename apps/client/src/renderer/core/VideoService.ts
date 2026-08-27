import { QUALITY_PRESETS, QualityProfile, QualityPresetType } from '@monky/shared';
import { appEvents } from './EventBus';
import { settingsStore } from '../stores/settingsStore';

export class VideoService {
  private cameraStream: MediaStream | null = null;
  /**
   * Active screen shares keyed by share id (#253). The share id is the
   * MediaStream id, which is also what gets announced to peers over
   * `screen-video-meta`, so the same handle identifies the share locally,
   * on the wire and in the remote UI.
   */
  private screenStreams: Map<string, MediaStream> = new Map();
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
    const profile = this.getProfile();
    let stream: MediaStream;

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

      stream = await (navigator.mediaDevices as any).getUserMedia(constraints);
    } else {
      // Standard DisplayMedia fallback
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: profile.screenWidth },
          height: { ideal: profile.screenHeight },
          frameRate: { ideal: profile.screenFps, max: profile.screenFps },
        },
        audio: false,
      });
    }

    const shareId = stream.id;
    this.screenStreams.set(shareId, stream);

    // Auto-detect when user stops sharing via browser UI
    const screenTrack = stream.getVideoTracks()[0];

    // Hint the encoder about the content type so it optimizes correctly:
    // gaming favors fluid motion, desktop sharing favors sharp detail.
    screenTrack.contentHint = this.currentPreset === 'GAMING' ? 'motion' : 'detail';

    screenTrack.onended = () => {
      // Fires only when the track ends on its own — e.g. the shared window/app
      // was closed or the user pressed the OS "stop sharing" button — never
      // when we call stopScreenShare() ourselves. Let listeners fully tear the
      // share down (peers, WebRTC sender, UI) before we stop locally (#159).
      appEvents.emit('local.screen_ended_externally', shareId);
      this.stopScreenShare(shareId);
    };

    appEvents.emit('local.screen_started', { shareId, stream });
    return stream;
  }

  /**
   * Stops one screen share, or every active share when no id is given (#253).
   */
  public stopScreenShare(shareId?: string): void {
    const ids = shareId ? [shareId] : [...this.screenStreams.keys()];
    for (const id of ids) {
      const stream = this.screenStreams.get(id);
      if (!stream) continue;
      // Drop the handler first: stopping the track fires `onended` on some
      // platforms, which would re-enter this method and emit a bogus
      // "ended externally" event (#159).
      stream.getVideoTracks().forEach((t) => { t.onended = null; });
      stream.getTracks().forEach((t) => t.stop());
      this.screenStreams.delete(id);
      appEvents.emit('local.screen_stopped', id);
    }
  }

  public getCameraStream(): MediaStream | null {
    return this.cameraStream;
  }

  public getScreenStream(shareId: string): MediaStream | null {
    return this.screenStreams.get(shareId) ?? null;
  }

  public getScreenShareIds(): string[] {
    return [...this.screenStreams.keys()];
  }

  public getScreenShareCount(): number {
    return this.screenStreams.size;
  }
}

export const videoService = new VideoService();
