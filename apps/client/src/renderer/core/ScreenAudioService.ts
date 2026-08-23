/**
 * ScreenAudioService
 *
 * Bridges the native screen audio capture module (via preload IPC) with WebRTC.
 * Receives raw PCM float32 frames from main process, feeds them into an
 * AudioWorklet ring buffer, and outputs a MediaStreamTrack that can be added
 * to peer connections.
 *
 * Part of #55 (screen audio) and #75 (per-user volume).
 */

import { appEvents } from './EventBus';
import { webRtcManager } from './WebRtcManager';
import { networkClient } from './NetworkClient';
import { MessageType } from '@mini-voice/shared';

// Ring-buffer based AudioWorklet processor (inlined as a string so it can be
// loaded via Blob URL without a separate file).
const RING_BUFFER_SIZE = 48000 * 2 * 4; // ~4 s of stereo 48 kHz
const WORKLET_CODE = `
class ScreenAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Pre-allocated ring buffer (Float32Array) for zero-GC operation
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

class ScreenAudioService {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private outputTrack: MediaStreamTrack | null = null;
  private isCapturing: boolean = false;
  private frameCount: number = 0;

  /**
   * Check if the native screen audio capture is supported.
   */
  public async isSupported(): Promise<boolean> {
    return window.api.screenAudioSupported();
  }

  /**
   * Start screen audio capture. Returns the MediaStreamTrack to be sent via WebRTC.
   */
  public async start(): Promise<MediaStreamTrack | null> {
    if (this.isCapturing) return this.outputTrack;

    const supported = await this.isSupported();
    if (!supported) {
      console.warn('[ScreenAudio] Not supported on this platform');
      return null;
    }

    this.audioContext = new AudioContext({ sampleRate: 48000 });

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

    // Listen for PCM frames from the native module via preload.
    // The buffer arrives as Uint8Array (Electron IPC serialises Node Buffers
    // this way via structured clone). We must reinterpret the underlying
    // ArrayBuffer as Float32Array, NOT pass the Uint8Array to the constructor
    // (which would treat each byte as a separate float value).
    window.api.onScreenAudioFrame((buffer: ArrayBuffer | Uint8Array) => {
      if (!this.workletNode) return;

      let float32: Float32Array;
      if (buffer instanceof ArrayBuffer) {
        float32 = new Float32Array(buffer);
      } else {
        // Uint8Array (Buffer from Electron IPC) — reinterpret as float32
        float32 = new Float32Array(
          buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        );
      }

      if (this.frameCount === 0) {
        console.log(`[ScreenAudio] First frame received: ${float32.length} samples`);
      }
      this.frameCount++;

      // Transfer the underlying ArrayBuffer to the worklet (zero-copy)
      const copy = new Float32Array(float32);
      this.workletNode.port.postMessage(
        { type: 'pcm-data', samples: copy },
        [copy.buffer],
      );
    });

    // Start native capture
    const result = await window.api.screenAudioStart();
    if (!result.success) {
      console.error('[ScreenAudio] Failed to start native capture:', result.error);
      this.cleanup();
      return null;
    }

    this.isCapturing = true;
    console.log('[ScreenAudio] Native capture started successfully');

    // Add the track to WebRTC
    await webRtcManager.setLocalScreenAudioTrack(this.outputTrack);

    // Update voice state
    networkClient.send(MessageType.VOICE_STATE_UPDATE, { isSharingScreenAudio: true });

    appEvents.emit('local.screen_audio_started');
    return this.outputTrack;
  }

  /**
   * Stop screen audio capture and remove the track from peers.
   */
  public async stop(): Promise<void> {
    if (!this.isCapturing) return;

    // Stop native capture
    await window.api.screenAudioStop();
    window.api.removeScreenAudioFrameListener();

    // Remove from WebRTC
    await webRtcManager.setLocalScreenAudioTrack(null);

    // Update voice state
    networkClient.send(MessageType.VOICE_STATE_UPDATE, { isSharingScreenAudio: false });

    this.cleanup();
    this.isCapturing = false;

    console.log(`[ScreenAudio] Stopped. Total frames processed: ${this.frameCount}`);
    appEvents.emit('local.screen_audio_stopped');
  }

  public getIsCapturing(): boolean {
    return this.isCapturing;
  }

  public getOutputTrack(): MediaStreamTrack | null {
    return this.outputTrack;
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
