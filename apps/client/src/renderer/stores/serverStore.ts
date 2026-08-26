import { AttachmentStorageInfo, ChannelSummary, DEFAULT_PERMISSIONS, Permission, Role, ServerDetails, UserRoleSummary, UserSummary, hasPermission } from '@monky/shared';
import { appEvents } from '../core/EventBus';

export class ServerStore {
  public serverDetails: ServerDetails | null = null;
  public currentUser: UserSummary | null = null;
  public activeTextChannelId: string | null = null;
  public roles: Role[] = [];
  public userRoles: UserRoleSummary[] = [];
  public ownerId: string | null = null;
  public myPermissions: number = 0;
  // Everyone who has ever connected (keyed by userId), so offline users remain
  // mentionable in chat (#14). Kept separate from the live members list.
  public knownMembers: Map<string, UserSummary> = new Map();

  public setServerDetails(details: ServerDetails, currentUser: UserSummary): void {
    this.serverDetails = details;
    this.currentUser = currentUser;
    this.roles = details.roles ?? [];
    this.userRoles = details.userRoles ?? [];
    this.ownerId = details.ownerId ?? null;
    this.myPermissions = details.myPermissions ?? 0;

    // Seed the known-members map from the persisted list (falling back to the
    // live members), then make sure the live members and self are present.
    this.knownMembers = new Map();
    const seed = details.knownMembers && details.knownMembers.length > 0 ? details.knownMembers : details.members;
    for (const m of seed) this.knownMembers.set(m.id, m);
    for (const m of details.members) this.rememberMember(m);
    this.rememberMember(currentUser);

    // Set active text channel if not set
    const textChannels = details.channels.filter((c) => c.type === 'TEXT');
    if (textChannels.length > 0 && !this.activeTextChannelId) {
      this.activeTextChannelId = textChannels[0].id;
    }
    appEvents.emit('server.updated');
  }

  /** Upserts a user into the persistent known-members map. */
  private rememberMember(user: UserSummary): void {
    const existing = this.knownMembers.get(user.id);
    // Prefer the most informative record: an online summary should not be
    // overwritten by a stale offline one, but nickname/avatar updates apply.
    if (!existing || user.status !== 'DISCONNECTED' || existing.status === 'DISCONNECTED') {
      this.knownMembers.set(user.id, user);
    }
  }

  /**
   * Returns users that can be mentioned in chat: everyone who has ever
   * connected, online first, then alphabetically. Excludes the current user.
   */
  public getMentionableUsers(): UserSummary[] {
    const list = Array.from(this.knownMembers.values()).filter((u) => u.id !== this.currentUser?.id);
    return list.sort((a, b) => {
      const aOnline = a.status !== 'DISCONNECTED' ? 0 : 1;
      const bOnline = b.status !== 'DISCONNECTED' ? 0 : 1;
      if (aOnline !== bOnline) return aOnline - bOnline;
      return a.nickname.localeCompare(b.nickname);
    });
  }

  public setActiveTextChannel(channelId: string): void {
    this.activeTextChannelId = channelId;
    appEvents.emit('channel.selected', channelId);
  }

  public addChannel(channel: ChannelSummary): void {
    if (this.serverDetails) {
      this.serverDetails.channels.push(channel);
      appEvents.emit('server.updated');
    }
  }

  public removeChannel(channelId: string): void {
    if (this.serverDetails) {
      this.serverDetails.channels = this.serverDetails.channels.filter((c) => c.id !== channelId);
      if (this.activeTextChannelId === channelId) {
        const textChannels = this.serverDetails.channels.filter((c) => c.type === 'TEXT');
        this.activeTextChannelId = textChannels.length > 0 ? textChannels[0].id : null;
      }
      appEvents.emit('server.updated');
    }
  }

  public updateCurrentUser(user: UserSummary): void {
    this.currentUser = user;
    this.rememberMember(user);
    if (this.serverDetails) {
      const idx = this.serverDetails.members.findIndex((m) => m.id === user.id);
      if (idx >= 0) {
        this.serverDetails.members[idx] = user;
      }
    }
    appEvents.emit('user.updated', user);
  }

  public addMember(user: UserSummary): void {
    this.rememberMember(user);
    if (this.serverDetails) {
      const idx = this.serverDetails.members.findIndex((m) => m.id === user.id);
      if (idx >= 0) {
        this.serverDetails.members[idx] = user;
      } else {
        this.serverDetails.members.push(user);
      }
      appEvents.emit('server.members_updated', this.serverDetails.members);
    }
  }

  public removeMember(userId: string): void {
    if (this.serverDetails) {
      this.serverDetails.members = this.serverDetails.members.filter((m) => m.id !== userId);
      appEvents.emit('server.members_updated', this.serverDetails.members);
    }
  }

  public removeMemberCompletely(userId: string): void {
    this.knownMembers.delete(userId);
    this.removeMember(userId);
  }

  public updateMember(user: UserSummary): void {
    this.addMember(user);
  }

  public updateServerMeta(
    name: string,
    hasPassword: boolean,
    allowSoundboard?: boolean,
    iconUrl?: string | null,
    attachmentStorage?: AttachmentStorageInfo
  ): void {
    if (this.serverDetails) {
      this.serverDetails.name = name;
      this.serverDetails.hasPassword = hasPassword;
      if (allowSoundboard !== undefined) {
        this.serverDetails.allowSoundboard = allowSoundboard;
      }
      if (iconUrl !== undefined) {
        this.serverDetails.iconUrl = iconUrl;
      }
      if (attachmentStorage !== undefined) {
        this.serverDetails.attachmentStorage = attachmentStorage;
      }
      appEvents.emit('server.updated');
      appEvents.emit('server.meta_updated', this.serverDetails);
    }
  }

  public updateRoles(roles: Role[], userRoles: UserRoleSummary[]): void {
    this.roles = roles;
    this.userRoles = userRoles;
    if (this.serverDetails) {
      this.serverDetails.roles = roles;
      this.serverDetails.userRoles = userRoles;
    }
    this.recalculateMyPermissions();
    appEvents.emit('server.roles_updated');
    appEvents.emit('server.updated');
  }

  public getRole(roleId: string): Role | undefined {
    return this.roles.find((role) => role.id === roleId);
  }

  /**
   * The built-in Admin role, which every server has. It is a permission state
   * rather than a user-facing role, so it is hidden from role listings (#265).
   */
  public getAdminRole(): Role | undefined {
    return this.roles.find((role) => this.isAdminRole(role));
  }

  public isAdminRole(role: Role): boolean {
    return role.name === 'Admin';
  }

  /** Roles that should be listed and assigned as regular roles in the UI (#265). */
  public getVisibleRoles(): Role[] {
    return this.roles.filter((role) => !this.isAdminRole(role));
  }

  public getUserRoleIds(userId: string): string[] {
    return this.userRoles.find((entry) => entry.userId === userId)?.roleIds ?? [];
  }

  public getUserRoles(userId: string): Role[] {
    const roleIds = new Set(this.getUserRoleIds(userId));
    return this.roles.filter((role) => roleIds.has(role.id)).sort((a, b) => b.position - a.position);
  }

  /**
   * Highest role position held by a user, used to order the member list in the
   * sidebar according to the role ranking defined by drag-and-drop (#262).
   * Users with no role rank last.
   */
  public getUserHighestRolePosition(userId: string): number {
    return this.getUserRoles(userId).reduce(
      (highest, role) => Math.max(highest, role.position),
      -1
    );
  }

  /** Members ordered by role ranking first, then alphabetically (#262). */
  public getMembersInDisplayOrder(): UserSummary[] {
    const members = [...(this.serverDetails?.members ?? [])];
    return members.sort((a, b) => {
      const diff = this.getUserHighestRolePosition(b.id) - this.getUserHighestRolePosition(a.id);
      if (diff !== 0) return diff;
      return a.nickname.localeCompare(b.nickname);
    });
  }

  public recalculateMyPermissions(): number {
    if (!this.currentUser) {
      this.myPermissions = 0;
      return this.myPermissions;
    }
    if (this.ownerId && this.currentUser.id === this.ownerId) {
      this.myPermissions = 0xFFFFFFFF;
      if (this.serverDetails) {
        this.serverDetails.myPermissions = this.myPermissions;
      }
      return this.myPermissions;
    }
    const roleIds = new Set(this.getUserRoleIds(this.currentUser.id));
    const roles = this.roles.filter((role) => roleIds.has(role.id));
    this.myPermissions = roles.length === 0
      ? DEFAULT_PERMISSIONS
      : roles.reduce((bits, role) => bits | role.permissions, 0);
    if (this.serverDetails) {
      this.serverDetails.myPermissions = this.myPermissions;
    }
    return this.myPermissions;
  }

  public hasPermission(permission: Permission): boolean {
    return hasPermission(this.myPermissions, permission);
  }

  public clear(): void {
    this.serverDetails = null;
    this.currentUser = null;
    this.activeTextChannelId = null;
    this.roles = [];
    this.userRoles = [];
    this.ownerId = null;
    this.myPermissions = 0;
    this.knownMembers = new Map();
    appEvents.emit('server.updated');
  }
}

export const serverStore = new ServerStore();
