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
  | 'leave_voice';

export class SoundEffectManager {
  private audioMap: Partial<Record<SoundEffectType, HTMLAudioElement>> = {};

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

  public play(key: SoundEffectType): void {
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
