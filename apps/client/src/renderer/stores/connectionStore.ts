import { ConnectionStatus } from '../core/NetworkClient';

export interface SavedServer {
  host: string;
  port: number;
  name: string;
  lastConnected: number;
  password?: string;
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
      this.savedNickname = localStorage.getItem('mini_voice_nickname') || '';
      this.savedAvatarBase64 = localStorage.getItem('mini_voice_avatar') || '';
    } catch (e) {
      this.savedNickname = '';
      this.savedAvatarBase64 = '';
    }
  }

  public saveUserProfile(nickname: string, avatarBase64?: string | null): void {
    if (nickname) {
      this.savedNickname = nickname;
      try {
        localStorage.setItem('mini_voice_nickname', nickname);
      } catch (e) {}
    }
    if (avatarBase64 !== undefined) {
      this.savedAvatarBase64 = avatarBase64 || '';
      try {
        if (avatarBase64) {
          localStorage.setItem('mini_voice_avatar', avatarBase64);
        } else {
          localStorage.removeItem('mini_voice_avatar');
        }
      } catch (e) {}
    }
  }

  public loadSavedServers(): void {
    try {
      const raw = localStorage.getItem('mini_voice_saved_servers');
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
      // Preserve existing name if new one is default/empty
      if (!server.name && this.savedServers[existingIdx].name) {
        server.name = this.savedServers[existingIdx].name;
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
      localStorage.setItem('mini_voice_saved_servers', JSON.stringify(this.savedServers));
    } catch (e) {}
  }

  public removeSavedServer(host: string, port: number): void {
    this.savedServers = this.savedServers.filter((s) => !(s.host === host && s.port === port));
    try {
      localStorage.setItem('mini_voice_saved_servers', JSON.stringify(this.savedServers));
    } catch (e) {}
  }

  public loadCreatedServers(): void {
    try {
      const raw = localStorage.getItem('mini_voice_created_servers');
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
      localStorage.setItem('mini_voice_created_servers', JSON.stringify(this.createdServers));
    } catch (e) {}
  }

  public removeCreatedServer(id: string): void {
    this.createdServers = this.createdServers.filter((s) => s.id !== id);
    try {
      localStorage.setItem('mini_voice_created_servers', JSON.stringify(this.createdServers));
    } catch (e) {}
  }
}

export const connectionStore = new ConnectionStore();
