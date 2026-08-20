import { appEvents } from './EventBus';
import { settingsStore } from '../stores/settingsStore';

export class AudioProcessor {
  private localStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphoneSource: MediaStreamAudioSourceNode | null = null;
  private vadInterval: any = null;
  private isSpeaking: boolean = false;
  private vadThreshold: number = 25; // 0 - 100 sensitivity threshold
  private isMuted: boolean = false;
  private isDeafened: boolean = false;

  public async startMicrophone(deviceId?: string): Promise<MediaStream> {
    this.stopMicrophone();

    const targetDeviceId = deviceId || settingsStore.selectedMicrophoneId || undefined;
    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: targetDeviceId ? { exact: targetDeviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    };

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err: any) {
      if (targetDeviceId) {
        console.warn('[AudioProcessor] Could not open specific mic, falling back to default mic:', err);
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
      } else {
        throw err;
      }
    }

    // Setup VAD
    this.setupVad(this.localStream);
    return this.localStream;
  }

  private setupVad(stream: MediaStream): void {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.4;

      this.microphoneSource = this.audioContext.createMediaStreamSource(stream);
      this.microphoneSource.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      let silenceCounter = 0;

      this.vadInterval = setInterval(() => {
        if (!this.analyser || this.isMuted) {
          if (this.isSpeaking) {
            this.setSpeaking(false);
          }
          return;
        }

        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;

        if (average > this.vadThreshold) {
          silenceCounter = 0;
          if (!this.isSpeaking) {
            this.setSpeaking(true);
          }
        } else {
          silenceCounter++;
          // Require 3 consecutive cycles of silence before toggling off to prevent flickering
          if (silenceCounter > 3 && this.isSpeaking) {
            this.setSpeaking(false);
          }
        }
      }, 80);
    } catch (err) {
      console.warn('Could not initialize AudioContext for VAD:', err);
    }
  }

  private setSpeaking(speaking: boolean): void {
    this.isSpeaking = speaking;
    appEvents.emit('local.speaking', speaking);
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
    if (muted && this.isSpeaking) {
      this.setSpeaking(false);
    }
    appEvents.emit('local.muted', muted);
  }

  public setDeafened(deafened: boolean): void {
    this.isDeafened = deafened;
    // When deafened, also mute microphone
    if (deafened && !this.isMuted) {
      this.setMuted(true);
    }
    appEvents.emit('local.deafened', deafened);
  }

  public setVadThreshold(threshold: number): void {
    this.vadThreshold = Math.max(0, Math.min(100, threshold));
  }

  public getLocalAudioStream(): MediaStream | null {
    return this.localStream;
  }

  public stopMicrophone(): void {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    if (this.isSpeaking) {
      this.setSpeaking(false);
    }
  }
}

export const audioProcessor = new AudioProcessor();
