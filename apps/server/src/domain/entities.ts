import { ChannelType, UserStatus } from '@monky/shared';

export interface ServerRecord {
  id: string;
  name: string;
  passwordHash: string;
  createdAt: number;
  maxUsers: number;
  ownerUserId?: string | null;
  allowSoundboard?: boolean;
  iconPath?: string | null;
  // Attachment storage limits in bytes (#11); null → shared defaults.
  maxAttachmentFileBytes?: number | null;
  maxAttachmentStorageBytes?: number | null;
}

export interface UserRecord {
  id: string;
  clientId: string;
  publicKey: string | null;
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
  /** Private channels (#384). */
  isPrivate: boolean;
  /** Roles allowed in, loaded from `channel_allowed_roles`. */
  allowedRoleIds: string[];
}

export interface MessageRecord {
  id: string;
  channelId: string;
  userId: string;
  content: string;
  createdAt: number;
  isSystem?: boolean;
}

export interface MentionRecord {
  id: string;
  userId: string;
  channelId: string;
  messageId: string;
  createdAt: number;
}

// A file attached to a chat message (#11). `messageId` is null while the upload
// is pending (before the message is sent). `filename` is the on-disk name, empty
// once the row has been evicted by the FIFO storage cleanup.
export interface AttachmentRecord {
  id: string;
  messageId: string | null;
  channelId: string;
  userId: string;
  kind: 'image' | 'video' | 'file';
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  evicted?: boolean;
  createdAt: number;
}

export interface RoleRecord {
  id: string;
  name: string;
  color: string | null;
  position: number;
  permissions: number;
  isDefault: boolean;
  createdAt: number;
}

export interface UserRoleRecord {
  userId: string;
  roleId: string;
}
