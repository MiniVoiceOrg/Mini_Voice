export type ChannelType = 'VOICE' | 'TEXT';

export type UserStatus = 'ONLINE' | 'IDLE' | 'VOICE' | 'DISCONNECTED';

export interface UserSummary {
  id: string;
  clientId: string;
  nickname: string;
  avatarUrl?: string | null;
  status: UserStatus;
  joinedAt: number;
}

export interface ChannelSummary {
  id: string;
  serverId: string;
  name: string;
  type: ChannelType;
  position: number;
  createdAt: number;
  maxParticipants?: number;
}

export type AttachmentKind = 'image' | 'video' | 'file';

// A single file attached to a chat message (#11). The binary itself lives on the
// host's disk (server-data/attachments) and is served over HTTP; only this small
// metadata record travels over the WebSocket / is stored in the DB.
export interface AttachmentMeta {
  id: string;
  messageId: string;
  kind: AttachmentKind;
  // HTTP path served by the host (e.g. /attachments/<file>). Null when the file
  // has been evicted by the FIFO storage cleanup — the UI shows a placeholder.
  url: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  // True when the file was pruned to reclaim disk space; the message row stays.
  evicted?: boolean;
  createdAt: number;
}

// Server attachment-storage limits and current usage, surfaced in the server
// settings UI so the host can see and adjust how much disk chat files may use.
export interface AttachmentStorageInfo {
  usedBytes: number;
  maxTotalBytes: number;
  maxFileBytes: number;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  userId: string;
  userNickname: string;
  userAvatarUrl?: string | null;
  content: string;
  createdAt: number;
  isSystem?: boolean;
  // Files attached to this message (#11). Omitted/empty for plain text messages.
  attachments?: AttachmentMeta[];
}

export interface Role {
  id: string;
  name: string;
  color: string | null;
  position: number;
  permissions: number;
  isDefault: boolean;
}

export interface UserRoleSummary {
  userId: string;
  roleIds: string[];
}

export interface VoiceParticipantState {
  userId: string;
  channelId: string;
  isMuted: boolean;
  isDeafened: boolean;
  serverMuted: boolean;
  serverDeafened: boolean;
  isSpeaking: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  isSharingScreenAudio: boolean;
}

export interface ServerDetails {
  id: string;
  name: string;
  createdAt: number;
  maxUsers: number;
  hasPassword?: boolean;
  allowSoundboard?: boolean;
  iconUrl?: string | null;
  channels: ChannelSummary[];
  members: UserSummary[];
  // All users who have ever connected (online + offline), used to allow
  // mentioning users that are not currently in the server (#14). Offline users
  // carry status 'DISCONNECTED'. Optional for backward compatibility.
  knownMembers?: UserSummary[];
  // Channel ids in which the current user has unread @-mentions, so that a user
  // mentioned while offline sees the red @ badge when they reconnect (#14).
  mentionedChannelIds?: string[];
  voiceStates: Record<string, VoiceParticipantState>; // key = userId
  roles?: Role[];
  userRoles?: UserRoleSummary[];
  ownerId?: string | null;
  myPermissions?: number;
  // Attachment-storage limits + current usage for the settings UI (#11).
  attachmentStorage?: AttachmentStorageInfo;
}

export interface WebRtcSignalPayload {
  targetUserId: string;
  fromUserId: string;
  signalType: 'offer' | 'answer' | 'candidate' | 'user-left' | 'screen-audio-meta' | 'screen-video-meta';
  sdp?: any; // RTCSessionDescriptionInit
  candidate?: any; // RTCIceCandidateInit
  streamId?: string; // For screen-audio-meta/screen-video-meta: the MediaStream ID of the screen track
}

export interface BandwidthSettings {
  maxUploadKbps: number;
  maxDownloadKbps: number;
  qualityPreset: 'ECONOMIC' | 'NORMAL' | 'HIGH' | 'GAMING';
}
