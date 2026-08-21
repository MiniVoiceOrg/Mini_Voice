import { appEvents } from './EventBus';
import { settingsStore } from '../stores/settingsStore';

export class AudioProcessor {
  private localStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphoneSource: MediaStreamAudioSourceNode | null = null;
  private vadInterval: any = null;
  private isSpeaking: boolean = false;
  private vadThreshold: number = settingsStore.vadSensitivity !== undefined ? settingsStore.vadSensitivity : 14;
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
      if (this.audioContext.state !== 'running') {
        this.audioContext.resume().catch(() => {});
      }
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.25;

      this.microphoneSource = this.audioContext.createMediaStreamSource(stream);
      this.microphoneSource.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      const speechBins = Math.min(36, bufferLength);

      let silenceCounter = 0;

      this.vadInterval = setInterval(() => {
        if (!this.analyser || this.isMuted) {
          if (this.isSpeaking) {
            this.setSpeaking(false);
          }
          return;
        }

        if (this.audioContext && this.audioContext.state === 'suspended') {
          this.audioContext.resume().catch(() => {});
        }

        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < speechBins; i++) {
          const val = dataArray[i];
          sum += val;
          if (val > peak) peak = val;
        }
        const average = sum / speechBins;

        // Calibrated threshold: filters background mic hiss while activating reliably when talking
        const targetAvg = Math.max(16, this.vadThreshold * 0.8);
        const targetPeak = Math.max(42, this.vadThreshold * 1.8);
        const isVoiceActive = (average > targetAvg && peak > targetPeak) || average > (targetAvg * 1.4);

        if (isVoiceActive) {
          silenceCounter = 0;
          if (!this.isSpeaking) {
            this.setSpeaking(true);
          }
        } else {
          silenceCounter++;
          // 4 cycles (~200ms) of silence before turning off to avoid jitter between words
          if (silenceCounter > 4 && this.isSpeaking) {
            this.setSpeaking(false);
          }
        }
      }, 50);
    } catch (err) {
      console.warn('Could not initialize AudioContext for VAD:', err);
    }
  }

  private setSpeaking(speaking: boolean): void {
    if (this.isSpeaking !== speaking) {
      this.isSpeaking = speaking;
      appEvents.emit('local.speaking', speaking);
    }
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

  /**
   * Returns the current microphone input level (0..100) from the active VAD
   * analyser, or -1 when the microphone is not currently active. Used by the
   * settings UI to draw a live level meter next to the sensitivity slider.
   */
  public getInputLevel(): number {
    if (!this.analyser || this.isMuted) return -1;
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);
    const speechBins = Math.min(36, bufferLength);
    let sum = 0;
    for (let i = 0; i < speechBins; i++) sum += dataArray[i];
    return sum / speechBins;
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
