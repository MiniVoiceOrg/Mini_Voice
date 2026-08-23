import { ChannelSummary, ServerDetails, UserSummary } from '@mini-voice/shared';
import { appEvents } from '../core/EventBus';

export class ServerStore {
  public serverDetails: ServerDetails | null = null;
  public currentUser: UserSummary | null = null;
  public activeTextChannelId: string | null = null;

  public setServerDetails(details: ServerDetails, currentUser: UserSummary): void {
    this.serverDetails = details;
    this.currentUser = currentUser;

    // Set active text channel if not set
    const textChannels = details.channels.filter((c) => c.type === 'TEXT');
    if (textChannels.length > 0 && !this.activeTextChannelId) {
      this.activeTextChannelId = textChannels[0].id;
    }
    appEvents.emit('server.updated');
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
    if (this.serverDetails) {
      const idx = this.serverDetails.members.findIndex((m) => m.id === user.id);
      if (idx >= 0) {
        this.serverDetails.members[idx] = user;
      }
    }
    appEvents.emit('user.updated', user);
  }

  public addMember(user: UserSummary): void {
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

  public updateMember(user: UserSummary): void {
    this.addMember(user);
  }

  public updateServerMeta(name: string, hasPassword: boolean, allowSoundboard?: boolean, iconUrl?: string | null): void {
    if (this.serverDetails) {
      this.serverDetails.name = name;
      this.serverDetails.hasPassword = hasPassword;
      if (allowSoundboard !== undefined) {
        this.serverDetails.allowSoundboard = allowSoundboard;
      }
      if (iconUrl !== undefined) {
        this.serverDetails.iconUrl = iconUrl;
      }
      appEvents.emit('server.updated');
      appEvents.emit('server.meta_updated', this.serverDetails);
    }
  }

  public clear(): void {
    this.serverDetails = null;
    this.currentUser = null;
    this.activeTextChannelId = null;
    appEvents.emit('server.updated');
  }
}

export const serverStore = new ServerStore();
