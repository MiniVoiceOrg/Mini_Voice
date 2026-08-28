/**
 * Contrato de Tipagem Unificado para IPC (Inter-Process Communication)
 * Define as mensagens e eventos trafegados entre o Main Process e o Renderer Process.
 */

import type { LogEntry } from './logging.js';

export interface DesktopSource {
  id: string;
  name: string;
  type: 'screen' | 'window';
  thumbnailDataUrl: string;
  appIconDataUrl: string | null;
}

export interface ImageSelectionResult {
  fileName: string;
  mimeType: string;
  base64: string;
}

export interface SoundboardSoundEntry {
  name: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  ext: string;
}

export interface SoundboardSoundData {
  fileName: string;
  soundName: string;
  mimeType: string;
  base64: string;
  dataUrl: string;
  sizeBytes: number;
}

/** One custom sticker image found in the user's stickers folder (#356). */
export interface StickerEntry {
  name: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  ext: string;
  mimeType: string;
}

/**
 * The bytes of a single sticker. Read on demand (when a tile scrolls into view
 * or the sticker is sent) so a large folder never loads entirely into memory.
 */
export interface StickerData {
  fileName: string;
  mimeType: string;
  dataUrl: string;
  sizeBytes: number;
}

export interface SoundboardShortcutBinding {
  soundName: string;
  accelerator: string;
}

export interface ActionShortcutBinding {
  action: string;
  accelerator: string;
}

export interface PttKeyBinding {
  code: string;
  display: string;
  keyType: 'keyboard' | 'mouse';
  keyCode?: number;
  mouseButton?: number;
}

export interface PttConfig {
  enabled: boolean;
  key: PttKeyBinding | null;
}

export interface LinkPreviewData {
  url: string;
  title: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
  embedType?: 'youtube' | 'spotify';
  embedUrl?: string;
}

export interface ServerProbeResult {
  reachable: boolean;
  reason: 'online' | 'refused' | 'timeout' | 'unreachable';
}

export interface ScreenAudioDiagnostics {
  nativeModuleLoaded: boolean;
  platformSupported: boolean;
  osVersion: string;
  pid: number;
  captureStatus?: number;
  lastError?: string;
}

export interface TrayVoiceStatus {
  inCall: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  isSpeaking: boolean;
}

export interface UpdateCheckResult {
  ok: boolean;
  available?: boolean;
  version?: string;
  error?: string;
}

export interface UpdateSimpleResult {
  ok: boolean;
  error?: string;
}

export interface DiscoveredLanServer {
  host: string;
  port: number;
  serverName: string;
  version: string;
}

export interface HostServerOptions {
  port: number;
  serverName: string;
  password?: string;
  initialVoiceChannel?: string;
  initialTextChannel?: string;
  /** Id of the entry in "Meus Servidores" that owns this instance (#333). */
  serverId?: string;
}

/**
 * Snapshot of a locally hosted server, shown to whoever is running it.
 * Deliberately cheap to produce: it is polled by the UI.
 */
export interface ServerStats {
  serverName: string;
  port: number;
  dataDir: string;
  /** Epoch ms of the last successful start, or null when stopped. */
  startedAt: number | null;
  uptimeMs: number;
  /** People currently connected, not sessions — one person may use several devices. */
  onlineUsers: number;
  maxUsers: number;
  members: number;
  channels: number;
  messages: number;
}

export interface AppIdentityResult {
  publicKey: string;
  clientId: string;
}

/**
 * Mapeamento de Canais Bidirecionais (Invoke / Handle)
 */
export interface IpcInvokeChannels {
  // Janela
  'window:minimize': { args: []; returnType: void };
  'window:toggle-maximize': { args: []; returnType: void };
  'window:close': { args: []; returnType: void };

  // Sistema / App
  'app:set-language': { args: [language: string]; returnType: void };
  'app:get-version': { args: []; returnType: string };
  'app:open-external': { args: [url: string]; returnType: { success: boolean } };
  'app:get-auto-start': { args: []; returnType: boolean };
  'app:set-auto-start': { args: [enabled: boolean]; returnType: void };
  'app:set-minimize-to-tray': { args: [enabled: boolean]; returnType: void };
  'app:download-file': { args: [url: string, fileName: string]; returnType: { success: boolean; error?: string } };

  // Identidade
  'identity:has': { args: []; returnType: boolean };
  'identity:get': { args: []; returnType: AppIdentityResult };
  'identity:get-client-id': { args: []; returnType: string };
  'identity:sign-challenge': { args: [nonceHex: string]; returnType: string };
  'identity:export': { args: [password: string]; returnType: string };
  'identity:import': { args: [exportedIdentity: string, password: string]; returnType: AppIdentityResult };

  // Servidor Local
  'server-host:start': { args: [options: HostServerOptions]; returnType: { success: boolean; error?: string } };
  'server-host:stop': { args: []; returnType: { success: boolean } };
  'server-host:status': { args: []; returnType: { isRunning: boolean; port: number | null; serverId: string | null } };
  'server-host:logs': { args: []; returnType: LogEntry[] };
  'server-host:clear-logs': { args: []; returnType: void };
  'server-host:stats': { args: []; returnType: ServerStats | null };

  // LAN Discovery
  'lan:start': { args: []; returnType: void };
  'lan:stop': { args: []; returnType: void };

  // Captura de Tela
  'screen-share:get-sources': { args: []; returnType: DesktopSource[] };

  // Diálogos Nativos
  'dialog:select-image': { args: []; returnType: ImageSelectionResult | null };
  'dialog:select-sound-file': { args: []; returnType: string | null };
  'dialog:select-soundboard-folder': { args: []; returnType: string | null };
  'dialog:select-stickers-folder': { args: []; returnType: string | null };

  // Soundboard
  'soundboard:list-sounds': { args: [folderPath: string]; returnType: SoundboardSoundEntry[] };
  'soundboard:read-sound': { args: [filePath: string]; returnType: SoundboardSoundData | null };
  'soundboard:register-shortcuts': { args: [shortcuts: SoundboardShortcutBinding[]]; returnType: boolean };

  // Figurinhas do chat (#356)
  'stickers:list': { args: [folderPath: string]; returnType: StickerEntry[] };
  'stickers:read': { args: [filePath: string]; returnType: StickerData | null };

  // Atalhos Globais (Keybinds)
  'shortcuts:register-actions': { args: [shortcuts: ActionShortcutBinding[]]; returnType: boolean };

  // Push to Talk (PTT) (#186)
  'ptt:set-config': { args: [config: PttConfig]; returnType: boolean };
  'ptt:start-capture': { args: []; returnType: boolean };
  'ptt:stop-capture': { args: []; returnType: boolean };

  // Link Preview
  'link-preview:fetch': { args: [url: string]; returnType: LinkPreviewData | null };

  // Rede
  'net:probe-server': { args: [host: string, port: number]; returnType: ServerProbeResult };

  // Áudio da Tela (Nativo)
  'screen-audio:is-supported': { args: []; returnType: boolean };
  'screen-audio:diagnose': { args: []; returnType: ScreenAudioDiagnostics };
  'screen-audio:start': { args: [sourceId?: string]; returnType: { success: boolean; error?: string } };
  'screen-audio:stop': { args: []; returnType: { success: boolean } };

  // Bandeja do Sistema (Tray)
  'tray:update-voice-status': { args: [status: TrayVoiceStatus]; returnType: void };

  // Atualizador
  'updater:set-channel': { args: [allowBeta: boolean]; returnType: UpdateSimpleResult };
  'updater:check': { args: []; returnType: UpdateCheckResult };
  'updater:download': { args: [allowBeta: boolean]; returnType: UpdateSimpleResult };
  'updater:install': { args: []; returnType: UpdateSimpleResult };
}

/**
 * Mapeamento de Eventos Unidirecionais (Main -> Renderer via webContents.send)
 */
export interface IpcEvents {
  'lan:found': [server: DiscoveredLanServer];
  'lan:lost': [server: DiscoveredLanServer];
  'soundboard:shortcut-triggered': [soundName: string];
  'shortcut:action-triggered': [action: string];
  'ptt:state-changed': [active: boolean];
  'ptt:captured': [binding: PttKeyBinding];
  'screen-audio:frame': [buffer: ArrayBuffer | Uint8Array];
  'tray:toggle-mute': [];
  'tray:toggle-deafen': [];
  'updater:progress': [percent: number];
  'updater:downloaded': [info: { manual: boolean }];
  'updater:error': [message: string];
  'server-host:log': [entry: LogEntry];
}

export type IpcInvokeChannel = keyof IpcInvokeChannels;
export type IpcEventChannel = keyof IpcEvents;
