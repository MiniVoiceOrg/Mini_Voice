export interface ScreenAudioOptions {
  excludePid?: number;
  /**
   * Capture only the audio of the application owning this window.
   * On Windows it is the HWND (resolved to a process tree); on macOS it is the
   * CGWindowID (used as a ScreenCaptureKit window filter).
   */
  includeWindowId?: number;
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

export interface WindowOwner {
  /** CGWindowID, matching the numeric part of Electron's `window:<id>:<n>` source id. */
  windowId: number;
  pid: number;
  /** Absolute path to the owning `.app` bundle. */
  bundlePath: string;
  appName: string;
}

/**
 * Lists visible windows with the application that owns them. Only implemented on
 * macOS, where Electron leaves `desktopCapturer`'s `appIcon` empty (#455); other
 * platforms return an empty array.
 */
export function listWindowOwners(): WindowOwner[];
