import { AttachmentStorageInfo, ChannelSummary, ChatMessage, Role, ServerDetails, UserRoleSummary, UserSummary, VoiceParticipantState, WebRtcSignalPayload } from './models.js';

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
  ATTACHMENT_TOO_LARGE = 'ATTACHMENT_TOO_LARGE',
  ATTACHMENT_INVALID_TYPE = 'ATTACHMENT_INVALID_TYPE',
  STORAGE_FULL = 'STORAGE_FULL',
  SERVER_FULL = 'SERVER_FULL',
  PROTOCOL_VERSION_UNSUPPORTED = 'PROTOCOL_VERSION_UNSUPPORTED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  BAD_REQUEST = 'BAD_REQUEST',
}

export enum MessageType {
  // Client -> Server
  AUTH_CONNECT = 'AUTH_CONNECT',
  AUTH_CHALLENGE_RESPONSE = 'AUTH_CHALLENGE_RESPONSE',
  CHAT_SEND = 'CHAT_SEND',
  CHAT_LOAD_HISTORY = 'CHAT_LOAD_HISTORY',
  CHAT_MENTIONS_READ = 'CHAT_MENTIONS_READ',
  CHAT_REQUEST_UPLOAD_TOKEN = 'CHAT_REQUEST_UPLOAD_TOKEN',
  CHANNEL_CREATE = 'CHANNEL_CREATE',
  CHANNEL_DELETE = 'CHANNEL_DELETE',
  USER_CHANGE_NICKNAME = 'USER_CHANGE_NICKNAME',
  USER_UPDATE_AVATAR = 'USER_UPDATE_AVATAR',
  SERVER_UPDATE_SETTINGS = 'SERVER_UPDATE_SETTINGS',
  ROLE_CREATE = 'ROLE_CREATE',
  ROLE_UPDATE = 'ROLE_UPDATE',
  ROLE_DELETE = 'ROLE_DELETE',
  ROLE_ASSIGN = 'ROLE_ASSIGN',
  ROLE_UNASSIGN = 'ROLE_UNASSIGN',
  VOICE_JOIN = 'VOICE_JOIN',
  VOICE_LEAVE = 'VOICE_LEAVE',
  VOICE_STATE_UPDATE = 'VOICE_STATE_UPDATE',
  ADMIN_MUTE_USER = 'ADMIN_MUTE_USER',
  ADMIN_DEAFEN_USER = 'ADMIN_DEAFEN_USER',
  ADMIN_KICK_VOICE = 'ADMIN_KICK_VOICE',
  ADMIN_MOVE_USER = 'ADMIN_MOVE_USER',
  RTC_SIGNAL = 'RTC_SIGNAL',
  PING = 'PING',
  USER_LOGOUT = 'USER_LOGOUT',
  SOUNDBOARD_PLAY = 'SOUNDBOARD_PLAY',
  SERVER_GET_INVITE_INFO = 'SERVER_GET_INVITE_INFO',

  // Server -> Client
  AUTH_CHALLENGE = 'AUTH_CHALLENGE',
  AUTH_SUCCESS = 'AUTH_SUCCESS',
  AUTH_FAILED = 'AUTH_FAILED',
  SERVER_STATE = 'SERVER_STATE',
  ROLES_LIST = 'ROLES_LIST',
  SERVER_SETTINGS_UPDATED = 'SERVER_SETTINGS_UPDATED',
  SERVER_INVITE_INFO = 'SERVER_INVITE_INFO',
  SERVER_SHUTDOWN = 'SERVER_SHUTDOWN',
  USER_JOINED = 'USER_JOINED',
  USER_LEFT = 'USER_LEFT',
  USER_UPDATED = 'USER_UPDATED',
  USER_CONNECTION_STATE = 'USER_CONNECTION_STATE',
  CHANNEL_CREATED = 'CHANNEL_CREATED',
  CHANNEL_DELETED = 'CHANNEL_DELETED',
  CHAT_MESSAGE = 'CHAT_MESSAGE',
  CHAT_HISTORY = 'CHAT_HISTORY',
  CHAT_UPLOAD_TOKEN = 'CHAT_UPLOAD_TOKEN',
  VOICE_USER_JOINED = 'VOICE_USER_JOINED',
  VOICE_USER_LEFT = 'VOICE_USER_LEFT',
  VOICE_STATE_CHANGED = 'VOICE_STATE_CHANGED',
  SOUNDBOARD_PLAYED = 'SOUNDBOARD_PLAYED',
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
  publicKey: string;
  nickname: string;
  password?: string;
}

export interface AuthChallengePayload {
  nonce: string;
}

export interface AuthChallengeResponsePayload {
  signature: string;
}

export interface AuthFailedPayload {
  code?: ProtocolErrorCode;
  message: string;
}

export interface ChatSendPayload {
  channelId: string;
  content: string;
  // Ids of files already uploaded via POST /attachments to be linked to this
  // message (#11). `content` may be empty when the message is only attachments.
  attachmentIds?: string[];
}

// Client asks the server for a short-lived token authorizing an HTTP upload (#11).
export interface ChatRequestUploadTokenPayload {
  channelId: string;
}

// Server reply carrying the short-lived upload token and its expiry (#11).
export interface ChatUploadTokenPayload {
  token: string;
  expiresAt: number;
}

export interface ChatLoadHistoryPayload {
  channelId: string;
  beforeTimestamp?: number;
  limit?: number;
}

// Sent when the user opens a text channel, clearing any unread @-mentions for
// that user in that channel on the server so they are not re-delivered (#14).
export interface ChatMentionsReadPayload {
  channelId: string;
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
  avatarBase64: string | null; // Data URL, pure base64, or null to remove
  mimeType?: string;
}

export interface ServerUpdateSettingsPayload {
  name?: string;
  password?: string | null; // null or empty string removes the password
  allowSoundboard?: boolean;
  iconBase64?: string | null; // Data URL, pure base64, or null to remove
  // Attachment storage limits in bytes (#11).
  maxAttachmentFileBytes?: number;
  maxAttachmentStorageBytes?: number;
}

export interface RoleCreatePayload {
  name: string;
  color?: string | null;
  permissions: number;
  position?: number;
  isDefault?: boolean;
}

export interface RoleUpdatePayload {
  roleId: string;
  name?: string;
  color?: string | null;
  permissions?: number;
  position?: number;
  isDefault?: boolean;
}

export interface RoleDeletePayload {
  roleId: string;
}

export interface RoleAssignPayload {
  userId: string;
  roleId: string;
}

export interface RoleUnassignPayload {
  userId: string;
  roleId: string;
}

export interface SoundboardPlayPayload {
  channelId: string;
  soundName: string;
  audioBase64: string;
  mimeType?: string;
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
  isSharingScreenAudio?: boolean;
}

export interface AdminMuteUserPayload {
  targetUserId: string;
  muted: boolean;
}

export interface AdminDeafenUserPayload {
  targetUserId: string;
  deafened: boolean;
}

export interface AdminKickVoicePayload {
  targetUserId: string;
}

export interface AdminMoveUserPayload {
  targetUserId: string;
  channelId: string;
}

// Server Responses & Broadcast Payloads
export interface AuthSuccessPayload {
  server: ServerDetails;
  currentUser: UserSummary;
  roles?: Role[];
  userRoles?: UserRoleSummary[];
  ownerId?: string | null;
  myPermissions?: number;
}

export interface ServerErrorPayload {
  code: ProtocolErrorCode;
  message: string;
  requestId?: string;
}

export interface ServerSettingsUpdatedPayload {
  name: string;
  hasPassword: boolean;
  allowSoundboard?: boolean;
  iconUrl?: string | null;
  // Current attachment-storage limits + usage, so the settings UI stays in sync (#11).
  attachmentStorage?: AttachmentStorageInfo;
}

export interface SoundboardPlayedPayload {
  channelId: string;
  userId: string;
  userName: string;
  soundName: string;
  audioBase64: string;
  mimeType?: string;
}

export interface ServerShutdownPayload {
  reason?: string;
}

export interface UserJoinedPayload {
  user: UserSummary;
}

export interface UserLeftPayload {
  userId: string;
  nickname: string;
}

export interface UserConnectionStatePayload {
  userId: string;
  nickname: string;
  status: 'reconnecting' | 'online';
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

export interface RolesListPayload {
  roles: Role[];
  userRoles: UserRoleSummary[];
}

export interface ServerNetworkInterface {
  name: string;
  address: string;
  family: 'IPv4' | 'IPv6';
  type: 'public' | 'lan' | 'vpn' | 'loopback';
  description: string;
}

export interface ServerInviteInfoPayload {
  port: number;
  serverName: string;
  publicIp?: string | null;
  networkInterfaces: ServerNetworkInterface[];
}
