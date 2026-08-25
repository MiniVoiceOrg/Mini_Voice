import { MessageType, SoundboardPlayedPayload } from '@monky/shared';
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

export class SoundboardService {
  private sounds: SoundItem[] = [];
  private audioContext: AudioContext | null = null;
  private sinkId: string = '';
  private currentAudio: HTMLAudioElement | null = null;
  private currentSoundName: string | null = null;

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

  public getCurrentPlayback(): { soundName: string | null; isPlaying: boolean; currentTime: number; duration: number } {
    return {
      soundName: this.currentSoundName,
      isPlaying: !!this.currentAudio && !this.currentAudio.paused,
      currentTime: this.currentAudio?.currentTime || 0,
      duration: this.currentAudio?.duration || 0,
    };
  }

  public stopSound(): void {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch (err) {
        console.warn('[SoundboardService] Error stopping audio:', err);
      }
      const soundName = this.currentSoundName || '';
      this.currentAudio = null;
      this.currentSoundName = null;
      appEvents.emit('soundboard.playback_ended', { soundName });
    }
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

  private playAudioInstance(audio: HTMLAudioElement, soundName: string): void {
    // Stop any previously playing sound
    this.stopSound();

    this.currentAudio = audio;
    this.currentSoundName = soundName;

    const cleanup = () => {
      if (this.currentAudio === audio) {
        this.currentAudio = null;
        this.currentSoundName = null;
        appEvents.emit('soundboard.playback_ended', { soundName });
      }
    };

    audio.addEventListener('play', () => {
      appEvents.emit('soundboard.playback_started', {
        soundName,
        duration: audio.duration || 0,
      });
    });

    audio.addEventListener('timeupdate', () => {
      const duration = audio.duration || 0;
      const currentTime = audio.currentTime || 0;
      const percent = duration > 0 ? (currentTime / duration) * 100 : 0;
      appEvents.emit('soundboard.playback_progress', {
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

      const audio = new Audio(soundData.dataUrl);
      audio.volume = Math.max(0, Math.min(1, settingsStore.soundboardVolume / 100));

      if (this.sinkId && typeof (audio as any).setSinkId === 'function') {
        (audio as any).setSinkId(this.sinkId).catch(() => {});
      }

      this.playAudioInstance(audio, soundData.soundName);
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

      this.playAudioInstance(audio, payload.soundName);
    } catch (err) {
      console.warn('[SoundboardService] Failed to play incoming soundboard audio:', err);
    }
  }
}

export const soundboardService = new SoundboardService();
