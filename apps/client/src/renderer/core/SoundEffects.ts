import micUnmuteUrl from '../assets/sounds/Desmutando_Mic.mp3';
import micMuteUrl from '../assets/sounds/Mutando_Mic.mp3';
import deafenUrl from '../assets/sounds/Mutar_Auto-Falante.mp3';
import undeafenUrl from '../assets/sounds/Desmutar_Auto-Falante.mp3';
import joinVoiceUrl from '../assets/sounds/Entrando_Na_Call.mp3';
import leaveVoiceUrl from '../assets/sounds/Saindo_Da_Call.mp3';

export type SoundEffectType =
  | 'mic_mute'
  | 'mic_unmute'
  | 'deafen'
  | 'undeafen'
  | 'join_voice'
  | 'leave_voice'
  | 'screen_share_start'
  | 'screen_share_stop';

export class SoundEffectManager {
  private audioMap: Partial<Record<SoundEffectType, HTMLAudioElement>> = {};
  private toneCtx: AudioContext | null = null;

  constructor() {
    this.preload('mic_unmute', micUnmuteUrl);
    this.preload('mic_mute', micMuteUrl);
    this.preload('deafen', deafenUrl);
    this.preload('undeafen', undeafenUrl);
    this.preload('join_voice', joinVoiceUrl);
    this.preload('leave_voice', leaveVoiceUrl);
  }

  private preload(key: SoundEffectType, url: string): void {
    try {
      const audio = new Audio(url);
      audio.volume = 0.6;
      this.audioMap[key] = audio;
    } catch (e) {
      console.warn(`[SoundEffects] Error preloading sound ${key}:`, e);
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

  public play(key: SoundEffectType): void {
    if (key === 'screen_share_start') {
      this.playTone(true);
      return;
    }
    if (key === 'screen_share_stop') {
      this.playTone(false);
      return;
    }
    try {
      const audio = this.audioMap[key];
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch((err) => {
          console.debug(`[SoundEffects] Play prevented for ${key}:`, err);
        });
      }
    } catch (e) {
      console.warn(`[SoundEffects] Error playing sound ${key}:`, e);
    }
  }
}

export const soundEffects = new SoundEffectManager();
