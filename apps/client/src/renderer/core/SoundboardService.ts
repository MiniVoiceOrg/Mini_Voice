import { MessageType, SoundboardPlayedPayload } from '@mini-voice/shared';
import { appEvents } from './EventBus';
import { networkClient } from './NetworkClient';
import { settingsStore } from '../stores/settingsStore';
import { voiceStore } from '../stores/voiceStore';
import { serverStore } from '../stores/serverStore';

export interface SoundItem {
  name: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  ext: string;
}

export interface ActiveSoundPlayback {
  userId: string;
  userName?: string;
  soundName: string;
  audio: HTMLAudioElement;
}

export class SoundboardService {
  private sounds: SoundItem[] = [];
  private sinkId: string = '';
  private activePlaybacks: Map<string, ActiveSoundPlayback> = new Map();

  private isCapturingKey: boolean = false;

  constructor() {
    this.setupListeners();
    this.loadSounds();
  }

  private setupListeners(): void {
    // Listen to network events when another user or server sends a soundboard play
    appEvents.on(`message.${MessageType.SOUNDBOARD_PLAYED}`, (payload: SoundboardPlayedPayload) => {
      this.handleIncomingSound(payload);
    });

    // Update speaker device when settings change
    appEvents.on('settings.updated', () => {
      if (settingsStore.selectedSpeakerId && settingsStore.selectedSpeakerId !== this.sinkId) {
        this.setSinkId(settingsStore.selectedSpeakerId);
      }
    });

    // Listen to global shortcuts triggered via Electron
    if (window.api?.onSoundboardShortcutTriggered) {
      window.api.onSoundboardShortcutTriggered((soundName: string) => {
        if (this.isCapturingKey) return;
        const sound = this.sounds.find((s) => s.name === soundName);
        if (sound) {
          this.playSound(sound.filePath);
        }
      });
    }
  }

  public setCapturingKey(active: boolean): void {
    this.isCapturingKey = active;
  }

  public async pauseShortcuts(): Promise<void> {
    if (!window.api?.registerSoundboardShortcuts) return;
    try {
      await window.api.registerSoundboardShortcuts([]);
    } catch (err) {
      console.warn('[SoundboardService] Failed to pause shortcuts:', err);
    }
  }

  public async syncShortcuts(): Promise<void> {
    if (!window.api?.registerSoundboardShortcuts) return;
    try {
      const shortcuts = settingsStore.soundboardShortcuts;
      const list = Object.entries(shortcuts)
        .filter(([_, data]) => data && data.accelerator)
        .map(([soundName, data]) => ({
          soundName,
          accelerator: data.accelerator,
        }));
      await window.api.registerSoundboardShortcuts(list);
    } catch (err) {
      console.warn('[SoundboardService] Failed to sync shortcuts:', err);
    }
  }

  public setSinkId(sinkId: string): void {
    this.sinkId = sinkId;
    for (const playback of this.activePlaybacks.values()) {
      if (typeof (playback.audio as any).setSinkId === 'function') {
        (playback.audio as any).setSinkId(sinkId).catch(() => {});
      }
    }
  }

  public async loadSounds(): Promise<SoundItem[]> {
    const folder = settingsStore.soundboardFolderPath;
    if (!folder || !window.api?.listSoundboardSounds) {
      this.sounds = [];
      appEvents.emit('soundboard.sounds_loaded', this.sounds);
      return [];
    }

    try {
      this.sounds = await window.api.listSoundboardSounds(folder);
      appEvents.emit('soundboard.sounds_loaded', this.sounds);
      this.syncShortcuts();
      return this.sounds;
    } catch (err) {
      console.warn('[SoundboardService] Error loading sounds from folder:', err);
      this.sounds = [];
      appEvents.emit('soundboard.sounds_loaded', this.sounds);
      return [];
    }
  }

  public getSounds(): SoundItem[] {
    return this.sounds;
  }

  public getPlayingSoundNames(): Set<string> {
    const active = new Set<string>();
    for (const p of this.activePlaybacks.values()) {
      if (!p.audio.paused && !p.audio.ended) {
        active.add(p.soundName);
      }
    }
    return active;
  }

  public getActivePlaybacks(): ActiveSoundPlayback[] {
    return Array.from(this.activePlaybacks.values()).filter(
      (p) => !p.audio.paused && !p.audio.ended
    );
  }

  public getCurrentPlayback(): {
    soundName: string | null;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    activeCount: number;
  } {
    const active = this.getActivePlaybacks();
    const latest = active[active.length - 1];
    return {
      soundName: latest ? latest.soundName : null,
      isPlaying: active.length > 0,
      currentTime: latest?.audio.currentTime || 0,
      duration: latest?.audio.duration || 0,
      activeCount: active.length,
    };
  }

  public stopSoundForUser(userId: string): void {
    const existing = this.activePlaybacks.get(userId);
    if (existing) {
      try {
        existing.audio.pause();
        existing.audio.currentTime = 0;
      } catch (err) {
        console.warn('[SoundboardService] Error stopping user audio:', err);
      }
      this.activePlaybacks.delete(userId);
      appEvents.emit('soundboard.playback_ended', { userId, soundName: existing.soundName });
    }
  }

  public stopSound(userId?: string): void {
    if (userId) {
      this.stopSoundForUser(userId);
      return;
    }
    for (const [uid, playback] of Array.from(this.activePlaybacks.entries())) {
      try {
        playback.audio.pause();
        playback.audio.currentTime = 0;
      } catch (err) {
        console.warn('[SoundboardService] Error stopping audio:', err);
      }
      appEvents.emit('soundboard.playback_ended', { userId: uid, soundName: playback.soundName });
    }
    this.activePlaybacks.clear();
  }

  public async selectFolder(): Promise<string | null> {
    if (!window.api?.selectSoundboardFolder) return null;
    const folder = await window.api.selectSoundboardFolder();
    if (folder) {
      settingsStore.soundboardFolderPath = folder;
      settingsStore.save();
      await this.loadSounds();
    }
    return folder;
  }

  public async playSound(filePath: string): Promise<boolean> {
    if (!window.api?.readSoundboardSound) return false;

    // Must be in a voice channel to broadcast sound to the room
    const currentChannelId = voiceStore.currentVoiceChannelId;
    if (!currentChannelId) {
      console.warn('[SoundboardService] Cannot play sound: not in a voice channel');
      // Local preview if clicked outside call
      await this.playLocalPreview(filePath);
      return true;
    }

    // Check if server allows soundboard
    if (serverStore.serverDetails?.allowSoundboard === false) {
      console.warn('[SoundboardService] Soundboard is disabled on this server');
      return false;
    }

    try {
      const soundData = await window.api.readSoundboardSound(filePath);
      if (!soundData) {
        console.warn('[SoundboardService] Failed to read sound file:', filePath);
        return false;
      }

      // Send to server via WebSocket to broadcast to channel members
      networkClient.send(MessageType.SOUNDBOARD_PLAY, {
        channelId: currentChannelId,
        soundName: soundData.soundName,
        audioBase64: soundData.base64,
        mimeType: soundData.mimeType,
      });

      return true;
    } catch (err) {
      console.error('[SoundboardService] Error playing soundboard sound:', err);
      return false;
    }
  }

  private playAudioForUser(
    audio: HTMLAudioElement,
    userId: string,
    userName: string | undefined,
    soundName: string
  ): void {
    const playback: ActiveSoundPlayback = {
      userId,
      userName,
      soundName,
      audio,
    };
    this.activePlaybacks.set(userId, playback);

    const cleanup = () => {
      if (this.activePlaybacks.get(userId)?.audio === audio) {
        this.activePlaybacks.delete(userId);
        appEvents.emit('soundboard.playback_ended', { userId, soundName });
      }
    };

    audio.addEventListener('play', () => {
      appEvents.emit('soundboard.playback_started', {
        userId,
        userName,
        soundName,
        duration: audio.duration || 0,
      });
    });

    audio.addEventListener('timeupdate', () => {
      const duration = audio.duration || 0;
      const currentTime = audio.currentTime || 0;
      const percent = duration > 0 ? (currentTime / duration) * 100 : 0;
      appEvents.emit('soundboard.playback_progress', {
        userId,
        userName,
        soundName,
        currentTime,
        duration,
        percent: Math.min(100, Math.max(0, percent)),
      });
    });

    audio.addEventListener('ended', cleanup);
    audio.addEventListener('pause', cleanup);
    audio.addEventListener('error', (e) => {
      console.warn('[SoundboardService] Audio error:', e);
      cleanup();
    });

    audio.play().catch((err) => {
      console.warn('[SoundboardService] Audio play error:', err);
      cleanup();
    });
  }

  private async playLocalPreview(filePath: string): Promise<void> {
    try {
      const soundData = await window.api.readSoundboardSound(filePath);
      if (!soundData) return;

      if (settingsStore.soundboardMuted || settingsStore.soundboardVolume <= 0) {
        return;
      }

      this.stopSoundForUser('local');

      const audio = new Audio(soundData.dataUrl);
      audio.volume = Math.max(0, Math.min(1, settingsStore.soundboardVolume / 100));

      if (this.sinkId && typeof (audio as any).setSinkId === 'function') {
        (audio as any).setSinkId(this.sinkId).catch(() => {});
      }

      this.playAudioForUser(audio, 'local', 'Você', soundData.soundName);
    } catch (err) {
      console.warn('[SoundboardService] Local preview failed:', err);
    }
  }

  public async handleIncomingSound(payload: SoundboardPlayedPayload): Promise<void> {
    appEvents.emit('soundboard.played', payload);

    // If local user has muted soundboards or set volume to 0, do not play
    if (settingsStore.soundboardMuted || settingsStore.soundboardVolume <= 0) {
      return;
    }

    const userId = payload.userId || 'unknown';

    // Per #156: If the SAME user triggers another sound, interrupt and replace their own previous sound.
    // Different users play their sounds concurrently at the same time.
    this.stopSoundForUser(userId);

    try {
      const dataUrl = payload.audioBase64.startsWith('data:')
        ? payload.audioBase64
        : `data:${payload.mimeType || 'audio/mp3'};base64,${payload.audioBase64}`;

      const audio = new Audio(dataUrl);
      audio.volume = Math.max(0, Math.min(1, settingsStore.soundboardVolume / 100));

      const targetSink = this.sinkId || settingsStore.selectedSpeakerId;
      if (targetSink && typeof (audio as any).setSinkId === 'function') {
        (audio as any).setSinkId(targetSink).catch(() => {});
      }

      this.playAudioForUser(audio, userId, payload.userName, payload.soundName);
    } catch (err) {
      console.warn('[SoundboardService] Failed to play incoming soundboard audio:', err);
    }
  }
}

export const soundboardService = new SoundboardService();
