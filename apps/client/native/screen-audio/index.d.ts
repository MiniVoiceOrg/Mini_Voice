export interface ScreenAudioOptions {
  /** PID to exclude from capture (typically the MiniVoice process) */
  excludePid?: number;
  /** Sample rate in Hz (default: 48000) */
  sampleRate?: number;
  /** Number of channels (default: 2 for stereo) */
  channels?: number;
}

export interface StartResult {
  success: boolean;
  error?: string;
}

export interface StopResult {
  success: boolean;
}

/** Returns true if native screen audio capture is supported on this OS/version */
export function isSupported(): boolean;

/**
 * Start capturing system audio, excluding the specified process.
 * Callback receives PCM float32 interleaved buffers at the configured sample rate.
 */
export function start(
  options: ScreenAudioOptions,
  callback: (buffer: Buffer) => void
): StartResult;

/** Stop capturing screen audio */
export function stop(): StopResult;
