import {
  MessageType,
  QUALITY_PRESETS,
  QualityPresetType,
  WebRtcSignalPayload,
} from '@mini-voice/shared';
import { appEvents } from './EventBus';
import { networkClient } from './NetworkClient';
import { participantManager } from './ParticipantManager';
import { settingsStore } from '../stores/settingsStore';

export interface PeerSession {
  peerUserId: string;
  pc: RTCPeerConnection;
  remoteStream: MediaStream;
  isPolite: boolean;
  makingOffer: boolean;
  candidateQueue: RTCIceCandidateInit[];
  audioSender?: RTCRtpSender | null;
  videoSender?: RTCRtpSender | null;
}

/**
 * WebRtcManager implements a full-mesh topology: each participant maintains a
 * direct RTCPeerConnection to every other participant in the voice channel.
 * Traffic and encode/upload cost therefore grow as O(N²). This is intentional
 * and adequate for the project's scope (small groups of friends), bounded by
 * MAX_PARTICIPANTS_PER_CHANNEL_DEFAULT = 10. Scaling significantly beyond that
 * would require an SFU (Selective Forwarding Unit) instead of a mesh.
 */
export class WebRtcManager {
  private peers: Map<string, PeerSession> = new Map();
  private audioElements: Map<string, HTMLAudioElement> = new Map();
  private remoteAudioVads: Map<string, { ctx: AudioContext; interval: any }> = new Map();
  private localAudioTrack: MediaStreamTrack | null = null;
  private localCameraTrack: MediaStreamTrack | null = null;
  private localScreenTrack: MediaStreamTrack | null = null;
  private currentPreset: QualityPresetType = 'NORMAL';
  private currentUserId: string = '';

  private rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
    ],
    iceCandidatePoolSize: 4,
  };

  constructor() {
    this.setupSignalListeners();
  }

  public setCurrentUserId(userId: string): void {
    this.currentUserId = userId;
  }

  public setQualityPreset(preset: QualityPresetType): void {
    this.currentPreset = preset;
    this.applyBitrateConstraints();
  }

  private setupSignalListeners(): void {
    appEvents.on(`message.${MessageType.RTC_SIGNAL}`, async (payload: WebRtcSignalPayload) => {
      await this.handleIncomingSignal(payload);
    });

    appEvents.on('user_volume.changed', (data: { clientId: string; volume: number }) => {
      this.setPeerVolumeByClientId(data.clientId, data.volume);
    });

    appEvents.on('participants.updated', () => {
      this.applyUserVolumes();
    });
  }

  public async connectToPeer(peerUserId: string, isInitiator: boolean): Promise<void> {
    if (this.peers.has(peerUserId)) {
      return;
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    const remoteStream = new MediaStream();
    const isPolite = this.currentUserId.localeCompare(peerUserId) < 0;

    const session: PeerSession = {
      peerUserId,
      pc,
      remoteStream,
      isPolite,
      makingOffer: false,
      candidateQueue: [],
    };
    this.peers.set(peerUserId, session);

    // Setup Audio Transceiver
    if (this.localAudioTrack) {
      session.audioSender = pc.addTrack(this.localAudioTrack, new MediaStream([this.localAudioTrack]));
    } else {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
    }

    // Setup Video Transceiver (Camera or Screen)
    const activeVideoTrack = this.localScreenTrack || this.localCameraTrack;
    if (activeVideoTrack) {
      session.videoSender = pc.addTrack(activeVideoTrack, new MediaStream([activeVideoTrack]));
    } else {
      pc.addTransceiver('video', { direction: 'sendrecv' });
    }

    // ICE Candidate handler
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        networkClient.send(MessageType.RTC_SIGNAL, {
          targetUserId: peerUserId,
          fromUserId: this.currentUserId,
          signalType: 'candidate',
          candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
        });
      }
    };

    // Remote Track handler (Audio & Video)
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Received remote track (${event.track.kind}) from ${peerUserId}`);

      // If new video track, remove any old ended video tracks
      if (event.track.kind === 'video') {
        remoteStream.getVideoTracks().forEach((old) => {
          if (old.id !== event.track.id) {
            remoteStream.removeTrack(old);
          }
        });
      }

      remoteStream.addTrack(event.track);
      participantManager.setRemoteStream(peerUserId, remoteStream);

      if (event.track.kind === 'audio') {
        let audioEl = this.audioElements.get(peerUserId);
        const participant = participantManager.get(peerUserId);
        const clientId = participant?.user.clientId;
        const volume = clientId ? settingsStore.getUserVolume(clientId) : 100;
        if (!audioEl) {
          audioEl = document.createElement('audio');
          audioEl.autoplay = true;
          document.body.appendChild(audioEl);
          this.audioElements.set(peerUserId, audioEl);
        }
        audioEl.volume = volume / 100;
        audioEl.srcObject = remoteStream;
        // Route voice to the user-selected speaker (not the OS default) BEFORE
        // playing, otherwise Chromium may start playback on the default device
        // and never switch (#46).
        const el = audioEl;
        this.applySinkToElement(el).finally(() => {
          el.play().catch((e) => console.warn('[WebRTC] Audio play error:', e));
        });
        this.setupRemoteVad(peerUserId, remoteStream);
      }

      if (event.track.kind === 'video') {
        const videoEl = document.getElementById(`video-${peerUserId}`) as HTMLVideoElement;
        if (videoEl) {
          // Audio is routed exclusively through the dedicated <audio> element so
          // it can honour per-user volume, deafen and speaker selection. Keep
          // stage video elements muted to avoid a duplicate, un-deafenable
          // audio path when a peer shares camera/screen.
          videoEl.muted = true;
          videoEl.srcObject = remoteStream;
          videoEl.play().catch((e) => console.warn('[WebRTC] Video play error:', e));
        }
        const miniVideoEl = document.getElementById(`video-mini-${peerUserId}`) as HTMLVideoElement;
        if (miniVideoEl) {
          miniVideoEl.muted = true;
          miniVideoEl.srcObject = remoteStream;
          miniVideoEl.play().catch(() => {});
        }
      }

      event.track.onended = () => {
        remoteStream.removeTrack(event.track);
        participantManager.setRemoteStream(peerUserId, remoteStream);
      };

      event.track.onunmute = () => {
        participantManager.setRemoteStream(peerUserId, remoteStream);
        if (event.track.kind === 'audio') {
          const audioEl = this.audioElements.get(peerUserId);
          if (audioEl) {
            // Only (re)assign srcObject if it actually changed: reassigning the
            // same stream can reset the element's audio output sink back to the
            // OS default in Chromium, sending voice to the wrong device (#46).
            if (audioEl.srcObject !== remoteStream) {
              audioEl.srcObject = remoteStream;
            }
            // Force-reapply the selected speaker before playing, since a track
            // (re)unmute after rejoining can drop the previously set sink.
            this.applySinkToElement(audioEl, undefined, true).finally(() => {
              audioEl.play().catch(() => {});
            });
          }
        } else if (event.track.kind === 'video') {
          const videoEl = document.getElementById(`video-${peerUserId}`) as HTMLVideoElement;
          if (videoEl) {
            videoEl.muted = true;
            videoEl.srcObject = remoteStream;
            videoEl.play().catch(() => {});
          }
          const miniVideoEl = document.getElementById(`video-mini-${peerUserId}`) as HTMLVideoElement;
          if (miniVideoEl) {
            miniVideoEl.muted = true;
            miniVideoEl.srcObject = remoteStream;
            miniVideoEl.play().catch(() => {});
          }
        }
      };
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Peer ${peerUserId} state: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        this.applyBitrateConstraints();
        participantManager.setRemoteStream(peerUserId, remoteStream);
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        appEvents.emit('remote.peer_degraded', { userId: peerUserId });
      }
    };

    // Initial offer if initiator
    if (isInitiator) {
      await this.sendOffer(session);
    }
  }

  private async sendOffer(session: PeerSession): Promise<void> {
    try {
      session.makingOffer = true;
      const offer = await session.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await session.pc.setLocalDescription(offer);

      networkClient.send(MessageType.RTC_SIGNAL, {
        targetUserId: session.peerUserId,
        fromUserId: this.currentUserId,
        signalType: 'offer',
        sdp: session.pc.localDescription?.toJSON ? session.pc.localDescription.toJSON() : session.pc.localDescription,
      });
    } catch (err) {
      console.error(`[WebRTC] Error sending offer to ${session.peerUserId}:`, err);
    } finally {
      session.makingOffer = false;
    }
  }

  private async handleIncomingSignal(payload: WebRtcSignalPayload): Promise<void> {
    const { fromUserId, signalType, sdp, candidate } = payload;

    let session = this.peers.get(fromUserId);
    if (!session && signalType === 'offer') {
      await this.connectToPeer(fromUserId, false);
      session = this.peers.get(fromUserId);
    }

    if (!session) return;

    try {
      if (signalType === 'offer' && sdp) {
        const offerCollision =
          session.makingOffer || session.pc.signalingState !== 'stable';

        if (offerCollision) {
          if (!session.isPolite) {
            console.log(`[WebRTC] Impolite peer ignoring offer collision from ${fromUserId}`);
            return;
          }
          console.log(`[WebRTC] Polite peer rolling back for offer from ${fromUserId}`);
          await session.pc.setRemoteDescription({ type: 'rollback' } as any);
        }

        await session.pc.setRemoteDescription(new RTCSessionDescription(sdp));

        // Flush any queued candidates
        while (session.candidateQueue.length > 0) {
          const c = session.candidateQueue.shift();
          if (c) {
            await session.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
          }
        }

        // 1. Ensure local audio track is attached to audio transceiver
        if (this.localAudioTrack) {
          const transceivers = session.pc.getTransceivers();
          const audioTransceiver = transceivers.find(
            (t) => t.receiver.track.kind === 'audio' || t.sender.track?.kind === 'audio'
          );
          if (audioTransceiver) {
            await audioTransceiver.sender.replaceTrack(this.localAudioTrack);
          } else {
            const senders = session.pc.getSenders();
            let audioSender = senders.find((s) => s.track?.kind === 'audio');
            if (audioSender) {
              await audioSender.replaceTrack(this.localAudioTrack);
            } else {
              session.audioSender = session.pc.addTrack(this.localAudioTrack, new MediaStream([this.localAudioTrack]));
            }
          }
        }

        // 2. Ensure active local video track (camera or screen) is attached in the answer
        const activeVideoTrack = this.localScreenTrack || this.localCameraTrack;
        const transceivers = session.pc.getTransceivers();
        const videoTransceiver = transceivers.find(
          (t) => t.receiver.track.kind === 'video' || t.sender.track?.kind === 'video'
        );
        if (videoTransceiver) {
          videoTransceiver.direction = activeVideoTrack ? 'sendrecv' : 'recvonly';
          await videoTransceiver.sender.replaceTrack(activeVideoTrack);
        } else if (activeVideoTrack) {
          session.videoSender = session.pc.addTrack(activeVideoTrack, new MediaStream([activeVideoTrack]));
        }

        const answer = await session.pc.createAnswer();
        await session.pc.setLocalDescription(answer);

        networkClient.send(MessageType.RTC_SIGNAL, {
          targetUserId: fromUserId,
          fromUserId: this.currentUserId,
          signalType: 'answer',
          sdp: session.pc.localDescription?.toJSON ? session.pc.localDescription.toJSON() : session.pc.localDescription,
        });

        this.applyBitrateConstraints();
      } else if (signalType === 'answer' && sdp) {
        if (session.pc.signalingState === 'have-local-offer') {
          await session.pc.setRemoteDescription(new RTCSessionDescription(sdp));

          // Flush queued candidates
          while (session.candidateQueue.length > 0) {
            const c = session.candidateQueue.shift();
            if (c) {
              await session.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
            }
          }

          this.applyBitrateConstraints();
        }
      } else if (signalType === 'candidate' && candidate) {
        if (session.pc.remoteDescription && session.pc.remoteDescription.type) {
          try {
            await session.pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {}
        } else {
          // Buffer candidate until remoteDescription is set
          session.candidateQueue.push(candidate);
        }
      }
    } catch (err) {
      console.error(`[WebRTC] Signal handling error from ${fromUserId}:`, err);
    }
  }

  public async setLocalAudioTrack(track: MediaStreamTrack | null): Promise<void> {
    this.localAudioTrack = track;
    for (const session of this.peers.values()) {
      try {
        const transceivers = session.pc.getTransceivers();
        const audioTransceiver = transceivers.find(
          (t) => t.receiver.track.kind === 'audio' || t.sender.track?.kind === 'audio'
        );
        if (audioTransceiver) {
          await audioTransceiver.sender.replaceTrack(track);
        } else {
          const senders = session.pc.getSenders();
          let sender = senders.find((s) => s.track?.kind === 'audio');
          if (sender) {
            await sender.replaceTrack(track);
          } else if (track) {
            session.audioSender = session.pc.addTrack(track, new MediaStream([track]));
          }
        }

        if (session.pc.signalingState === 'stable') {
          await this.sendOffer(session);
        }
      } catch (err) {
        console.warn(`[WebRTC] Error updating audio track for peer ${session.peerUserId}:`, err);
      }
    }
  }

  public async setLocalCameraTrack(track: MediaStreamTrack | null): Promise<void> {
    this.localCameraTrack = track;
    const activeVideoTrack = this.localScreenTrack || this.localCameraTrack;
    await this.updateVideoTrackAcrossPeers(activeVideoTrack);
  }

  public async setLocalScreenTrack(track: MediaStreamTrack | null): Promise<void> {
    this.localScreenTrack = track;
    const activeVideoTrack = this.localScreenTrack || this.localCameraTrack;
    await this.updateVideoTrackAcrossPeers(activeVideoTrack);
  }

  private async updateVideoTrackAcrossPeers(track: MediaStreamTrack | null): Promise<void> {
    for (const session of this.peers.values()) {
      try {
        const transceivers = session.pc.getTransceivers();
        const videoTransceiver = transceivers.find(
          (t) => t.receiver.track.kind === 'video' || t.sender.track?.kind === 'video'
        );

        if (videoTransceiver) {
          videoTransceiver.direction = track ? 'sendrecv' : 'recvonly';
          await videoTransceiver.sender.replaceTrack(track);
        } else if (track) {
          session.videoSender = session.pc.addTrack(track, new MediaStream([track]));
        }

        // Renegotiate if signaling state is stable
        if (session.pc.signalingState === 'stable') {
          await this.sendOffer(session);
        }
      } catch (err) {
        console.warn(`[WebRTC] Error updating video track for peer ${session.peerUserId}:`, err);
      }
    }
  }

  public setDeafened(deafened: boolean): void {
    for (const audioEl of this.audioElements.values()) {
      audioEl.muted = deafened;
    }
  }

  public async setSpeakerDeviceId(deviceId: string): Promise<void> {
    for (const audioEl of this.audioElements.values()) {
      await this.applySinkToElement(audioEl, deviceId);
    }
  }

  /**
   * Applies the user-selected speaker to a voice audio element. Falls back to
   * the store's current selection when no explicit device is given (#46).
   */
  private async applySinkToElement(audioEl: HTMLAudioElement, deviceId?: string, force = false): Promise<void> {
    const sinkId = deviceId ?? settingsStore.selectedSpeakerId;
    if (!sinkId || typeof (audioEl as any).setSinkId !== 'function') return;
    if (!force && (audioEl as any).sinkId === sinkId) return;
    try {
      await (audioEl as any).setSinkId(sinkId);
    } catch (err) {
      console.warn('[WebRTC] Error setting sink ID for speaker device:', err);
    }
  }

  private async applyBitrateConstraints(): Promise<void> {
    const profile = QUALITY_PRESETS[this.currentPreset];
    for (const session of this.peers.values()) {
      for (const sender of session.pc.getSenders()) {
        if (!sender.track) continue;

        try {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }

          if (sender.track.kind === 'audio') {
            params.encodings[0].maxBitrate = profile.audioBitrateKbps * 1000;
          } else if (sender.track.kind === 'video') {
            const isScreen = sender.track === this.localScreenTrack;
            params.encodings[0].maxBitrate =
              (isScreen ? profile.screenBitrateKbps : profile.cameraBitrateKbps) * 1000;

            // Gaming favors fluid motion (drop resolution before framerate);
            // desktop/camera favors sharpness (drop framerate before resolution).
            (params as any).degradationPreference =
              isScreen && this.currentPreset === 'GAMING'
                ? 'maintain-framerate'
                : 'maintain-resolution';
          }

          await sender.setParameters(params);
        } catch (err) {}
      }
    }
  }

  public async getPeerPing(peerUserId: string): Promise<number | null> {
    const session = this.peers.get(peerUserId);
    if (!session || !session.pc) return null;
    try {
      const stats = await session.pc.getStats();
      for (const report of stats.values()) {
        if (
          report.type === 'candidate-pair' &&
          (report.state === 'succeeded' || report.nominated) &&
          report.currentRoundTripTime !== undefined
        ) {
          return Math.round(report.currentRoundTripTime * 1000);
        }
      }
    } catch (e) {}
    return null;
  }

  public async getAverageP2pPing(): Promise<number | null> {
    const pings: number[] = [];
    for (const peerId of this.peers.keys()) {
      const ping = await this.getPeerPing(peerId);
      if (ping !== null) pings.push(ping);
    }
    if (pings.length === 0) return null;
    return Math.round(pings.reduce((a, b) => a + b, 0) / pings.length);
  }

  private setupRemoteVad(peerUserId: string, stream: MediaStream): void {
    this.cleanupRemoteVad(peerUserId);
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      let isSpeaking = false;
      let silenceCounter = 0;

      const speechBins = Math.min(36, bufferLength);

      const interval = setInterval(() => {
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < speechBins; i++) {
          const val = dataArray[i];
          sum += val;
          if (val > peak) peak = val;
        }
        const average = sum / speechBins;

        const isVoiceActive = (average > 16 && peak > 40) || average > 24;

        if (isVoiceActive) {
          silenceCounter = 0;
          if (!isSpeaking) {
            isSpeaking = true;
            participantManager.setSpeaking(peerUserId, true);
          }
        } else {
          silenceCounter++;
          if (silenceCounter > 4 && isSpeaking) {
            isSpeaking = false;
            participantManager.setSpeaking(peerUserId, false);
          }
        }
      }, 50);

      this.remoteAudioVads.set(peerUserId, { ctx, interval });
    } catch (err) {
      console.warn(`[WebRTC] Could not setup remote VAD for ${peerUserId}:`, err);
    }
  }

  private cleanupRemoteVad(peerUserId: string): void {
    const vad = this.remoteAudioVads.get(peerUserId);
    if (vad) {
      clearInterval(vad.interval);
      try {
        vad.ctx.close();
      } catch (e) {}
      this.remoteAudioVads.delete(peerUserId);
    }
  }

  public setPeerVolume(peerUserId: string, volume0to100: number): void {
    const audioEl = this.audioElements.get(peerUserId);
    if (audioEl) {
      audioEl.volume = Math.max(0, Math.min(100, volume0to100)) / 100;
    }
  }

  public setPeerVolumeByClientId(clientId: string, volume0to100: number): void {
    const targetVolume = Math.max(0, Math.min(100, volume0to100)) / 100;
    for (const [peerUserId, audioEl] of this.audioElements.entries()) {
      const participant = participantManager.get(peerUserId);
      if (participant?.user.clientId === clientId) {
        audioEl.volume = targetVolume;
      }
    }
  }

  public applyUserVolumes(): void {
    for (const [peerUserId, audioEl] of this.audioElements.entries()) {
      const participant = participantManager.get(peerUserId);
      const clientId = participant?.user.clientId;
      if (clientId) {
        const vol = settingsStore.getUserVolume(clientId);
        audioEl.volume = vol / 100;
      }
    }
  }

  public removePeer(peerUserId: string): void {
    this.cleanupRemoteVad(peerUserId);
    const audioEl = this.audioElements.get(peerUserId);
    if (audioEl) {
      audioEl.srcObject = null;
      audioEl.remove();
      this.audioElements.delete(peerUserId);
    }

    const session = this.peers.get(peerUserId);
    if (session) {
      session.pc.close();
      this.peers.delete(peerUserId);
    }
  }

  public closeAllPeers(): void {
    for (const [peerUserId] of this.peers) {
      this.removePeer(peerUserId);
    }
    this.peers.clear();
    for (const peerUserId of this.remoteAudioVads.keys()) {
      this.cleanupRemoteVad(peerUserId);
    }
  }
}

export const webRtcManager = new WebRtcManager();
