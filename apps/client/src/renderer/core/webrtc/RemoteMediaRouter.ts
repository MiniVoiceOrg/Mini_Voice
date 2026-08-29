import { settingsStore } from '../../stores/settingsStore';
import { voiceStore } from '../../stores/voiceStore';
import type { ParticipantManager } from '../ParticipantManager';
import type { PeerSession } from '../WebRtcManager';

/**
 * RemoteMediaRouter manages playback, volume, audio routing, speaker device sinks,
 * and video DOM attachments for remote audio and screen tracks.
 */
export class RemoteMediaRouter {
  private audioElements: Map<string, HTMLAudioElement> = new Map();
  private screenAudioElements: Map<string, HTMLAudioElement> = new Map();
  private isDeafened: boolean = false;

  constructor(private getVoiceParticipants: () => ParticipantManager) {}

  public getAudioElement(peerSessionId: string): HTMLAudioElement | undefined {
    return this.audioElements.get(peerSessionId);
  }

  public getScreenAudioElement(peerSessionId: string): HTMLAudioElement | undefined {
    return this.screenAudioElements.get(peerSessionId);
  }

  public setDeafened(deafened: boolean): void {
    this.isDeafened = deafened;
    for (const audioEl of this.audioElements.values()) {
      audioEl.muted = deafened;
    }
    for (const screenAudioEl of this.screenAudioElements.values()) {
      screenAudioEl.muted = deafened;
    }
  }

  public async setSpeakerDeviceId(deviceId: string): Promise<void> {
    for (const audioEl of this.audioElements.values()) {
      await this.applySinkToElement(audioEl, deviceId);
    }
    for (const screenAudioEl of this.screenAudioElements.values()) {
      await this.applySinkToElement(screenAudioEl, deviceId);
    }
  }

  public async applySinkToElement(audioEl: HTMLAudioElement, deviceId?: string, force = false): Promise<void> {
    const sinkId = deviceId ?? settingsStore.selectedSpeakerId;
    if (!sinkId || typeof (audioEl as any).setSinkId !== 'function') return;
    if (!force && (audioEl as any).sinkId === sinkId) return;
    try {
      await (audioEl as any).setSinkId(sinkId);
    } catch (err) {
      console.warn('[WebRTC:MediaRouter] Error setting sink ID for speaker device:', err);
    }
  }

  public routeScreenAudioTrack(peerSessionId: string, track: MediaStreamTrack): void {
    let screenAudioEl = this.screenAudioElements.get(peerSessionId);
    const isDeaf = this.isDeafened || voiceStore.getEffectiveDeafened();
    if (!screenAudioEl) {
      screenAudioEl = document.createElement('audio');
      screenAudioEl.autoplay = true;
      // #150: start silent — screen audio is gated behind "Assistir transmissão"
      // in the stage view, which unmutes this element when the viewer opts in.
      screenAudioEl.muted = true;
      screenAudioEl.setAttribute('data-screen-audio-session', peerSessionId);
      document.body.appendChild(screenAudioEl);
      this.screenAudioElements.set(peerSessionId, screenAudioEl);
    }
    if (isDeaf) {
      screenAudioEl.muted = true;
    }
    const screenStream = new MediaStream([track]);
    screenAudioEl.srcObject = screenStream;
    const participant = this.getVoiceParticipants().get(peerSessionId);
    const volume = settingsStore.getScreenAudioVolume(peerSessionId, participant?.user.clientId);
    screenAudioEl.volume = Math.max(0, Math.min(100, volume)) / 100;
    this.applySinkToElement(screenAudioEl).finally(() => {
      screenAudioEl!.play().catch((e) => console.warn('[WebRTC:MediaRouter] Screen audio play error:', e));
    });
    track.onended = () => {
      const el = this.screenAudioElements.get(peerSessionId);
      if (el) {
        try {
          el.pause();
        } catch {}
        el.srcObject = null;
        el.remove();
        this.screenAudioElements.delete(peerSessionId);
      }
    };
  }

  public routeScreenVideoTrack(
    peerSessionId: string,
    track: MediaStreamTrack,
    shareId: string,
    session: PeerSession | undefined
  ): void {
    if (!session) return;

    // If it was provisionally added to the camera stream (meta arrived late),
    // move it out so it doesn't render as the camera.
    if (session.remoteStream.getTrackById(track.id)) {
      session.remoteStream.removeTrack(track);
      this.getVoiceParticipants().setRemoteStream(peerSessionId, session.remoteStream);
    }

    let screenStream = session.remoteScreenStreams.get(shareId);
    if (!screenStream) {
      screenStream = new MediaStream();
      session.remoteScreenStreams.set(shareId, screenStream);
    }

    // Replace any previous screen video track for this share with this one.
    screenStream.getVideoTracks().forEach((old) => {
      if (old.id !== track.id) {
        try { old.stop(); } catch {}
        screenStream!.removeTrack(old);
      }
    });
    if (!screenStream.getTrackById(track.id)) {
      screenStream.addTrack(track);
    }
    this.getVoiceParticipants().setRemoteScreenStream(peerSessionId, shareId, screenStream);

    const attach = (el: HTMLVideoElement | null) => {
      if (el) {
        el.muted = true;
        if (el.srcObject !== screenStream) {
          el.srcObject = screenStream!;
        }
        el.play().catch(() => {});
      }
    };
    attach(document.getElementById(`video-${peerSessionId}-screen-${shareId}`) as HTMLVideoElement | null);
    attach(document.getElementById(`video-mini-${peerSessionId}-screen-${shareId}`) as HTMLVideoElement | null);
    // Pre-#253 peers don't publish a screenShareIds list, so their tile is keyed
    // by the stage's legacy placeholder rather than by this stream id.
    attach(document.getElementById(`video-${peerSessionId}-screen-legacy`) as HTMLVideoElement | null);
    attach(document.getElementById(`video-mini-${peerSessionId}-screen-legacy`) as HTMLVideoElement | null);

    track.onended = () => {
      try { track.stop(); } catch {}
      screenStream!.removeTrack(track);
      session.remoteScreenStreams.delete(shareId);
      this.getVoiceParticipants().removeRemoteScreenStream(peerSessionId, shareId);
    };
  }

  public ensureVoiceAudioElement(peerSessionId: string, stream: MediaStream): HTMLAudioElement {
    let audioEl = this.audioElements.get(peerSessionId);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.muted = this.isDeafened || voiceStore.getEffectiveDeafened();
      audioEl.setAttribute('data-peer-session', peerSessionId);
      document.body.appendChild(audioEl);
      this.audioElements.set(peerSessionId, audioEl);
    }
    if (audioEl.srcObject !== stream) {
      audioEl.srcObject = stream;
    }
    const participant = this.getVoiceParticipants().get(peerSessionId);
    const volume = settingsStore.getUserVolume(peerSessionId, participant?.user.clientId);
    audioEl.volume = Math.max(0, Math.min(100, volume)) / 100;
    this.applySinkToElement(audioEl).finally(() => {
      audioEl!.play().catch((e) => console.warn('[WebRTC:MediaRouter] Audio play error:', e));
    });
    return audioEl;
  }

  public setPeerVolume(peerSessionId: string, volume: number): void {
    const clamped = Math.max(0, Math.min(100, volume));
    const audioEl = this.audioElements.get(peerSessionId);
    if (audioEl) {
      audioEl.volume = clamped / 100;
    }
  }

  public setScreenAudioVolume(peerSessionId: string, volume: number): void {
    const screenAudioEl = this.screenAudioElements.get(peerSessionId);
    if (screenAudioEl) {
      screenAudioEl.volume = Math.max(0, Math.min(100, volume)) / 100;
    }
  }

  public applyUserVolumes(): void {
    for (const [peerSessionId, audioEl] of this.audioElements.entries()) {
      const participant = this.getVoiceParticipants().get(peerSessionId);
      const vol = settingsStore.getUserVolume(peerSessionId, participant?.user.clientId);
      audioEl.volume = Math.max(0, Math.min(100, vol)) / 100;
    }
  }

  public cleanupPeerMedia(peerSessionId: string, session?: PeerSession): void {
    const audioEl = this.audioElements.get(peerSessionId);
    if (audioEl) {
      try {
        audioEl.pause();
      } catch {}
      audioEl.srcObject = null;
      audioEl.remove();
      this.audioElements.delete(peerSessionId);
    }

    const screenAudioEl = this.screenAudioElements.get(peerSessionId);
    if (screenAudioEl) {
      try {
        screenAudioEl.pause();
      } catch {}
      screenAudioEl.srcObject = null;
      screenAudioEl.remove();
      this.screenAudioElements.delete(peerSessionId);
    }

    if (session) {
      // Explicitly stop all remote voice/camera tracks to free WebRTC decoding buffers
      session.remoteStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });

      // Explicitly stop all remote screen share tracks
      for (const [shareId, screenStream] of session.remoteScreenStreams.entries()) {
        screenStream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {}
        });
        this.getVoiceParticipants().removeRemoteScreenStream(peerSessionId, shareId);
      }
      session.remoteScreenStreams.clear();
    }
  }

  public closeAllMedia(): void {
    for (const audioEl of this.audioElements.values()) {
      try {
        audioEl.pause();
      } catch {}
      audioEl.srcObject = null;
      audioEl.remove();
    }
    this.audioElements.clear();

    for (const screenAudioEl of this.screenAudioElements.values()) {
      try {
        screenAudioEl.pause();
      } catch {}
      screenAudioEl.srcObject = null;
      screenAudioEl.remove();
    }
    this.screenAudioElements.clear();
  }
}
