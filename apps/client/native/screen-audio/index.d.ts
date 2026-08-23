export interface ScreenAudioOptions {
  excludePid?: number;
  sampleRate?: number;
  channels?: number;
}

export interface StartResult {
  success: boolean;
  error?: string;
}

export interface StopResult {
  success: boolean;
}

export function isSupported(): boolean;

export function start(
  options: ScreenAudioOptions,
  callback: (buffer: Buffer) => void
): StartResult;

export function stop(): StopResult;

/** Returns the last error message from the capture thread (empty if none). */
export function getLastError(): string;

/** Returns the capture status: 0=idle, 1=starting, 2=capturing, 3=error */
export function getStatus(): number;
