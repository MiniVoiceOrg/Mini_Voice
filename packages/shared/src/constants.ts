export const PROTOCOL_VERSION = 3;

export const LIMITS = {
  MAX_MESSAGE_LENGTH: 2000,
  MAX_AVATAR_SIZE: 5 * 1024 * 1024, // 5 MB
  MAX_USERS_DEFAULT: 20,
  MAX_PARTICIPANTS_PER_CHANNEL_DEFAULT: 10,
  MIN_NICKNAME_LENGTH: 2,
  MAX_NICKNAME_LENGTH: 32,
  MIN_CHANNEL_NAME_LENGTH: 2,
  MAX_CHANNEL_NAME_LENGTH: 50,
  MIN_PORT: 1024,
  MAX_PORT: 65535,
  DEFAULT_PORT: 3000,
  MAX_HISTORY_MESSAGES_INITIAL: 100,
  RATE_LIMIT_MAX_MESSAGES: 10,
  RATE_LIMIT_WINDOW_MS: 5000,
  HEARTBEAT_INTERVAL_MS: 5000,
  HEARTBEAT_TIMEOUT_MS: 35000,
  RECONNECT_GRACE_MS: 20000,
  // Concurrent devices a single identity may hold (#309). Without a cap, an
  // already-online identity could open unlimited connections and bypass
  // maxUsers, since capacity counts people rather than connections.
  MAX_SESSIONS_PER_USER: 3,
  // Chat attachments (#11). Both size limits are server-configurable; these are
  // only the initial defaults applied when a server is first created.
  MAX_ATTACHMENT_FILE_SIZE_DEFAULT: 50 * 1024 * 1024, // 50 MB per file
  MAX_ATTACHMENT_STORAGE_TOTAL_DEFAULT: 2 * 1024 * 1024 * 1024, // 2 GB total server budget
  MAX_ATTACHMENTS_PER_MESSAGE: 10,
  // FIFO eviction low-watermark: when the total budget is exceeded, prune oldest
  // attachments until usage drops to this fraction of the max (avoids per-upload churn).
  ATTACHMENT_EVICTION_LOW_WATERMARK: 0.9,
  // Short-lived token that authorizes an HTTP POST /attachments upload.
  UPLOAD_TOKEN_TTL_MS: 60000,
} as const;

export const RECONNECT_DELAYS_MS = [1000, 2000, 3000, 5000] as const;

export type QualityPresetType = 'ECONOMIC' | 'NORMAL' | 'HIGH' | 'GAMING' | 'CUSTOM';

export interface QualityProfile {
  name: string;
  audioBitrateKbps: number;
  cameraWidth: number;
  cameraHeight: number;
  cameraFps: number;
  cameraBitrateKbps: number;
  screenWidth: number;
  screenHeight: number;
  screenFps: number;
  screenBitrateKbps: number;
}

export const QUALITY_PRESETS: Record<Exclude<QualityPresetType, 'CUSTOM'>, QualityProfile> = {
  ECONOMIC: {
    name: 'Econômico',
    audioBitrateKbps: 24,
    cameraWidth: 640,
    cameraHeight: 360,
    cameraFps: 24,
    cameraBitrateKbps: 250,
    screenWidth: 854,
    screenHeight: 480,
    screenFps: 15,
    screenBitrateKbps: 900,
  },
  NORMAL: {
    name: 'Normal',
    audioBitrateKbps: 32,
    cameraWidth: 854,
    cameraHeight: 480,
    cameraFps: 30,
    cameraBitrateKbps: 450,
    screenWidth: 1280,
    screenHeight: 720,
    screenFps: 30,
    screenBitrateKbps: 2000,
  },
  HIGH: {
    name: 'Alta Qualidade',
    audioBitrateKbps: 48,
    cameraWidth: 1280,
    cameraHeight: 720,
    cameraFps: 30,
    cameraBitrateKbps: 600,
    screenWidth: 1920,
    screenHeight: 1080,
    screenFps: 30,
    screenBitrateKbps: 3500,
  },
  GAMING: {
    name: 'Gaming Mode',
    audioBitrateKbps: 28,
    cameraWidth: 640,
    cameraHeight: 360,
    cameraFps: 20,
    cameraBitrateKbps: 300,
    screenWidth: 1920,
    screenHeight: 1080,
    screenFps: 60,
    screenBitrateKbps: 6000,
  },
};

export const DEFAULT_CUSTOM_PROFILE: QualityProfile = {
  name: 'Personalizado',
  audioBitrateKbps: 32,
  cameraWidth: 1280,
  cameraHeight: 720,
  cameraFps: 30,
  cameraBitrateKbps: 500,
  screenWidth: 1920,
  screenHeight: 1080,
  screenFps: 30,
  screenBitrateKbps: 3000,
};
