import micUnmuteUrl from '../assets/sounds/Desmutando_Mic.wav';
import micMuteUrl from '../assets/sounds/Mutando_Mic.wav';
import deafenUrl from '../assets/sounds/Mutar_Auto-Falante.wav';
import undeafenUrl from '../assets/sounds/Desmutar_Auto-Falante.wav';
import joinVoiceUrl from '../assets/sounds/Entrando_Na_Call.wav';
import leaveVoiceUrl from '../assets/sounds/Saindo_Da_Call.wav';
import { settingsStore } from '../stores/settingsStore';

export type SoundEffectType =
  | 'mic_mute'
  | 'mic_unmute'
  | 'deafen'
  | 'undeafen'
  | 'join_voice'
  | 'leave_voice'
  | 'screen_share_start'
  | 'screen_share_stop'
  | 'chat_message';

const DEFAULT_URLS: Record<string, string> = {
  mic_unmute: micUnmuteUrl,
  mic_mute: micMuteUrl,
  deafen: deafenUrl,
  undeafen: undeafenUrl,
  join_voice: joinVoiceUrl,
  leave_voice: leaveVoiceUrl,
};

export const SOUND_LABELS: Record<string, string> = {
  mic_mute: 'Mutar microfone',
  mic_unmute: 'Desmutar microfone',
  deafen: 'Mutar auto-falante',
  undeafen: 'Desmutar auto-falante',
  join_voice: 'Entrar no canal',
  leave_voice: 'Sair do canal',
  screen_share_start: 'Iniciar compartilhamento',
  screen_share_stop: 'Parar compartilhamento',
};

export class SoundEffectManager {
  private audioMap: Partial<Record<SoundEffectType, HTMLAudioElement>> = {};
  private toneCtx: AudioContext | null = null;

  constructor() {
    this.loadAll();
  }

  public loadAll(): void {
    const customSounds = settingsStore.customSounds || {};
    for (const [key, defaultUrl] of Object.entries(DEFAULT_URLS)) {
      const url = customSounds[key] || defaultUrl;
      this.preload(key as SoundEffectType, url);
    }
  }

  public reloadSound(key: SoundEffectType, url?: string): void {
    const finalUrl = url || DEFAULT_URLS[key];
    if (finalUrl) this.preload(key, finalUrl);
  }

  private preload(key: SoundEffectType, url: string): void {
    try {
      const audio = new Audio(url);
      audio.volume = 0.6;
      this.applySink(audio);
      this.audioMap[key] = audio;
    } catch (e) {
      console.warn(`[SoundEffects] Error preloading sound ${key}:`, e);
    }
  }

  /**
   * Routes an audio element to the speaker device selected in the app so that
   * sound effects respect the user's choice instead of the OS default.
   */
  private applySink(audio: HTMLAudioElement): Promise<void> {
    const deviceId = settingsStore.selectedSpeakerId;
    if (deviceId && typeof (audio as any).setSinkId === 'function' && (audio as any).sinkId !== deviceId) {
      return (audio as any).setSinkId(deviceId).catch(() => {
        /* device may be gone; ignore and fall back to default */
      });
    }
    return Promise.resolve();
  }

  /** Reapplies the currently selected speaker to all preloaded sound effects. */
  public setSinkId(deviceId: string): void {
    for (const audio of Object.values(this.audioMap)) {
      if (audio && typeof (audio as any).setSinkId === 'function') {
        (audio as any).setSinkId(deviceId).catch(() => {});
      }
    }
    if (this.toneCtx && typeof (this.toneCtx as any).setSinkId === 'function') {
      (this.toneCtx as any).setSinkId(deviceId).catch(() => {});
    }
  }

  /**
   * Synthesizes a short two-note cue for screen-share start/stop using the Web
   * Audio API, so no extra binary assets are needed. A rising interval signals
   * "start" and a falling interval signals "stop".
   */
  private playTone(rising: boolean): void {
    try {
      if (!this.toneCtx) {
        const Ctor = window.AudioContext || (window as any).webkitAudioContext;
        this.toneCtx = new Ctor();
        if (settingsStore.selectedSpeakerId && typeof (this.toneCtx as any).setSinkId === 'function') {
          (this.toneCtx as any).setSinkId(settingsStore.selectedSpeakerId).catch(() => {});
        }
      }
      const ctx = this.toneCtx!;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      const now = ctx.currentTime;
      const freqs = rising ? [523.25, 783.99] : [783.99, 523.25];
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
      gain.connect(ctx.destination);

      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.13);
        osc.connect(gain);
        osc.start(now + i * 0.13);
        osc.stop(now + i * 0.13 + 0.16);
      });
    } catch (e) {
      console.debug('[SoundEffects] Tone synthesis failed:', e);
    }
  }

  /**
   * Synthesizes a soft, quick two-note "pop" used to signal an incoming chat
   * message (#152). Kept lighter and shorter than the screen-share cue so the
   * two are easy to tell apart.
   */
  private playChatCue(): void {
    try {
      if (!this.toneCtx) {
        const Ctor = window.AudioContext || (window as any).webkitAudioContext;
        this.toneCtx = new Ctor();
        if (settingsStore.selectedSpeakerId && typeof (this.toneCtx as any).setSinkId === 'function') {
          (this.toneCtx as any).setSinkId(settingsStore.selectedSpeakerId).catch(() => {});
        }
      }
      const ctx = this.toneCtx!;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      const now = ctx.currentTime;
      const freqs = [659.25, 987.77]; // E5 -> B5, a light ascending blip
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      gain.connect(ctx.destination);

      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.07);
        osc.connect(gain);
        osc.start(now + i * 0.07);
        osc.stop(now + i * 0.07 + 0.1);
      });
    } catch (e) {
      console.debug('[SoundEffects] Chat cue synthesis failed:', e);
    }
  }

  public play(key: SoundEffectType): void {
    if (key === 'screen_share_start') {
      this.playTone(true);
      return;
    }
    if (key === 'screen_share_stop') {
      this.playTone(false);
      return;
    }
    if (key === 'chat_message') {
      this.playChatCue();
      return;
    }
    try {
      const audio = this.audioMap[key];
      if (audio) {
        audio.currentTime = 0;
        // Apply the selected speaker BEFORE playing so the sound doesn't briefly
        // (or entirely) come out of the OS default device (#46).
        this.applySink(audio).finally(() => {
          audio.play().catch((err) => {
            console.debug(`[SoundEffects] Play prevented for ${key}:`, err);
          });
        });
      }
    } catch (e) {
      console.warn(`[SoundEffects] Error playing sound ${key}:`, e);
    }
  }
}

export const soundEffects = new SoundEffectManager();
