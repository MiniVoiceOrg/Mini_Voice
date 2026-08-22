import { appEvents } from './EventBus';
import { settingsStore } from '../stores/settingsStore';
import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

export class AudioProcessor {
  private rawMicStream: MediaStream | null = null;
  private localStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphoneSource: MediaStreamAudioSourceNode | null = null;
  private rnnoiseNode: RnnoiseWorkletNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;

  private vadInterval: any = null;
  private isSpeaking: boolean = false;
  private vadThreshold: number = settingsStore.vadSensitivity !== undefined ? settingsStore.vadSensitivity : 14;
  private isMuted: boolean = false;
  private isDeafened: boolean = false;

  private cachedWasmBinary: ArrayBuffer | null = null;
  private isWorkletModuleLoaded: boolean = false;

  public async startMicrophone(deviceId?: string): Promise<MediaStream> {
    this.stopMicrophone();

    const targetDeviceId = deviceId || settingsStore.selectedMicrophoneId || undefined;
    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: targetDeviceId ? { exact: targetDeviceId } : undefined,
        echoCancellation: true,
        // If RNNoise is active, we avoid double-processing artifacts by turning off standard browser NS
        noiseSuppression: !settingsStore.noiseSuppressionEnabled,
        autoGainControl: true,
      },
      video: false,
    };

    try {
      this.rawMicStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err: any) {
      if (targetDeviceId) {
        console.warn('[AudioProcessor] Could not open specific mic, falling back to default mic:', err);
        this.rawMicStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: !settingsStore.noiseSuppressionEnabled,
            autoGainControl: true,
          },
          video: false,
        });
      } else {
        throw err;
      }
    }

    // Setup Web Audio graph (RNNoise + VAD + Destination stream)
    await this.setupAudioGraph(this.rawMicStream);
    return this.localStream || this.rawMicStream;
  }

  private async loadWasmBinary(): Promise<ArrayBuffer | null> {
    if (this.cachedWasmBinary) return this.cachedWasmBinary;
    try {
      this.cachedWasmBinary = await loadRnnoise({
        url: rnnoiseWasmUrl,
        simdUrl: rnnoiseSimdWasmUrl,
      });
      return this.cachedWasmBinary;
    } catch (err) {
      console.warn('[AudioProcessor] Could not load RNNoise WASM binary:', err);
      return null;
    }
  }

  private async setupAudioGraph(rawStream: MediaStream): Promise<void> {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      // RNNoise operates on 48kHz audio frames
      this.audioContext = new AudioCtx({ sampleRate: 48000 });
      if (this.audioContext.state !== 'running') {
        this.audioContext.resume().catch(() => {});
      }

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.25;

      this.destinationNode = this.audioContext.createMediaStreamDestination();
      this.microphoneSource = this.audioContext.createMediaStreamSource(rawStream);

      const rnnoiseWanted = settingsStore.noiseSuppressionEnabled;
      let rnnoiseApplied = false;

      if (rnnoiseWanted) {
        const wasm = await this.loadWasmBinary();
        if (wasm) {
          if (!this.isWorkletModuleLoaded) {
            await this.audioContext.audioWorklet.addModule(rnnoiseWorkletUrl);
            this.isWorkletModuleLoaded = true;
          }
          this.rnnoiseNode = new RnnoiseWorkletNode(this.audioContext, {
            maxChannels: 1,
            wasmBinary: wasm,
          });

          this.microphoneSource.connect(this.rnnoiseNode);
          this.rnnoiseNode.connect(this.destinationNode);
          this.rnnoiseNode.connect(this.analyser);
          rnnoiseApplied = true;
          console.log('[AudioProcessor] RNNoise Neural Noise Suppression successfully initialized.');
        }
      }

      if (!rnnoiseApplied) {
        this.microphoneSource.connect(this.destinationNode);
        this.microphoneSource.connect(this.analyser);
        console.log('[AudioProcessor] Standard audio routing initialized.');
      }

      this.localStream = this.destinationNode.stream;
      this.startVadLoop();
    } catch (err) {
      console.warn('[AudioProcessor] AudioContext graph setup failed, falling back to raw stream:', err);
      this.localStream = rawStream;
    }
  }

  public async setNoiseSuppression(enabled: boolean): Promise<void> {
    if (!this.audioContext || !this.microphoneSource || !this.destinationNode || !this.analyser) {
      return;
    }

    try {
      // Disconnect previous audio graph nodes
      try {
        this.microphoneSource.disconnect();
      } catch {}
      if (this.rnnoiseNode) {
        try {
          this.rnnoiseNode.disconnect();
        } catch {}
      }

      if (enabled) {
        const wasm = await this.loadWasmBinary();
        if (wasm) {
          if (!this.isWorkletModuleLoaded) {
            await this.audioContext.audioWorklet.addModule(rnnoiseWorkletUrl);
            this.isWorkletModuleLoaded = true;
          }
          if (!this.rnnoiseNode) {
            this.rnnoiseNode = new RnnoiseWorkletNode(this.audioContext, {
              maxChannels: 1,
              wasmBinary: wasm,
            });
          }

          this.microphoneSource.connect(this.rnnoiseNode);
          this.rnnoiseNode.connect(this.destinationNode);
          this.rnnoiseNode.connect(this.analyser);
          console.log('[AudioProcessor] Switched to RNNoise Neural Noise Suppression.');
          return;
        }
      }

      // If disabled or RNNoise unavailable, route directly to destination
      this.microphoneSource.connect(this.destinationNode);
      this.microphoneSource.connect(this.analyser);
      console.log('[AudioProcessor] Switched to standard/direct audio routing.');
    } catch (err) {
      console.warn('[AudioProcessor] Error switching noise suppression mode:', err);
    }
  }

  private startVadLoop(): void {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }

    if (!this.analyser) return;

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
  }

  private setSpeaking(speaking: boolean): void {
    if (this.isSpeaking !== speaking) {
      this.isSpeaking = speaking;
      appEvents.emit('local.speaking', speaking);
    }
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.rawMicStream) {
      this.rawMicStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
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
    return this.localStream || this.rawMicStream;
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
    if (this.rnnoiseNode) {
      try {
        this.rnnoiseNode.destroy();
      } catch {}
      this.rnnoiseNode = null;
    }
    if (this.microphoneSource) {
      try {
        this.microphoneSource.disconnect();
      } catch {}
      this.microphoneSource = null;
    }
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {}
      this.analyser = null;
    }
    if (this.destinationNode) {
      try {
        this.destinationNode.disconnect();
      } catch {}
      this.destinationNode = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.rawMicStream) {
      this.rawMicStream.getTracks().forEach((t) => t.stop());
      this.rawMicStream = null;
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

