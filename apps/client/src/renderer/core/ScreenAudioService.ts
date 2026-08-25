/**
 * ScreenAudioService
 *
 * Bridges the native screen audio capture module (via preload IPC) with WebRTC.
 * Receives raw PCM float32 frames from main process, feeds them into an
 * AudioWorklet ring buffer, and outputs a MediaStreamTrack that can be added
 * to peer connections.
 *
 * Includes a test-tone mode (440 Hz sine wave) that bypasses the native module
 * entirely, useful for validating the WebRTC pipeline end-to-end.
 *
 * Part of #55 (screen audio) and #75 (per-user volume).
 */

import { appEvents } from './EventBus';
import { webRtcManager } from './WebRtcManager';
import { networkClient } from './NetworkClient';
import { MessageType } from '@mini-voice/shared';
import { t } from '../i18n';

// Ring-buffer based AudioWorklet processor (inlined as a string so it can be
// loaded via Blob URL without a separate file).
const RING_BUFFER_SIZE = 48000 * 2 * 4; // ~4 s of stereo 48 kHz
const WORKLET_CODE = `
class ScreenAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(${RING_BUFFER_SIZE});
    this.writePos = 0;
    this.readPos = 0;
    this.available = 0;

    this.port.onmessage = (e) => {
      if (e.data.type === 'pcm-data') {
        const samples = e.data.samples;
        const len = samples.length;
        const cap = this.ring.length;
        for (let i = 0; i < len; i++) {
          this.ring[this.writePos] = samples[i];
          this.writePos = (this.writePos + 1) % cap;
        }
        this.available += len;
        if (this.available > cap) this.available = cap;
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const channels = output.length;
    const frameSize = output[0].length;
    const samplesNeeded = frameSize * channels;
    const cap = this.ring.length;

    if (this.available >= samplesNeeded) {
      for (let i = 0; i < frameSize; i++) {
        for (let ch = 0; ch < channels; ch++) {
          output[ch][i] = this.ring[this.readPos];
          this.readPos = (this.readPos + 1) % cap;
        }
      }
      this.available -= samplesNeeded;
    } else {
      for (let ch = 0; ch < channels; ch++) {
        output[ch].fill(0);
      }
    }
    return true;
  }
}
registerProcessor('screen-audio-processor', ScreenAudioProcessor);
`;

// Seconds to wait for the first native frame before warning the user
const FRAME_WATCHDOG_TIMEOUT = 5;

class ScreenAudioService {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private outputTrack: MediaStreamTrack | null = null;
  private isCapturing: boolean = false;
  private isTestTone: boolean = false;
  private frameCount: number = 0;
  private testToneInterval: ReturnType<typeof setInterval> | null = null;
  private frameWatchdog: ReturnType<typeof setTimeout> | null = null;

  public async isSupported(): Promise<boolean> {
    return window.api.screenAudioSupported();
  }

  /**
   * Return diagnostic information about the screen audio subsystem.
   */
  public async diagnose(): Promise<Record<string, unknown>> {
    const supported = await this.isSupported();
    const diag = await window.api.screenAudioDiagnose();
    return {
      nativeModuleLoaded: diag.nativeModuleLoaded,
      platformSupported: supported,
      osVersion: diag.osVersion,
      isCapturing: this.isCapturing,
      isTestTone: this.isTestTone,
      framesReceived: this.frameCount,
    };
  }

  // ────────────────────────────────────────────
  //  Shared pipeline setup (used by both modes)
  // ────────────────────────────────────────────

  private async setupPipeline(): Promise<void> {
    this.audioContext = new AudioContext({ sampleRate: 48000 });
    // A suspended context produces a silent output track even though frames are
    // being fed to the worklet. Ensure it is running.
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume().catch(() => {});
    }

    const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    await this.audioContext.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    this.workletNode = new AudioWorkletNode(this.audioContext, 'screen-audio-processor', {
      outputChannelCount: [2],
      numberOfOutputs: 1,
    });

    this.destinationNode = this.audioContext.createMediaStreamDestination();
    this.workletNode.connect(this.destinationNode);
    this.outputTrack = this.destinationNode.stream.getAudioTracks()[0];
    this.frameCount = 0;
  }

  private feedSamples(float32: Float32Array): void {
    if (!this.workletNode) return;
    const copy = new Float32Array(float32);
    this.workletNode.port.postMessage({ type: 'pcm-data', samples: copy }, [copy.buffer]);
  }

  // ────────────────────────────────────────────
  //  Native capture mode
  // ────────────────────────────────────────────

  public async start(sourceId?: string): Promise<MediaStreamTrack | null> {
    if (this.isCapturing) return this.outputTrack;

    const supported = await this.isSupported();
    if (!supported) {
      console.warn('[ScreenAudio] Not supported on this platform');
      appEvents.emit('screen_audio.error', t('screenAudio.unsupportedWindows'));
      return null;
    }

    await this.setupPipeline();

    // Listen for PCM frames from the native module via preload.
    window.api.onScreenAudioFrame((buffer: ArrayBuffer | Uint8Array) => {
      if (!this.workletNode) return;

      let float32: Float32Array;
      if (buffer instanceof ArrayBuffer) {
        float32 = new Float32Array(buffer);
      } else {
        float32 = new Float32Array(
          buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        );
      }

      if (this.frameCount === 0) {
        console.log(`[ScreenAudio] First native frame: ${float32.length} samples`);
        this.clearFrameWatchdog();
      }
      this.frameCount++;
      this.feedSamples(float32);
    });

    const result = await window.api.screenAudioStart(sourceId);
    if (!result.success) {
      console.error('[ScreenAudio] Failed to start native capture:', result.error);
      appEvents.emit('screen_audio.error', `Falha ao iniciar captura: ${result.error}`);
      this.cleanup();
      return null;
    }

    this.isCapturing = true;
    this.isTestTone = false;
    console.log('[ScreenAudio] Native capture started');

    // Watchdog: warn if no frames arrive within timeout
    this.frameWatchdog = setTimeout(() => {
      if (this.frameCount === 0 && this.isCapturing && !this.isTestTone) {
        console.warn('[ScreenAudio] No frames received within timeout — native capture may have failed silently');
        appEvents.emit('screen_audio.warning', t('screenAudio.noFrames'));
      }
    }, FRAME_WATCHDOG_TIMEOUT * 1000);

    await webRtcManager.setLocalScreenAudioTrack(this.outputTrack);
    networkClient.send(MessageType.VOICE_STATE_UPDATE, { isSharingScreenAudio: true });
    appEvents.emit('local.screen_audio_started');
    return this.outputTrack;
  }

  // ────────────────────────────────────────────
  //  Test tone mode (440 Hz, no native module)
  // ────────────────────────────────────────────

  public async startTestTone(): Promise<MediaStreamTrack | null> {
    if (this.isCapturing) return this.outputTrack;

    await this.setupPipeline();

    // Generate a 440 Hz stereo sine wave in chunks matching 48 kHz / 100 = 480 frames (10 ms)
    const sampleRate = 48000;
    const channels = 2;
    const chunkSize = 480 * channels;
    const frequency = 440;
    const amplitude = 0.3;
    let phase = 0;

    this.testToneInterval = setInterval(() => {
      const samples = new Float32Array(chunkSize);
      for (let i = 0; i < 480; i++) {
        const v = amplitude * Math.sin(2 * Math.PI * frequency * phase / sampleRate);
        samples[i * channels] = v;       // left
        samples[i * channels + 1] = v;   // right
        phase++;
      }
      this.feedSamples(samples);
      this.frameCount++;
    }, 10);

    this.isCapturing = true;
    this.isTestTone = true;
    console.log('[ScreenAudio] Test tone started (440 Hz)');

    await webRtcManager.setLocalScreenAudioTrack(this.outputTrack);
    networkClient.send(MessageType.VOICE_STATE_UPDATE, { isSharingScreenAudio: true });
    appEvents.emit('local.screen_audio_started');
    return this.outputTrack;
  }

  // ────────────────────────────────────────────
  //  Stop (both modes)
  // ────────────────────────────────────────────

  public async stop(): Promise<void> {
    if (!this.isCapturing) return;

    this.clearFrameWatchdog();

    if (this.isTestTone) {
      if (this.testToneInterval) {
        clearInterval(this.testToneInterval);
        this.testToneInterval = null;
      }
    } else {
      await window.api.screenAudioStop();
      window.api.removeScreenAudioFrameListener();
    }

    await webRtcManager.setLocalScreenAudioTrack(null);
    networkClient.send(MessageType.VOICE_STATE_UPDATE, { isSharingScreenAudio: false });

    const mode = this.isTestTone ? 'test-tone' : 'native';
    console.log(`[ScreenAudio] Stopped (${mode}). Frames: ${this.frameCount}`);

    this.cleanup();
    this.isCapturing = false;
    this.isTestTone = false;
    appEvents.emit('local.screen_audio_stopped');
  }

  public getIsCapturing(): boolean {
    return this.isCapturing;
  }

  public getIsTestTone(): boolean {
    return this.isTestTone;
  }

  public getOutputTrack(): MediaStreamTrack | null {
    return this.outputTrack;
  }

  public getFrameCount(): number {
    return this.frameCount;
  }

  private clearFrameWatchdog(): void {
    if (this.frameWatchdog) {
      clearTimeout(this.frameWatchdog);
      this.frameWatchdog = null;
    }
  }

  private cleanup(): void {
    if (this.outputTrack) {
      this.outputTrack.stop();
      this.outputTrack = null;
    }
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.destinationNode) {
      this.destinationNode.disconnect();
      this.destinationNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}

export const screenAudioService = new ScreenAudioService();
