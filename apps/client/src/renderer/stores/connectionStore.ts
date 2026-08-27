import { ConnectionStatus } from '../core/NetworkClient';
import { appEvents } from '../core/EventBus';

export interface SavedServer {
  host: string;
  port: number;
  name: string;
  lastConnected: number;
  password?: string;
  iconUrl?: string;
}

export interface CreatedServer {
  id: string;
  name: string;
  port: number;
  password?: string;
  voiceChannel: string;
  textChannel: string;
  createdAt: number;
  lastStarted: number;
}

export class ConnectionStore {
  public status: ConnectionStatus = 'DISCONNECTED';
  public clientId: string = '';
  public publicKey: string = '';
  public hasIdentity: boolean = false;
  public lastError: string | null = null;
  public savedServers: SavedServer[] = [];
  public createdServers: CreatedServer[] = [];
  public savedNickname: string = '';
  public savedAvatarBase64: string = '';

  constructor() {
    this.loadSavedServers();
    this.loadCreatedServers();
    this.loadUserProfile();
  }

  public loadUserProfile(): void {
    try {
      this.savedNickname = localStorage.getItem('monky_nickname') || '';
      this.savedAvatarBase64 = localStorage.getItem('monky_avatar') || '';
    } catch (e) {
      this.savedNickname = '';
      this.savedAvatarBase64 = '';
    }
  }

  public saveUserProfile(nickname: string, avatarBase64?: string | null): void {
    if (nickname) {
      this.savedNickname = nickname;
      try {
        localStorage.setItem('monky_nickname', nickname);
      } catch (e) {}
    }
    if (avatarBase64 !== undefined) {
      this.savedAvatarBase64 = avatarBase64 || '';
      try {
        if (avatarBase64) {
          localStorage.setItem('monky_avatar', avatarBase64);
        } else {
          localStorage.removeItem('monky_avatar');
        }
      } catch (e) {}
    }
  }

  public loadSavedServers(): void {
    try {
      const raw = localStorage.getItem('monky_saved_servers');
      if (raw) {
        this.savedServers = JSON.parse(raw);
      }
    } catch (e) {
      this.savedServers = [];
    }
  }

  public addSavedServer(server: SavedServer): void {
    const existingIdx = this.savedServers.findIndex(
      (s) => s.host === server.host && s.port === server.port
    );
    if (existingIdx >= 0) {
      // Preserve existing fields if new values are default/empty
      const existing = this.savedServers[existingIdx];
      if (!server.name && existing.name) {
        server.name = existing.name;
      }
      if (!server.iconUrl && existing.iconUrl) {
        server.iconUrl = existing.iconUrl;
      }
      this.savedServers[existingIdx] = server;
    } else {
      this.savedServers.unshift(server);
    }
    // Sort by lastConnected descending
    this.savedServers.sort((a, b) => b.lastConnected - a.lastConnected);
    // Keep max 15
    this.savedServers = this.savedServers.slice(0, 15);
    try {
      localStorage.setItem('monky_saved_servers', JSON.stringify(this.savedServers));
    } catch (e) {}
    appEvents.emit('connection.saved_servers_changed');
  }

  public removeSavedServer(host: string, port: number): void {
    this.savedServers = this.savedServers.filter((s) => !(s.host === host && s.port === port));
    try {
      localStorage.setItem('monky_saved_servers', JSON.stringify(this.savedServers));
    } catch (e) {}
    appEvents.emit('connection.saved_servers_changed');
  }

  /** Updates the icon for the currently connected server in the saved list. */
  public updateSavedServerIcon(host: string, port: number, iconUrl: string | null): void {
    const srv = this.savedServers.find((s) => s.host === host && s.port === port);
    if (!srv) return;
    srv.iconUrl = iconUrl || undefined;
    try {
      localStorage.setItem('monky_saved_servers', JSON.stringify(this.savedServers));
    } catch (e) {}
    appEvents.emit('connection.saved_servers_changed');
  }

  public updateSavedServer(oldHost: string, oldPort: number, updated: SavedServer): void {
    const idx = this.savedServers.findIndex((s) => s.host === oldHost && s.port === oldPort);
    if (idx >= 0) {
      this.savedServers[idx] = updated;
    }
    try {
      localStorage.setItem('monky_saved_servers', JSON.stringify(this.savedServers));
    } catch (e) {}
  }

  public loadCreatedServers(): void {
    try {
      const raw = localStorage.getItem('monky_created_servers');
      if (!raw) {
        this.createdServers = [];
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        this.createdServers = [];
        return;
      }

      this.createdServers = parsed
        .filter((server): server is CreatedServer => (
          !!server &&
          typeof server.id === 'string' &&
          typeof server.name === 'string' &&
          typeof server.port === 'number' &&
          typeof server.voiceChannel === 'string' &&
          typeof server.textChannel === 'string' &&
          typeof server.createdAt === 'number' &&
          typeof server.lastStarted === 'number'
        ))
        .sort((a, b) => b.lastStarted - a.lastStarted)
        .slice(0, 10);
    } catch (e) {
      this.createdServers = [];
    }
  }

  public saveCreatedServer(server: CreatedServer): void {
    const existingIdx = this.createdServers.findIndex((s) => s.id === server.id);
    if (existingIdx >= 0) {
      const existing = this.createdServers[existingIdx];
      this.createdServers[existingIdx] = {
        ...existing,
        ...server,
        createdAt: existing.createdAt || server.createdAt,
      };
    } else {
      this.createdServers.unshift(server);
    }

    this.createdServers.sort((a, b) => b.lastStarted - a.lastStarted);
    this.createdServers = this.createdServers.slice(0, 10);

    try {
      localStorage.setItem('monky_created_servers', JSON.stringify(this.createdServers));
    } catch (e) {}
  }

  public removeCreatedServer(id: string): void {
    this.createdServers = this.createdServers.filter((s) => s.id !== id);
    try {
      localStorage.setItem('monky_created_servers', JSON.stringify(this.createdServers));
    } catch (e) {}
  }

  public setIdentity(identity: { publicKey: string; clientId: string } | null): void {
    this.publicKey = identity?.publicKey || '';
    this.clientId = identity?.clientId || '';
    this.hasIdentity = !!identity;
  }
}

export const connectionStore = new ConnectionStore();
