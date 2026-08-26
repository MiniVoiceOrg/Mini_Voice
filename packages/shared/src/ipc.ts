/**
 * Contrato de Tipagem Unificado para IPC (Inter-Process Communication)
 * Define as mensagens e eventos trafegados entre o Main Process e o Renderer Process.
 */

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

export interface SoundboardShortcutBinding {
  soundName: string;
  accelerator: string;
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
  'server-host:status': { args: []; returnType: { isRunning: boolean } };

  // LAN Discovery
  'lan:start': { args: []; returnType: void };
  'lan:stop': { args: []; returnType: void };

  // Captura de Tela
  'screen-share:get-sources': { args: []; returnType: DesktopSource[] };

  // Diálogos Nativos
  'dialog:select-image': { args: []; returnType: ImageSelectionResult | null };
  'dialog:select-sound-file': { args: []; returnType: string | null };
  'dialog:select-soundboard-folder': { args: []; returnType: string | null };

  // Soundboard
  'soundboard:list-sounds': { args: [folderPath: string]; returnType: SoundboardSoundEntry[] };
  'soundboard:read-sound': { args: [filePath: string]; returnType: SoundboardSoundData | null };
  'soundboard:register-shortcuts': { args: [shortcuts: SoundboardShortcutBinding[]]; returnType: boolean };

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
  'updater:download': { args: []; returnType: UpdateSimpleResult };
  'updater:install': { args: []; returnType: UpdateSimpleResult };
}

/**
 * Mapeamento de Eventos Unidirecionais (Main -> Renderer via webContents.send)
 */
export interface IpcEvents {
  'lan:found': [server: DiscoveredLanServer];
  'lan:lost': [server: DiscoveredLanServer];
  'soundboard:shortcut-triggered': [soundName: string];
  'screen-audio:frame': [buffer: ArrayBuffer | Uint8Array];
  'tray:toggle-mute': [];
  'tray:toggle-deafen': [];
  'updater:progress': [percent: number];
  'updater:downloaded': [info: { manual: boolean }];
  'updater:error': [message: string];
}

export type IpcInvokeChannel = keyof IpcInvokeChannels;
export type IpcEventChannel = keyof IpcEvents;
