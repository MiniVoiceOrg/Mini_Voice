import { ConnectionStatus } from '../core/NetworkClient';

export interface SavedServer {
  host: string;
  port: number;
  name: string;
  lastConnected: number;
  password?: string;
}

export class ConnectionStore {
  public status: ConnectionStatus = 'DISCONNECTED';
  public clientId: string = '';
  public lastError: string | null = null;
  public savedServers: SavedServer[] = [];
  public savedNickname: string = '';
  public savedAvatarBase64: string = '';

  constructor() {
    this.loadSavedServers();
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

  public saveUserProfile(nickname: string, avatarBase64?: string): void {
    if (nickname) {
      this.savedNickname = nickname;
      try {
        localStorage.setItem('mini_voice_nickname', nickname);
      } catch (e) {}
    }
    if (avatarBase64 !== undefined) {
      this.savedAvatarBase64 = avatarBase64;
      try {
        localStorage.setItem('mini_voice_avatar', avatarBase64);
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
}

export const connectionStore = new ConnectionStore();
