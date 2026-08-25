import { contextBridge, ipcRenderer } from 'electron';

type LogLevel = 'INFO' | 'WARN' | 'ERROR';
type ChannelType = 'TEXT' | 'VOICE';

interface GuiLogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  category: string;
  message: string;
}

interface GuiStats {
  members: number;
  channels: number;
  messages: number;
}

interface GuiStatus {
  running: boolean;
  startedAt: number | null;
  uptimeMs: number;
  serverName: string;
  port: number;
  connectedUsers: number;
  dataDir: string;
  diskUsageBytes: number;
  maxUsers: number;
  allowSoundboard: boolean;
  stats: GuiStats;
}

interface GuiChannel {
  id: string;
  serverId: string;
  name: string;
  type: ChannelType;
  position: number;
  createdAt: number;
  maxParticipants: number;
}

interface GuiConfig {
  serverName: string;
  port: number;
  maxUsers: number;
  dataDir: string;
  allowSoundboard: boolean;
  hasPassword: boolean;
  channels: GuiChannel[];
}

interface GuiMember {
  id: string;
  nickname: string;
  clientId: string;
  roles: string[];
  lastSeenAt: number;
  online: boolean;
  isAdmin: boolean;
}

interface SetConfigInput {
  serverName: string;
  port: number;
  maxUsers: number;
  dataDir: string;
  allowSoundboard: boolean;
  password?: string;
  clearPassword?: boolean;
}

interface CreateChannelInput {
  name: string;
  type: ChannelType;
}

interface RendererApi {
  getStatus(): Promise<GuiStatus>;
  startServer(): Promise<GuiStatus>;
  stopServer(): Promise<GuiStatus>;
  getMembers(): Promise<GuiMember[]>;
  setMemberAdmin(userId: string, makeAdmin: boolean): Promise<GuiMember[]>;
  kickMember(userId: string): Promise<GuiMember[]>;
  getConfig(): Promise<GuiConfig>;
  setConfig(config: SetConfigInput): Promise<GuiConfig>;
  createChannel(input: CreateChannelInput): Promise<GuiConfig>;
  renameChannel(channelId: string, name: string): Promise<GuiConfig>;
  deleteChannel(channelId: string): Promise<GuiConfig>;
  getLogs(): Promise<GuiLogEntry[]>;
  clearLogs(): Promise<void>;
  pickDataDirectory(): Promise<string | null>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  onLog(callback: (entry: GuiLogEntry) => void): () => void;
}

const api: RendererApi = {
  getStatus: () => ipcRenderer.invoke('server-gui:get-status'),
  startServer: () => ipcRenderer.invoke('server-gui:start-server'),
  stopServer: () => ipcRenderer.invoke('server-gui:stop-server'),
  getMembers: () => ipcRenderer.invoke('server-gui:get-members'),
  setMemberAdmin: (userId, makeAdmin) => ipcRenderer.invoke('server-gui:set-member-admin', { userId, makeAdmin }),
  kickMember: (userId) => ipcRenderer.invoke('server-gui:kick-member', userId),
  getConfig: () => ipcRenderer.invoke('server-gui:get-config'),
  setConfig: (config) => ipcRenderer.invoke('server-gui:set-config', config),
  createChannel: (input) => ipcRenderer.invoke('server-gui:create-channel', input),
  renameChannel: (channelId, name) => ipcRenderer.invoke('server-gui:rename-channel', { channelId, name }),
  deleteChannel: (channelId) => ipcRenderer.invoke('server-gui:delete-channel', channelId),
  getLogs: () => ipcRenderer.invoke('server-gui:get-logs'),
  clearLogs: () => ipcRenderer.invoke('server-gui:clear-logs'),
  pickDataDirectory: () => ipcRenderer.invoke('server-gui:pick-data-directory'),
  minimizeWindow: () => ipcRenderer.invoke('server-gui:minimize-window'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('server-gui:toggle-maximize-window'),
  closeWindow: () => ipcRenderer.invoke('server-gui:close-window'),
  onLog: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: GuiLogEntry) => callback(entry);
    ipcRenderer.on('server-gui:log', listener);
    return () => ipcRenderer.removeListener('server-gui:log', listener);
  },
};

contextBridge.exposeInMainWorld('monkyApi', api);
