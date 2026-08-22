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

export interface ChatMessage {
  id: string;
  channelId: string;
  userId: string;
  userNickname: string;
  userAvatarUrl?: string | null;
  content: string;
  createdAt: number;
  isSystem?: boolean;
}

export interface VoiceParticipantState {
  userId: string;
  channelId: string;
  isMuted: boolean;
  isDeafened: boolean;
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
  channels: ChannelSummary[];
  members: UserSummary[];
  voiceStates: Record<string, VoiceParticipantState>; // key = userId
}

export interface WebRtcSignalPayload {
  targetUserId: string;
  fromUserId: string;
  signalType: 'offer' | 'answer' | 'candidate' | 'user-left' | 'screen-audio-meta';
  sdp?: any; // RTCSessionDescriptionInit
  candidate?: any; // RTCIceCandidateInit
  streamId?: string; // For screen-audio-meta: the MediaStream ID of the screen audio track
}

export interface BandwidthSettings {
  maxUploadKbps: number;
  maxDownloadKbps: number;
  qualityPreset: 'ECONOMIC' | 'NORMAL' | 'HIGH' | 'GAMING';
}
