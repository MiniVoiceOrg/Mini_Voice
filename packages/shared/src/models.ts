export type ChannelType = 'VOICE' | 'TEXT';

export type UserStatus = 'ONLINE' | 'IDLE' | 'VOICE' | 'DISCONNECTED';

export interface UserSummary {
  id: string;
  clientId: string;
  nickname: string;
  avatarUrl?: string | null;
  status: UserStatus;
  joinedAt: number;
  /**
   * Identifies one live connection of this user, as `userId:deviceId` (#309).
   * The same person may be signed in from several devices at once, so anything
   * that addresses a *connection* (voice participants, WebRTC peers, presence)
   * keys off this instead of `id`. Absent on offline/known-member records,
   * which describe a person rather than a connection.
   */
  sessionId?: string;
  /** When this particular connection came up, used to order a user's devices (#309). */
  connectedAt?: number;
}

export interface ChannelSummary {
  id: string;
  serverId: string;
  name: string;
  type: ChannelType;
  position: number;
  createdAt: number;
  maxParticipants?: number;
  /**
   * Restricts the channel to members holding one of `allowedRoleIds` (#384).
   * The server never sends a channel the recipient cannot access, so receiving
   * one already means it is visible to you — this flag only drives the UI badge
   * and the editing form.
   */
  isPrivate: boolean;
  /**
   * Roles allowed into a private channel. Empty on public channels, and also
   * valid on a private one, where it means "managers only".
   */
  allowedRoleIds: string[];
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
  /** The connection this state belongs to (#309). Unique per device. */
  sessionId: string;
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
  /**
   * IDs of the screen shares this participant is currently broadcasting (#253).
   * Each entry is the MediaStream id announced over `screen-video-meta`, so
   * receivers can key tiles and streams per share instead of per user.
   * `isScreenSharing` stays as the derived flag (`length > 0`) and remains the
   * source of truth for clients that predate this field.
   */
  screenShareIds?: string[];
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
  /** One entry per live connection: a user signed in from two devices appears twice (#309). */
  members: UserSummary[];
  // All users who have ever connected (online + offline), used to allow
  // mentioning users that are not currently in the server (#14). Offline users
  // carry status 'DISCONNECTED'. Optional for backward compatibility.
  knownMembers?: UserSummary[];
  // Channel ids in which the current user has unread @-mentions, so that a user
  // mentioned while offline sees the red @ badge when they reconnect (#14).
  mentionedChannelIds?: string[];
  voiceStates: Record<string, VoiceParticipantState>; // key = sessionId (#309)
  roles?: Role[];
  userRoles?: UserRoleSummary[];
  ownerId?: string | null;
  myPermissions?: number;
  // Attachment-storage limits + current usage for the settings UI (#11).
  attachmentStorage?: AttachmentStorageInfo;
  /**
   * Whether the host is relaying media through its own TURN server (#425).
   *
   * Purely informational for the settings UI: the credentials clients actually
   * dial live in `AuthSuccessPayload.iceServers`, never here, because they are
   * per-user and short-lived.
   */
  turnEnabled?: boolean;

  /**
   * Whether this host can actually run the relay, so the UI can disable the
   * toggle instead of letting the operator switch on something impossible
   * (#429).
   *
   * Absent means the server predates the relay feature: an older build simply
   * ignores `turnEnabled`, so the toggle would appear to do nothing at all.
   * That is why availability is reported as a present-or-absent object rather
   * than a boolean — `undefined` is meaningful here.
   *
   * The reason travels as a code, not as prose, because the server has no idea
   * which language the person reading the screen uses.
   */
  turnAvailability?: TurnAvailability;
}

export type TurnUnavailableReason = 'unsupported-platform' | 'not-installed';

export interface TurnAvailability {
  supported: boolean;
  reason?: TurnUnavailableReason;
  /**
   * The host is missing coturn but the server can install it on its own when
   * the relay is switched on (#431). Only meaningful with `not-installed`:
   * without it the operator has to run the script by hand.
   */
  autoInstallable?: boolean;
}

/**
 * Which part of the coturn installation is running (#438).
 *
 * A code rather than a sentence: the server does not know the language of
 * whoever is watching the progress bar.
 */
export type TurnInstallStage = 'refreshing' | 'installing' | 'configuring';

export interface WebRtcSignalPayload {
  /** Peers are addressed per connection, not per person (#309). */
  targetSessionId: string;
  fromSessionId: string;
  signalType: 'offer' | 'answer' | 'candidate' | 'user-left' | 'screen-audio-meta' | 'screen-video-meta';
  sdp?: any; // RTCSessionDescriptionInit
  candidate?: any; // RTCIceCandidateInit
  streamId?: string; // For screen-audio-meta/screen-video-meta: the MediaStream ID of the screen track
}

export interface BandwidthSettings {
  maxUploadKbps: number;
  maxDownloadKbps: number;
  qualityPreset: 'ECONOMIC' | 'NORMAL' | 'HIGH' | 'GAMING' | 'ULTRA';
}
