import { ChannelType, UserStatus } from '@mini-voice/shared';

export interface ServerRecord {
  id: string;
  name: string;
  passwordHash: string;
  createdAt: number;
  maxUsers: number;
}

export interface UserRecord {
  id: string;
  clientId: string;
  nickname: string;
  avatarPath: string | null;
  createdAt: number;
  lastSeenAt: number;
}

export interface ChannelRecord {
  id: string;
  serverId: string;
  name: string;
  type: ChannelType;
  position: number;
  createdAt: number;
  maxParticipants: number;
}

export interface MessageRecord {
  id: string;
  channelId: string;
  userId: string;
  content: string;
  createdAt: number;
  isSystem?: boolean;
}
