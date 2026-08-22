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

class ScreenAudioService {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private outputTrack: MediaStreamTrack | null = null;
  private isCapturing: boolean = false;

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

    // Create AudioContext and worklet for PCM → MediaStreamTrack conversion
    this.audioContext = new AudioContext({ sampleRate: 48000 });

    // Register the worklet processor
    const workletCode = `
      class ScreenAudioProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.buffer = [];
          this.port.onmessage = (e) => {
            if (e.data.type === 'pcm-data') {
              this.buffer.push(...e.data.samples);
            }
          };
        }
        process(inputs, outputs) {
          const output = outputs[0];
          const channels = output.length;
          const frameSize = output[0].length;
          const samplesNeeded = frameSize * channels;
          if (this.buffer.length >= samplesNeeded) {
            for (let i = 0; i < frameSize; i++) {
              for (let ch = 0; ch < channels; ch++) {
                output[ch][i] = this.buffer[i * channels + ch] || 0;
              }
            }
            this.buffer.splice(0, samplesNeeded);
          } else {
            // Not enough data — output silence
            for (let ch = 0; ch < channels; ch++) {
              output[ch].fill(0);
            }
          }
          return true;
        }
      }
      registerProcessor('screen-audio-processor', ScreenAudioProcessor);
    `;

    const blob = new Blob([workletCode], { type: 'application/javascript' });
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

    // Listen for PCM frames from the native module via preload
    window.api.onScreenAudioFrame((buffer: ArrayBuffer) => {
      if (!this.workletNode) return;
      // Convert Buffer (ArrayBuffer) to Float32Array
      const float32 = new Float32Array(buffer);
      this.workletNode.port.postMessage({ type: 'pcm-data', samples: Array.from(float32) });
    });

    // Start native capture
    const result = await window.api.screenAudioStart();
    if (!result.success) {
      console.error('[ScreenAudio] Failed to start native capture:', result.error);
      this.cleanup();
      return null;
    }

    this.isCapturing = true;

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
