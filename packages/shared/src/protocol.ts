import { ChannelSummary, ChatMessage, ServerDetails, UserSummary, VoiceParticipantState, WebRtcSignalPayload } from './models.js';

export enum ProtocolErrorCode {
  AUTH_INVALID_PASSWORD = 'AUTH_INVALID_PASSWORD',
  NICKNAME_ALREADY_EXISTS = 'NICKNAME_ALREADY_EXISTS',
  NICKNAME_INVALID = 'NICKNAME_INVALID',
  CHANNEL_NOT_FOUND = 'CHANNEL_NOT_FOUND',
  CHANNEL_FULL = 'CHANNEL_FULL',
  MESSAGE_TOO_LONG = 'MESSAGE_TOO_LONG',
  RATE_LIMITED = 'RATE_LIMITED',
  AVATAR_TOO_LARGE = 'AVATAR_TOO_LARGE',
  AVATAR_INVALID_TYPE = 'AVATAR_INVALID_TYPE',
  SERVER_FULL = 'SERVER_FULL',
  PROTOCOL_VERSION_UNSUPPORTED = 'PROTOCOL_VERSION_UNSUPPORTED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  BAD_REQUEST = 'BAD_REQUEST',
}

export enum MessageType {
  // Client -> Server
  AUTH_CONNECT = 'AUTH_CONNECT',
  CHAT_SEND = 'CHAT_SEND',
  CHAT_LOAD_HISTORY = 'CHAT_LOAD_HISTORY',
  CHANNEL_CREATE = 'CHANNEL_CREATE',
  CHANNEL_DELETE = 'CHANNEL_DELETE',
  USER_CHANGE_NICKNAME = 'USER_CHANGE_NICKNAME',
  USER_UPDATE_AVATAR = 'USER_UPDATE_AVATAR',
  SERVER_UPDATE_SETTINGS = 'SERVER_UPDATE_SETTINGS',
  VOICE_JOIN = 'VOICE_JOIN',
  VOICE_LEAVE = 'VOICE_LEAVE',
  VOICE_STATE_UPDATE = 'VOICE_STATE_UPDATE',
  RTC_SIGNAL = 'RTC_SIGNAL',
  PING = 'PING',

  // Server -> Client
  AUTH_SUCCESS = 'AUTH_SUCCESS',
  AUTH_FAILED = 'AUTH_FAILED',
  SERVER_STATE = 'SERVER_STATE',
  SERVER_SETTINGS_UPDATED = 'SERVER_SETTINGS_UPDATED',
  USER_JOINED = 'USER_JOINED',
  USER_LEFT = 'USER_LEFT',
  USER_UPDATED = 'USER_UPDATED',
  CHANNEL_CREATED = 'CHANNEL_CREATED',
  CHANNEL_DELETED = 'CHANNEL_DELETED',
  CHAT_MESSAGE = 'CHAT_MESSAGE',
  CHAT_HISTORY = 'CHAT_HISTORY',
  VOICE_USER_JOINED = 'VOICE_USER_JOINED',
  VOICE_USER_LEFT = 'VOICE_USER_LEFT',
  VOICE_STATE_CHANGED = 'VOICE_STATE_CHANGED',
  SERVER_ERROR = 'SERVER_ERROR',
  PONG = 'PONG',
}

export interface ProtocolMessage<T = any> {
  type: MessageType;
  requestId?: string;
  payload: T;
}

// Client Payloads
export interface AuthConnectPayload {
  protocolVersion: number;
  clientId: string;
  nickname: string;
  password?: string;
}

export interface ChatSendPayload {
  channelId: string;
  content: string;
}

export interface ChatLoadHistoryPayload {
  channelId: string;
  beforeTimestamp?: number;
  limit?: number;
}

export interface ChannelCreatePayload {
  name: string;
  type: 'VOICE' | 'TEXT';
  maxParticipants?: number;
}

export interface ChannelDeletePayload {
  channelId: string;
}

export interface UserChangeNicknamePayload {
  newNickname: string;
}

export interface UserUpdateAvatarPayload {
  avatarBase64: string; // Data URL or pure base64
  mimeType: string;
}

export interface ServerUpdateSettingsPayload {
  name?: string;
  password?: string | null; // null or empty string removes the password
}

export interface VoiceJoinPayload {
  channelId: string;
}

export interface VoiceLeavePayload {
  channelId: string;
}

export interface VoiceStateUpdatePayload {
  isMuted?: boolean;
  isDeafened?: boolean;
  isSpeaking?: boolean;
  isCameraOn?: boolean;
  isScreenSharing?: boolean;
}

// Server Responses & Broadcast Payloads
export interface AuthSuccessPayload {
  server: ServerDetails;
  currentUser: UserSummary;
}

export interface ServerErrorPayload {
  code: ProtocolErrorCode;
  message: string;
  requestId?: string;
}

export interface ServerSettingsUpdatedPayload {
  name: string;
  hasPassword: boolean;
}

export interface UserJoinedPayload {
  user: UserSummary;
}

export interface UserLeftPayload {
  userId: string;
  nickname: string;
}

export interface UserUpdatedPayload {
  user: UserSummary;
}

export interface ChannelCreatedPayload {
  channel: ChannelSummary;
}

export interface ChannelDeletedPayload {
  channelId: string;
}

export interface ChatHistoryPayload {
  channelId: string;
  messages: ChatMessage[];
}

export interface VoiceUserJoinedPayload {
  channelId: string;
  userId: string;
  voiceState: VoiceParticipantState;
}

export interface VoiceUserLeftPayload {
  channelId: string;
  userId: string;
}

export interface VoiceStateChangedPayload {
  voiceState: VoiceParticipantState;
}
