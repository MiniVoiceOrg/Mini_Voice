import {
  MessageType,
  QUALITY_PRESETS,
  QualityPresetType,
  WebRtcSignalPayload,
} from '@monky/shared';
import { appEvents } from './EventBus';
import { networkClient } from './NetworkClient';
import { participantManager } from './ParticipantManager';
import { settingsStore } from '../stores/settingsStore';
import { serverStore } from '../stores/serverStore';
import { voiceStore } from '../stores/voiceStore';

export interface PeerSession {
  peerSessionId: string;
  pc: RTCPeerConnection;
  remoteStream: MediaStream;
  /** Remote screen streams keyed by share id (#253: up to MAX_SCREEN_SHARES). */
  remoteScreenStreams: Map<string, MediaStream>;
  isPolite: boolean;
  makingOffer: boolean;
  candidateQueue: RTCIceCandidateInit[];
  audioSender?: RTCRtpSender | null;
  videoSender?: RTCRtpSender | null;
  /** Dedicated screen video senders keyed by share id (#253). */
  screenVideoSenders: Map<string, RTCRtpSender>;
  screenAudioSender?: RTCRtpSender | null;
  // Auto-recovery and retry management
  iceRestartAttempts: number;
  reconnectAttempts: number;
  watchdogTimer?: any;
  disconnectGraceTimer?: any;
  isRecovering: boolean;
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
  private screenAudioElements: Map<string, HTMLAudioElement> = new Map();
  private screenAudioStreamIds: Set<string> = new Set();
  private screenVideoStreamIds: Set<string> = new Set();
  // Tracks received before screen-audio-meta arrived, keyed by streamId
  private pendingScreenAudioTracks: Map<string, { track: MediaStreamTrack; peerSessionId: string }> = new Map();
  // Screen video tracks received before screen-video-meta arrived, keyed by streamId
  private pendingScreenVideoTracks: Map<string, { track: MediaStreamTrack; peerSessionId: string }> = new Map();
  private remoteAudioVads: Map<string, { interval: any }> = new Map();
  private localAudioTrack: MediaStreamTrack | null = null;
  private localCameraTrack: MediaStreamTrack | null = null;
  /** Local screen video tracks keyed by share id (#253). */
  private localScreenTracks: Map<string, MediaStreamTrack> = new Map();
  /** The MediaStream wrapper announced to peers for each local share (#253). */
  private localScreenStreams: Map<string, MediaStream> = new Map();
  private localScreenAudioTrack: MediaStreamTrack | null = null;
  private screenAudioStream: MediaStream | null = null;
  private screenAudioStreamId: string | null = null;
  private currentPreset: QualityPresetType = 'NORMAL';
  private currentSessionId: string = '';
  private isDeafened: boolean = false;

  private rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
    iceCandidatePoolSize: 4,
  };

  constructor() {
    this.setupSignalListeners();
  }

  /** Our own session id: the tie-breaker for who initiates each peer link (#309). */
  public setCurrentSessionId(sessionId: string): void {
    this.currentSessionId = sessionId;
  }

  public setQualityPreset(preset: QualityPresetType): void {
    this.currentPreset = preset;
    this.applyBitrateConstraints();
  }

  private setupSignalListeners(): void {
    appEvents.on(`message.${MessageType.RTC_SIGNAL}`, async (payload: WebRtcSignalPayload) => {
      await this.handleIncomingSignal(payload);
    });

    appEvents.on('user_volume.changed', (data: { sessionId: string; volume: number }) => {
      this.setPeerVolume(data.sessionId, data.volume);
    });

    appEvents.on('screen_audio_volume.changed', (data: { sessionId: string; volume: number }) => {
      const screenAudioEl = this.screenAudioElements.get(data.sessionId);
      if (screenAudioEl) {
        screenAudioEl.volume = Math.max(0, Math.min(100, data.volume)) / 100;
      }
    });

    appEvents.on('participants.updated', () => {
      this.applyUserVolumes();
    });
  }

  /**
   * Route a screen audio track to a dedicated <audio> element for a peer.
   */
  private routeScreenAudioTrack(peerSessionId: string, track: MediaStreamTrack): void {
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
    const participant = participantManager.get(peerSessionId);
    const volume = settingsStore.getScreenAudioVolume(peerSessionId, participant?.user.clientId);
    screenAudioEl.volume = Math.max(0, Math.min(100, volume)) / 100;
    this.applySinkToElement(screenAudioEl).finally(() => {
      screenAudioEl!.play().catch((e) => console.warn('[WebRTC] Screen audio play error:', e));
    });
    track.onended = () => {
      if (screenAudioEl) {
        screenAudioEl.srcObject = null;
      }
    };
  }

  /**
   * Route a screen video track into a per-share MediaStream so the stage can
   * render it as a separate tile from the camera (#26) and from the peer's
   * other screen share (#253).
   */
  private routeScreenVideoTrack(peerSessionId: string, track: MediaStreamTrack, shareId: string): void {
    const session = this.peers.get(peerSessionId);
    if (!session) return;

    // If it was provisionally added to the camera stream (meta arrived late),
    // move it out so it doesn't render as the camera.
    if (session.remoteStream.getTrackById(track.id)) {
      session.remoteStream.removeTrack(track);
      participantManager.setRemoteStream(peerSessionId, session.remoteStream);
    }

    let screenStream = session.remoteScreenStreams.get(shareId);
    if (!screenStream) {
      screenStream = new MediaStream();
      session.remoteScreenStreams.set(shareId, screenStream);
    }

    // Replace any previous screen video track for this share with this one.
    screenStream.getVideoTracks().forEach((old) => {
      if (old.id !== track.id) screenStream!.removeTrack(old);
    });
    if (!screenStream.getTrackById(track.id)) {
      screenStream.addTrack(track);
    }
    participantManager.setRemoteScreenStream(peerSessionId, shareId, screenStream);

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
      screenStream!.removeTrack(track);
      session.remoteScreenStreams.delete(shareId);
      // `screenVideoStreamIds` is the only durable record that this id is a
      // screen and not a camera. A reconnect ends the track without the sender
      // re-announcing the metadata, so dropping it here would make the share
      // come back misclassified as the camera (#26).
      participantManager.removeRemoteScreenStream(peerSessionId, shareId);
    };
  }

  /**
   * True when the sender carries one of this peer's screen shares, so the
   * camera-transceiver lookups never pick a screen m-line by mistake (#253).
   */
  private isScreenVideoSender(session: PeerSession, sender: RTCRtpSender): boolean {
    for (const screenSender of session.screenVideoSenders.values()) {
      if (screenSender === sender) return true;
    }
    return false;
  }

  /** True when the track is one of the local screen shares (#253). */
  private isLocalScreenTrack(track: MediaStreamTrack): boolean {
    for (const screenTrack of this.localScreenTracks.values()) {
      if (screenTrack === track) return true;
    }
    return false;
  }

  /**
   * Wait for a peer connection's signaling state to become 'stable'.
   * Returns immediately if already stable, otherwise waits up to timeoutMs.
   */
  private waitForStable(pc: RTCPeerConnection, timeoutMs = 5000): Promise<void> {
    if (pc.signalingState === 'stable') return Promise.resolve();
    return new Promise<void>((resolve) => {
      const onStateChange = () => {
        if (pc.signalingState === 'stable') {
          pc.removeEventListener('signalingstatechange', onStateChange);
          clearTimeout(timer);
          resolve();
        }
      };
      const timer = setTimeout(() => {
        pc.removeEventListener('signalingstatechange', onStateChange);
        resolve(); // resolve anyway to avoid blocking forever
      }, timeoutMs);
      pc.addEventListener('signalingstatechange', onStateChange);
    });
  }

  /**
   * True if any local sender track sits on a transceiver that has never been
   * negotiated (mid === null). This happens when an offer that would have
   * negotiated the track was discarded by an offer-collision rollback — leaving
   * e.g. the screen-audio track added locally but never sent over the wire.
   */
  private hasUnnegotiatedSenders(pc: RTCPeerConnection): boolean {
    return pc.getTransceivers().some((t) => !!t.sender.track && t.mid === null);
  }

  /**
   * Re-send an offer when the connection is stable but still has a local track
   * that was never negotiated (see hasUnnegotiatedSenders). This recovers the
   * screen-audio track after a glare/rollback during screen sharing, where the
   * video and audio renegotiations collide and the audio offer is dropped.
   */
  private async renegotiateIfNeeded(session: PeerSession): Promise<void> {
    const pc = session.pc;
    if (pc.signalingState === 'stable' && !session.makingOffer && this.hasUnnegotiatedSenders(pc)) {
      console.log(`[WebRTC] Re-negotiating dropped track(s) for ${session.peerSessionId}`);
      await this.sendOffer(session);
    }
  }

  private clearPeerTimers(session: PeerSession): void {
    if (session.watchdogTimer) {
      clearTimeout(session.watchdogTimer);
      session.watchdogTimer = undefined;
    }
    if (session.disconnectGraceTimer) {
      clearTimeout(session.disconnectGraceTimer);
      session.disconnectGraceTimer = undefined;
    }
  }

  private startConnectionWatchdog(session: PeerSession, timeoutMs = 12000): void {
    if (session.watchdogTimer) {
      clearTimeout(session.watchdogTimer);
    }
    session.watchdogTimer = setTimeout(() => {
      session.watchdogTimer = undefined;
      const state = session.pc.connectionState;
      const iceState = session.pc.iceConnectionState;
      if (state !== 'connected' && state !== 'closed') {
        console.warn(
          `[WebRTC] Watchdog timeout (${timeoutMs}ms) for peer ${session.peerSessionId} (state=${state}, iceState=${iceState}). Triggering recovery.`
        );
        this.recoverPeerConnection(session, 'watchdog_timeout');
      }
    }, timeoutMs);
  }

  private async triggerIceRestart(session: PeerSession, reason: string): Promise<void> {
    if (session.isRecovering || session.pc.connectionState === 'closed') {
      return;
    }

    session.isRecovering = true;
    session.iceRestartAttempts++;
    console.log(
      `[WebRTC] Attempting ICE restart #${session.iceRestartAttempts} for peer ${session.peerSessionId} (reason: ${reason})`
    );

    try {
      await this.waitForStable(session.pc, 3000);
      if (typeof session.pc.restartIce === 'function') {
        session.pc.restartIce();
      }
      await this.sendOffer(session, true);
      this.startConnectionWatchdog(session, 10000);
    } catch (err) {
      console.warn(`[WebRTC] ICE restart failed for ${session.peerSessionId}:`, err);
      await this.hardReconnectPeer(session.peerSessionId);
    } finally {
      session.isRecovering = false;
    }
  }

  private async hardReconnectPeer(peerSessionId: string): Promise<void> {
    const existing = this.peers.get(peerSessionId);
    const attempts = (existing?.reconnectAttempts || 0) + 1;

    if (attempts > 3) {
      console.warn(`[WebRTC] Max hard reconnect attempts reached for peer ${peerSessionId}. Aborting recovery.`);
      appEvents.emit('remote.peer_degraded', { sessionId: peerSessionId });
      return;
    }

    console.log(`[WebRTC] Performing Hard Reconnect #${attempts} for peer ${peerSessionId}...`);

    if (existing) {
      this.clearPeerTimers(existing);
      try {
        existing.pc.close();
      } catch (e) {}
      this.peers.delete(peerSessionId);
    }

    // Exponential backoff delay (1s, 2s, 4s)
    const backoffMs = Math.min(4000, 1000 * Math.pow(2, attempts - 1));
    await new Promise((resolve) => setTimeout(resolve, backoffMs));

    if (!voiceStore.currentVoiceChannelId) return;
    const isPeerStillInVoice =
      participantManager.get(peerSessionId)?.voiceState?.channelId === voiceStore.currentVoiceChannelId;
    if (!isPeerStillInVoice) return;

    const isInitiator = this.currentSessionId.localeCompare(peerSessionId) < 0;
    await this.connectToPeer(peerSessionId, isInitiator);

    const newSession = this.peers.get(peerSessionId);
    if (newSession) {
      newSession.reconnectAttempts = attempts;
    }
  }

  private recoverPeerConnection(session: PeerSession, reason: string): void {
    if (session.iceRestartAttempts < 2) {
      this.triggerIceRestart(session, reason);
    } else {
      this.hardReconnectPeer(session.peerSessionId);
    }
  }

  /**
   * Another device of our own in the same call. We still link up with it so
   * camera and screen share work, but its audio is dropped: playing it would
   * feed the speakers of one device into the microphone of the other (#309).
   */
  private isOwnOtherDevice(peerSessionId: string): boolean {
    const myUserId = serverStore.currentUser?.id;
    if (!myUserId || peerSessionId === this.currentSessionId) return false;
    return participantManager.get(peerSessionId)?.user.id === myUserId;
  }

  public async connectToPeer(peerSessionId: string, isInitiator: boolean): Promise<void> {
    const existingSession = this.peers.get(peerSessionId);
    if (existingSession) {
      if (existingSession.pc.connectionState !== 'closed' && existingSession.pc.connectionState !== 'failed') {
        return;
      }
      this.clearPeerTimers(existingSession);
      try {
        existingSession.pc.close();
      } catch (e) {}
      this.peers.delete(peerSessionId);
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    const remoteStream = new MediaStream();
    const isPolite = this.currentSessionId.localeCompare(peerSessionId) < 0;

    const session: PeerSession = {
      peerSessionId,
      pc,
      remoteStream,
      remoteScreenStreams: new Map(),
      isPolite,
      makingOffer: false,
      candidateQueue: [],
      screenVideoSenders: new Map(),
      iceRestartAttempts: 0,
      reconnectAttempts: 0,
      isRecovering: false,
    };
    this.peers.set(peerSessionId, session);

    // Setup Audio Transceiver
    if (this.localAudioTrack) {
      session.audioSender = pc.addTrack(this.localAudioTrack, new MediaStream([this.localAudioTrack]));
    } else {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
    }

    // Setup Video Transceiver (Camera on the primary video m-line). Screen
    // share now rides its own second sender (see below) so camera + screen can
    // be sent simultaneously as two independent tiles (#26).
    if (this.localCameraTrack) {
      session.videoSender = pc.addTrack(this.localCameraTrack, new MediaStream([this.localCameraTrack]));
    } else {
      pc.addTransceiver('video', { direction: 'sendrecv' });
    }

    // Setup Screen Video Tracks as dedicated extra senders (if currently
    // sharing). Announce each stream ID first so the receiver can tell them
    // apart from the camera track and from each other (mirrors the
    // screen-audio-meta mechanism) — #26, #253.
    for (const [shareId, screenTrack] of this.localScreenTracks) {
      const stream = this.localScreenStreams.get(shareId);
      if (!stream) continue;
      networkClient.send(MessageType.RTC_SIGNAL, {
        targetSessionId: peerSessionId,
        fromSessionId: this.currentSessionId,
        signalType: 'screen-video-meta',
        streamId: shareId,
      });
      session.screenVideoSenders.set(shareId, pc.addTrack(screenTrack, stream));
    }

    // Setup Screen Audio Track (if currently sharing)
    if (this.localScreenAudioTrack && this.screenAudioStream) {
      // Announce stream ID before adding track
      networkClient.send(MessageType.RTC_SIGNAL, {
        targetSessionId: peerSessionId,
        fromSessionId: this.currentSessionId,
        signalType: 'screen-audio-meta',
        streamId: this.screenAudioStreamId,
      });
      session.screenAudioSender = pc.addTrack(this.localScreenAudioTrack, this.screenAudioStream);
    }

    // ICE Candidate handler
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        networkClient.send(MessageType.RTC_SIGNAL, {
          targetSessionId: peerSessionId,
          fromSessionId: this.currentSessionId,
          signalType: 'candidate',
          candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
        });
      }
    };

    // Remote Track handler (Audio & Video)
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Received remote track (${event.track.kind}) from ${peerSessionId}`);

      // Our own other device: keep the video, drop every audio track before it
      // can reach a speaker and loop back through the other mic (#309).
      if (event.track.kind === 'audio' && this.isOwnOtherDevice(peerSessionId)) {
        console.log(`[WebRTC] Dropping audio from our own other device (${peerSessionId})`);
        return;
      }

      // Check if this is a screen audio track — either by known stream ID
      // or by detecting it as a 2nd audio track (the first is the mic).
      const incomingStreamId = event.streams?.[0]?.id;
      const isKnownScreenAudio = event.track.kind === 'audio' && incomingStreamId && this.screenAudioStreamIds.has(incomingStreamId);
      const existingMicAudio = remoteStream.getAudioTracks().length > 0;
      const isExtraAudioTrack = event.track.kind === 'audio' && existingMicAudio && incomingStreamId && !remoteStream.getTrackById(event.track.id);

      if (isKnownScreenAudio || isExtraAudioTrack) {
        console.log(`[WebRTC] Routing screen audio track from ${peerSessionId} (known=${isKnownScreenAudio}, extra=${isExtraAudioTrack}, streamId=${incomingStreamId})`);
        // If meta hasn't arrived yet, store for potential reclassification
        if (!isKnownScreenAudio && incomingStreamId) {
          this.pendingScreenAudioTracks.set(incomingStreamId, { track: event.track, peerSessionId });
        }
        this.routeScreenAudioTrack(peerSessionId, event.track);
        return;
      }

      // Check if this is a screen VIDEO track — either by known stream ID or by
      // detecting it as a 2nd video track (the first is the camera). Screen
      // video is announced via screen-video-meta before the track arrives, so
      // isKnownScreenVideo is reliable even when the peer has no camera (#26).
      const isKnownScreenVideo =
        event.track.kind === 'video' && !!incomingStreamId && this.screenVideoStreamIds.has(incomingStreamId);
      const existingCameraVideo = remoteStream.getVideoTracks().length > 0;
      const isExtraVideoTrack =
        event.track.kind === 'video' && existingCameraVideo && !!incomingStreamId && !remoteStream.getTrackById(event.track.id);

      if (isKnownScreenVideo || isExtraVideoTrack) {
        console.log(`[WebRTC] Routing screen video track from ${peerSessionId} (known=${isKnownScreenVideo}, extra=${isExtraVideoTrack}, streamId=${incomingStreamId})`);
        if (!isKnownScreenVideo && incomingStreamId) {
          this.pendingScreenVideoTracks.set(incomingStreamId, { track: event.track, peerSessionId });
        }
        this.routeScreenVideoTrack(peerSessionId, event.track, incomingStreamId!);
        return;
      }

      // If new video track, remove any old ended video tracks
      if (event.track.kind === 'video') {
        remoteStream.getVideoTracks().forEach((old) => {
          if (old.id !== event.track.id) {
            remoteStream.removeTrack(old);
          }
        });
      }

      remoteStream.addTrack(event.track);
      participantManager.setRemoteStream(peerSessionId, remoteStream);

      if (event.track.kind === 'audio') {
        let audioEl = this.audioElements.get(peerSessionId);
        const participant = participantManager.get(peerSessionId);
        const volume = settingsStore.getUserVolume(peerSessionId, participant?.user.clientId);
        const isDeaf = this.isDeafened || voiceStore.getEffectiveDeafened();
        if (!audioEl) {
          audioEl = document.createElement('audio');
          audioEl.autoplay = true;
          audioEl.muted = isDeaf;
          document.body.appendChild(audioEl);
          this.audioElements.set(peerSessionId, audioEl);
        }
        audioEl.muted = isDeaf;
        audioEl.volume = Math.max(0, Math.min(100, volume)) / 100;
        audioEl.srcObject = remoteStream;

        // Route voice to the user-selected speaker (not the OS default) BEFORE
        // playing, otherwise Chromium may start playback on the default device
        // and never switch (#46).
        const el = audioEl;
        this.applySinkToElement(el).finally(() => {
          el.play().catch((e) => console.warn('[WebRTC] Audio play error:', e));
        });
        this.setupRemoteVad(peerSessionId);
      }

      if (event.track.kind === 'video') {
        const videoEl = document.getElementById(`video-${peerSessionId}-camera`) as HTMLVideoElement;
        if (videoEl) {
          // Audio is routed exclusively through the dedicated <audio> element so
          // it can honour per-user volume, deafen and speaker selection. Keep
          // stage video elements muted to avoid a duplicate, un-deafenable
          // audio path when a peer shares camera/screen.
          videoEl.muted = true;
          videoEl.srcObject = remoteStream;
          videoEl.play().catch((e) => console.warn('[WebRTC] Video play error:', e));
        }
        const miniVideoEl = document.getElementById(`video-mini-${peerSessionId}-camera`) as HTMLVideoElement;
        if (miniVideoEl) {
          miniVideoEl.muted = true;
          miniVideoEl.srcObject = remoteStream;
          miniVideoEl.play().catch(() => {});
        }
      }

      event.track.onended = () => {
        remoteStream.removeTrack(event.track);
        participantManager.setRemoteStream(peerSessionId, remoteStream);
      };

      event.track.onunmute = () => {
        participantManager.setRemoteStream(peerSessionId, remoteStream);
        if (event.track.kind === 'audio') {
          const audioEl = this.audioElements.get(peerSessionId);
          if (audioEl) {
            audioEl.muted = this.isDeafened || voiceStore.getEffectiveDeafened();
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
          const videoEl = document.getElementById(`video-${peerSessionId}-camera`) as HTMLVideoElement;
          if (videoEl) {
            videoEl.muted = true;
            videoEl.srcObject = remoteStream;
            videoEl.play().catch(() => {});
          }
          const miniVideoEl = document.getElementById(`video-mini-${peerSessionId}-camera`) as HTMLVideoElement;
          if (miniVideoEl) {
            miniVideoEl.muted = true;
            miniVideoEl.srcObject = remoteStream;
            miniVideoEl.play().catch(() => {});
          }
        }
      };
    };

    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      console.log(`[WebRTC] Peer ${peerSessionId} ICE state: ${iceState}`);

      if (iceState === 'connected' || iceState === 'completed') {
        this.clearPeerTimers(session);
        session.iceRestartAttempts = 0;
        session.reconnectAttempts = 0;
      } else if (iceState === 'disconnected') {
        if (!session.disconnectGraceTimer) {
          session.disconnectGraceTimer = setTimeout(() => {
            session.disconnectGraceTimer = undefined;
            if (pc.iceConnectionState === 'disconnected') {
              console.warn(`[WebRTC] Peer ${peerSessionId} ICE remained disconnected for 4s. Recovering.`);
              this.recoverPeerConnection(session, 'ice_disconnected');
            }
          }, 4000);
        }
      } else if (iceState === 'failed') {
        this.clearPeerTimers(session);
        console.warn(`[WebRTC] Peer ${peerSessionId} ICE state failed. Recovering immediately.`);
        this.recoverPeerConnection(session, 'ice_failed');
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log(`[WebRTC] Peer ${peerSessionId} state: ${state}`);

      if (state === 'connected') {
        this.clearPeerTimers(session);
        session.iceRestartAttempts = 0;
        session.reconnectAttempts = 0;
        this.applyBitrateConstraints();
        participantManager.setRemoteStream(peerSessionId, remoteStream);
      } else if (state === 'failed') {
        this.clearPeerTimers(session);
        appEvents.emit('remote.peer_degraded', { sessionId: peerSessionId });
        this.recoverPeerConnection(session, 'connection_failed');
      } else if (state === 'disconnected') {
        appEvents.emit('remote.peer_degraded', { sessionId: peerSessionId });
        if (!session.disconnectGraceTimer) {
          session.disconnectGraceTimer = setTimeout(() => {
            session.disconnectGraceTimer = undefined;
            if (pc.connectionState === 'disconnected') {
              console.warn(`[WebRTC] Peer ${peerSessionId} connection remained disconnected for 4s. Recovering.`);
              this.recoverPeerConnection(session, 'connection_disconnected');
            }
          }, 4000);
        }
      }
    };

    // Watchdog to ensure connection establishes within a reasonable time
    this.startConnectionWatchdog(session);

    // Initial offer if initiator
    if (isInitiator) {
      await this.sendOffer(session);
    }
  }

  private async sendOffer(session: PeerSession, iceRestart = false): Promise<void> {
    try {
      session.makingOffer = true;
      const offer = await session.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        iceRestart,
      });
      await session.pc.setLocalDescription(offer);

      networkClient.send(MessageType.RTC_SIGNAL, {
        targetSessionId: session.peerSessionId,
        fromSessionId: this.currentSessionId,
        signalType: 'offer',
        sdp: session.pc.localDescription?.toJSON ? session.pc.localDescription.toJSON() : session.pc.localDescription,
      });
    } catch (err) {
      console.error(`[WebRTC] Error sending offer to ${session.peerSessionId}:`, err);
    } finally {
      session.makingOffer = false;
    }
  }

  private async handleIncomingSignal(payload: WebRtcSignalPayload): Promise<void> {
    const { fromSessionId, signalType, sdp, candidate, streamId } = payload;

    // Handle screen-audio-meta: register the stream ID so ontrack can route it
    if (signalType === 'screen-audio-meta') {
      if (streamId) {
        this.screenAudioStreamIds.add(streamId);
        // If ontrack already fired before this meta arrived, reclassify the pending track
        const pending = this.pendingScreenAudioTracks.get(streamId);
        if (pending) {
          console.log(`[WebRTC] Reclassifying pending track as screen audio for ${pending.peerSessionId}`);
          this.pendingScreenAudioTracks.delete(streamId);
          // Already routed by ontrack — no further action needed
        }
      }
      return;
    }

    // Handle screen-video-meta: register the stream ID so ontrack can route it
    // to the dedicated screen tile instead of the camera tile (#26).
    if (signalType === 'screen-video-meta') {
      if (streamId) {
        this.screenVideoStreamIds.add(streamId);
        const pending = this.pendingScreenVideoTracks.get(streamId);
        if (pending) {
          console.log(`[WebRTC] Reclassifying pending track as screen video for ${pending.peerSessionId}`);
          this.pendingScreenVideoTracks.delete(streamId);
          this.routeScreenVideoTrack(pending.peerSessionId, pending.track, streamId);
        }
      }
      return;
    }

    let session = this.peers.get(fromSessionId);
    if (!session && signalType === 'offer') {
      await this.connectToPeer(fromSessionId, false);
      session = this.peers.get(fromSessionId);
    }

    if (!session) return;

    try {
      if (signalType === 'offer' && sdp) {
        const offerCollision =
          session.makingOffer || session.pc.signalingState !== 'stable';

        if (offerCollision) {
          if (!session.isPolite) {
            console.log(`[WebRTC] Impolite peer ignoring offer collision from ${fromSessionId}`);
            return;
          }
          console.log(`[WebRTC] Polite peer rolling back for offer from ${fromSessionId}`);
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

        // 2. Ensure the primary (camera) local video track is attached in the
        //    answer. The camera m-line is always created first, so the first
        //    video transceiver that isn't the screen sender is the camera one.
        //    Screen shares ride their own extra senders and are negotiated
        //    separately (via screen-video-meta + renegotiateIfNeeded).
        const cameraTrack = this.localCameraTrack;
        const transceivers = session.pc.getTransceivers();
        const videoTransceiver = transceivers.find(
          (t) =>
            (t.receiver.track.kind === 'video' || t.sender.track?.kind === 'video') &&
            !this.isScreenVideoSender(session, t.sender)
        );
        if (videoTransceiver) {
          videoTransceiver.direction = cameraTrack ? 'sendrecv' : 'recvonly';
          await videoTransceiver.sender.replaceTrack(cameraTrack);
          session.videoSender = videoTransceiver.sender;
        } else if (cameraTrack) {
          session.videoSender = session.pc.addTrack(cameraTrack, new MediaStream([cameraTrack]));
        }

        const answer = await session.pc.createAnswer();
        await session.pc.setLocalDescription(answer);

        networkClient.send(MessageType.RTC_SIGNAL, {
          targetSessionId: fromSessionId,
          fromSessionId: this.currentSessionId,
          signalType: 'answer',
          sdp: session.pc.localDescription?.toJSON ? session.pc.localDescription.toJSON() : session.pc.localDescription,
        });

        this.applyBitrateConstraints();
        // After answering a remote offer the connection is stable again; if a
        // local track (e.g. screen audio) was left un-negotiated by a prior
        // offer collision, re-offer it now.
        await this.renegotiateIfNeeded(session);
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
          // Connection is stable after applying the answer; re-offer any track
          // that is still un-negotiated (recovers dropped screen-audio track).
          await this.renegotiateIfNeeded(session);
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
      console.error(`[WebRTC] Signal handling error from ${fromSessionId}:`, err);
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
        console.warn(`[WebRTC] Error updating audio track for peer ${session.peerSessionId}:`, err);
      }
    }
  }

  public async setLocalCameraTrack(track: MediaStreamTrack | null): Promise<void> {
    this.localCameraTrack = track;
    // Camera rides the primary video sender only; screen share has its own
    // dedicated sender so both can be sent at once (#26).
    await this.updateVideoTrackAcrossPeers(track);
  }

  /**
   * Add a local screen video track as a dedicated extra sender on every peer
   * (mirrors setLocalScreenAudioTrack). Announces the stream ID via
   * screen-video-meta before adding the track so receivers render it as its own
   * tile, separate from the camera (#26) and from the other share (#253).
   */
  public async addLocalScreenTrack(stream: MediaStream): Promise<void> {
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    // The share id IS the MediaStream id, which is also what gets announced
    // over the wire, so both ends key the share by the same value.
    const shareId = stream.id;
    this.localScreenTracks.set(shareId, track);
    this.localScreenStreams.set(shareId, stream);

    // Announce stream ID to all peers BEFORE adding the track.
    for (const session of this.peers.values()) {
      networkClient.send(MessageType.RTC_SIGNAL, {
        targetSessionId: session.peerSessionId,
        fromSessionId: this.currentSessionId,
        signalType: 'screen-video-meta',
        streamId: shareId,
      });
    }

    // Add track to all peers — wait for stable signaling state before
    // renegotiating, since a camera change may have just triggered an offer.
    for (const session of this.peers.values()) {
      try {
        await this.waitForStable(session.pc);
        const existing = session.screenVideoSenders.get(shareId);
        if (existing) {
          await existing.replaceTrack(track);
        } else {
          session.screenVideoSenders.set(shareId, session.pc.addTrack(track, stream));
        }
        await this.sendOffer(session);
        // Wait for the answer, then verify the track was actually negotiated.
        await this.waitForStable(session.pc);
        await this.renegotiateIfNeeded(session);
      } catch (err) {
        console.warn(`[WebRTC] Error adding screen video track for ${session.peerSessionId}:`, err);
      }
    }
    this.applyBitrateConstraints();
  }

  /**
   * Remove one local screen share from every peer (#253).
   */
  public async removeLocalScreenTrack(shareId: string): Promise<void> {
    this.localScreenTracks.delete(shareId);
    this.localScreenStreams.delete(shareId);

    for (const session of this.peers.values()) {
      const sender = session.screenVideoSenders.get(shareId);
      if (!sender) continue;
      try {
        await this.waitForStable(session.pc);
        session.pc.removeTrack(sender);
        session.screenVideoSenders.delete(shareId);
        await this.sendOffer(session);
      } catch (err) {
        console.warn(`[WebRTC] Error removing screen video track for ${session.peerSessionId}:`, err);
      }
    }
  }

  /**
   * Tear down every local screen share (leaving the channel, camera swap, …).
   */
  public async removeAllLocalScreenTracks(): Promise<void> {
    for (const shareId of [...this.localScreenTracks.keys()]) {
      await this.removeLocalScreenTrack(shareId);
    }
  }

  /**
   * Drops the local screen bookkeeping without renegotiating, for paths where
   * the call itself is over and the peer connections are being torn down
   * (leaving voice, kicked, socket dropped). Without this the stale tracks
   * would be re-announced and re-added to every peer on the next join (#253).
   * Note this must NOT run on reconnect, where the share is meant to survive.
   */
  public clearLocalScreenTracks(): void {
    this.localScreenTracks.clear();
    this.localScreenStreams.clear();
  }

  /**
   * Set the local screen audio track (from native capture) and add it to all peers.
   * Announces the stream ID via screen-audio-meta signaling before adding the track.
   */
  public async setLocalScreenAudioTrack(track: MediaStreamTrack | null): Promise<void> {
    this.localScreenAudioTrack = track;

    if (track) {
      // Wrap in a dedicated MediaStream so receivers can identify it.
      // Store the stream so late-joining peers reuse the same ID.
      const stream = new MediaStream([track]);
      this.screenAudioStream = stream;
      this.screenAudioStreamId = stream.id;

      // Announce stream ID to all peers BEFORE adding the track
      for (const session of this.peers.values()) {
        networkClient.send(MessageType.RTC_SIGNAL, {
          targetSessionId: session.peerSessionId,
          fromSessionId: this.currentSessionId,
          signalType: 'screen-audio-meta',
          streamId: this.screenAudioStreamId,
        });
      }

      // Add track to all peers — wait for stable signaling state before
      // renegotiating, since screen video may have just triggered an offer.
      for (const session of this.peers.values()) {
        try {
          await this.waitForStable(session.pc);
          session.screenAudioSender = session.pc.addTrack(track, stream);
          await this.sendOffer(session);
          // Wait for the answer, then verify the track was actually negotiated.
          // If a glare/rollback dropped the offer, re-send it now.
          await this.waitForStable(session.pc);
          await this.renegotiateIfNeeded(session);
        } catch (err) {
          console.warn(`[WebRTC] Error adding screen audio track for ${session.peerSessionId}:`, err);
        }
      }
    } else {
      // Remove screen audio track from all peers
      for (const session of this.peers.values()) {
        if (session.screenAudioSender) {
          try {
            await this.waitForStable(session.pc);
            session.pc.removeTrack(session.screenAudioSender);
            session.screenAudioSender = null;
            await this.sendOffer(session);
          } catch (err) {
            console.warn(`[WebRTC] Error removing screen audio track for ${session.peerSessionId}:`, err);
          }
        }
      }
      this.screenAudioStream = null;
      this.screenAudioStreamId = null;
    }
  }

  private async updateVideoTrackAcrossPeers(track: MediaStreamTrack | null): Promise<void> {
    for (const session of this.peers.values()) {
      try {
        const transceivers = session.pc.getTransceivers();
        // Find the primary (camera) video transceiver, never a screen sender.
        const videoTransceiver = transceivers.find(
          (t) =>
            (t.receiver.track.kind === 'video' || t.sender.track?.kind === 'video') &&
            !this.isScreenVideoSender(session, t.sender)
        );

        if (videoTransceiver) {
          videoTransceiver.direction = track ? 'sendrecv' : 'recvonly';
          await videoTransceiver.sender.replaceTrack(track);
        } else if (track) {
          session.videoSender = session.pc.addTrack(track, new MediaStream([track]));
        }

        if (session.pc.signalingState === 'stable') {
          await this.sendOffer(session);
        }
      } catch (err) {
        console.warn(`[WebRTC] Error updating video track for peer ${session.peerSessionId}:`, err);
      }
    }
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
    const profile = this.currentPreset === 'CUSTOM' ? settingsStore.customProfile : QUALITY_PRESETS[this.currentPreset];
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
            const isScreen = this.isLocalScreenTrack(sender.track);
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

  public async getPeerPing(peerSessionId: string): Promise<number | null> {
    const session = this.peers.get(peerSessionId);
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

  private setupRemoteVad(peerSessionId: string): void {
    this.cleanupRemoteVad(peerSessionId);
    let isSpeaking = false;
    let silenceCounter = 0;

    const interval = setInterval(async () => {
      const session = this.peers.get(peerSessionId);
      if (!session || !session.pc || session.pc.connectionState === 'closed') {
        return;
      }
      try {
        const stats = await session.pc.getStats();
        let audioLevel: number | undefined;
        for (const report of stats.values()) {
          if (report.type === 'inbound-rtp' && (report.kind === 'audio' || report.mediaType === 'audio')) {
            if (typeof report.audioLevel === 'number') {
              audioLevel = report.audioLevel;
              break;
            }
          }
        }

        if (audioLevel !== undefined) {
          // WebRTC RFC 6464 audioLevel ranges from 0.0 to 1.0 (linear scale).
          // Packets with active voice are typically above 0.01.
          const isVoiceActive = audioLevel > 0.01;

          if (isVoiceActive) {
            silenceCounter = 0;
            if (!isSpeaking) {
              isSpeaking = true;
              participantManager.setSpeaking(peerSessionId, true);
            }
          } else {
            silenceCounter++;
            if (silenceCounter > 4 && isSpeaking) {
              isSpeaking = false;
              participantManager.setSpeaking(peerSessionId, false);
            }
          }
        }
      } catch (e) {}
    }, 50);

    this.remoteAudioVads.set(peerSessionId, { interval });
  }

  private cleanupRemoteVad(peerSessionId: string): void {
    const vad = this.remoteAudioVads.get(peerSessionId);
    if (vad) {
      clearInterval(vad.interval);
      this.remoteAudioVads.delete(peerSessionId);
    }
  }

  public getPeerConnection(peerSessionId: string): RTCPeerConnection | null {
    return this.peers.get(peerSessionId)?.pc || null;
  }

  public getPeerConnections(): RTCPeerConnection[] {
    return Array.from(this.peers.values()).map((session) => session.pc);
  }

  /**
   * Every sender publishing one local screen share — one per peer (#340).
   * Scoping `getStats()` to these senders is what lets the stage report each
   * share separately instead of merging both into the connection's totals.
   */
  public getScreenSendersForShare(shareId: string): RTCRtpSender[] {
    const senders: RTCRtpSender[] = [];
    for (const session of this.peers.values()) {
      const sender = session.screenVideoSenders.get(shareId);
      if (sender) senders.push(sender);
    }
    return senders;
  }

  /**
   * Receiver carrying a specific remote track, so the stage can read one
   * screen share's inbound stats without picking up the peer's other share or
   * their camera (#340).
   */
  public getReceiverForTrack(peerSessionId: string, trackId: string): RTCRtpReceiver | null {
    const session = this.peers.get(peerSessionId);
    if (!session) return null;
    return session.pc.getReceivers().find((receiver) => receiver.track?.id === trackId) ?? null;
  }

  public setPeerVolume(peerSessionId: string, volume: number): void {
    const clamped = Math.max(0, Math.min(100, volume));
    const audioEl = this.audioElements.get(peerSessionId);
    if (audioEl) {
      audioEl.volume = clamped / 100;
    }
  }

  public applyUserVolumes(): void {
    for (const [peerSessionId, audioEl] of this.audioElements.entries()) {
      const participant = participantManager.get(peerSessionId);
      const vol = settingsStore.getUserVolume(peerSessionId, participant?.user.clientId);
      audioEl.volume = Math.max(0, Math.min(100, vol)) / 100;
    }
  }

  public removePeer(peerSessionId: string): void {
    this.cleanupRemoteVad(peerSessionId);
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

    const session = this.peers.get(peerSessionId);
    if (session) {
      this.clearPeerTimers(session);
      session.pc.close();
      this.peers.delete(peerSessionId);
    }
  }

  public closeAllPeers(): void {
    for (const [peerSessionId] of this.peers) {
      this.removePeer(peerSessionId);
    }
    this.peers.clear();
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
    for (const peerSessionId of Array.from(this.remoteAudioVads.keys())) {
      this.cleanupRemoteVad(peerSessionId);
    }
  }
}

export const webRtcManager = new WebRtcManager();
