export const PROTOCOL_VERSION = 1;

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
  HEARTBEAT_INTERVAL_MS: 15000,
  HEARTBEAT_TIMEOUT_MS: 35000,
} as const;

export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;

export type QualityPresetType = 'ECONOMIC' | 'NORMAL' | 'HIGH' | 'GAMING';

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

export const QUALITY_PRESETS: Record<QualityPresetType, QualityProfile> = {
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
    screenBitrateKbps: 500,
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
    screenBitrateKbps: 1000,
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
    screenBitrateKbps: 1500,
  },
  GAMING: {
    name: 'Gaming Mode',
    audioBitrateKbps: 28,
    cameraWidth: 640,
    cameraHeight: 360,
    cameraFps: 20,
    cameraBitrateKbps: 300,
    screenWidth: 1280,
    screenHeight: 720,
    screenFps: 20,
    screenBitrateKbps: 600,
  },
};
