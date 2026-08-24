import { MessageType } from '@mini-voice/shared';
import { escapeHtml } from '../utils/html';
import { appEvents } from '../core/EventBus';
import { networkClient } from '../core/NetworkClient';
import { participantManager, ParticipantViewModel } from '../core/ParticipantManager';
import { screenAudioService } from '../core/ScreenAudioService';
import { serverStore } from '../stores/serverStore';
import { settingsStore } from '../stores/settingsStore';
import { voiceStore } from '../stores/voiceStore';
import { audioProcessor } from '../core/AudioProcessor';
import { videoService } from '../core/VideoService';
import { webRtcManager } from '../core/WebRtcManager';
import { soundEffects } from '../core/SoundEffects';
import { getAvatarUrl } from '../utils/avatar';
import { showAlert, showConfirm } from './Dialog';
import { userContextMenu } from './UserContextMenu';
import { setButtonLoading, isButtonLoading } from '../utils/buttonLoading';
import { soundboardModal } from './SoundboardModal';

interface ScreenTelemetrySnapshot {
  kind: 'sender' | 'receiver';
  fps: number | null;
  width: number | null;
  height: number | null;
  bitrateKbps: number | null;
  codec: string | null;
  framesEncoded: number | null;
  keyFramesEncoded: number | null;
  packetLossPct: number | null;
  jitterMs: number | null;
  framesDecoded: number | null;
  framesDropped: number | null;
}

interface TelemetryByteSample {
  bytes: number;
  timestamp: number;
}

export class VoiceStageView {
  private container: HTMLElement;
  private currentChannelId: string | null = null;
  private unbindEvents: Array<() => void> = [];
  private focusedUserId: string | null = null;
  private gridExpanded = false;
  private suppressCardClickUntil = 0;
  private pingInterval: any = null;
  private telemetryInterval: number | null = null;
  private telemetryRefreshInFlight = false;
  private telemetrySnapshots: Map<string, ScreenTelemetrySnapshot> = new Map();
  private telemetryByteSamples: Map<string, TelemetryByteSample> = new Map();

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public setChannel(channelId: string | null): void {
    this.currentChannelId = channelId;
    this.focusedUserId = null;
    if (!channelId) {
      this.stopTelemetryMonitor();
    }
    this.render();
  }

  public render(): void {
    this.stopPingMonitor();
    this.stopTelemetryMonitor(false);
    this.unbindListeners();

    if (!this.currentChannelId || !serverStore.serverDetails) {
      this.container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); gap: 12px;">
          <span class="material-symbols-outlined md-36" style="color: var(--text-dim); font-size: 48px;">volume_up</span>
          <div style="font-size: 16px; font-weight: 600; color: var(--text-secondary);">Nenhum canal de voz conectado</div>
          <div style="font-size: 13px;">Clique em um canal de voz na barra lateral para entrar na chamada!</div>
        </div>
      `;
      return;
    }

    const channel = serverStore.serverDetails.channels.find((c) => c.id === this.currentChannelId);
    const channelName = channel ? channel.name : 'Geral';

    this.container.innerHTML = `
      <div class="voice-stage-container">
        <div class="content-header">
          <div class="channel-title-container">
            <span class="material-symbols-outlined" style="color: var(--success); font-size: 20px;">volume_up</span>
            <span class="channel-title">${escapeHtml(channelName)}</span>
          </div>

          <div style="display: flex; align-items: center; gap: 10px;">
            <!-- Grid view toggle (#29) -->
            <button id="stage-btn-viewmode" class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;" title="Alternar entre visão padrão e visão em grade">
              <span class="material-symbols-outlined md-16">${this.gridExpanded ? 'view_agenda' : 'grid_view'}</span>
            </button>
            <!-- Ping / Latency Badge -->
            <div id="stage-ping-badge" class="stage-ping-badge good">
              <span class="ping-dot"></span>
              <span id="stage-ping-text">-- ms</span>
              <div class="ping-tooltip">
                <div id="ping-tooltip-content">Latência de Voz P2P: Calculando...</div>
              </div>
            </div>

            <div class="header-status-badge" style="background-color: rgba(35, 165, 90, 0.15); color: var(--success); display: flex; align-items: center; gap: 6px;">
              <span class="material-symbols-outlined md-14">wifi_tethering</span>
              <span>Conectado (Mesh P2P)</span>
            </div>
          </div>
        </div>

        <!-- Live Broadcast Top Banner Container -->
        <div id="stage-broadcast-banner-wrapper" style="display: none;"></div>

        <!-- Participants Container (Grid or Focused) -->
        <div id="stage-content-area" style="flex: 1; min-height: 0; display: flex; flex-direction: column;"></div>

        <!-- Stage Bottom Controls Bar -->
        <div class="stage-call-controls">
          <button id="stage-btn-mic" class="btn btn-icon ${voiceStore.isMuted ? 'danger-active' : ''}" title="${voiceStore.isMuted ? 'Desmutar Microfone' : 'Mutar Microfone'}">
            <span class="material-symbols-outlined">${voiceStore.isMuted ? 'mic_off' : 'mic'}</span>
          </button>
          <button id="stage-btn-deafen" class="btn btn-icon ${voiceStore.isDeafened ? 'danger-active' : ''}" title="${voiceStore.isDeafened ? 'Ouvir Áudio' : 'Mutar Tudo'}">
            <span class="material-symbols-outlined">${voiceStore.isDeafened ? 'headset_off' : 'headphones'}</span>
          </button>
          <button id="stage-btn-camera" class="btn btn-icon ${voiceStore.isCameraOn ? 'broadcasting-pulse active' : ''}" title="${voiceStore.isCameraOn ? 'Desligar Câmera' : 'Ligar Câmera'}">
            <span class="material-symbols-outlined">${voiceStore.isCameraOn ? 'videocam_off' : 'videocam'}</span>
          </button>
          <button id="stage-btn-screen" class="btn btn-icon ${voiceStore.isScreenSharing ? 'broadcasting-pulse active' : ''}" title="${voiceStore.isScreenSharing ? 'Parar Compartilhamento de Tela' : 'Compartilhar Tela'}">
            <span class="material-symbols-outlined">${voiceStore.isScreenSharing ? 'stop_screen_share' : 'screen_share'}</span>
          </button>
          <button id="stage-btn-soundboard" class="btn btn-icon" title="Abrir Soundboard">
            <span class="material-symbols-outlined">music_note</span>
          </button>
          <button id="stage-btn-leave" class="btn btn-danger" style="margin-left: 12px; padding: 0 16px; height: 38px;" title="Desconectar do canal">
            <span class="material-symbols-outlined md-18" style="margin-right: 4px;">call_end</span>
            <span>Sair da Voz</span>
          </button>
        </div>
      </div>
    `;

    this.renderParticipants();
    this.updateControlsUI();
    this.attachEvents();
    this.startPingMonitor();
    this.syncTelemetryMonitor();
  }

  public updateControlsUI(): void {
    const btnMic = document.getElementById('stage-btn-mic');
    if (btnMic) {
      btnMic.className = `btn btn-icon ${voiceStore.isMuted ? 'danger-active' : ''}`;
      btnMic.title = voiceStore.isMuted ? 'Desmutar Microfone' : 'Mutar Microfone';
      btnMic.innerHTML = `<span class="material-symbols-outlined">${voiceStore.isMuted ? 'mic_off' : 'mic'}</span>`;
    }

    const btnDeafen = document.getElementById('stage-btn-deafen');
    if (btnDeafen) {
      btnDeafen.className = `btn btn-icon ${voiceStore.isDeafened ? 'danger-active' : ''}`;
      btnDeafen.title = voiceStore.isDeafened ? 'Ouvir Áudio' : 'Mutar Tudo';
      btnDeafen.innerHTML = `<span class="material-symbols-outlined">${voiceStore.isDeafened ? 'headset_off' : 'headphones'}</span>`;
    }

    const btnCam = document.getElementById('stage-btn-camera');
    if (btnCam) {
      btnCam.className = `btn btn-icon ${voiceStore.isCameraOn ? 'broadcasting-pulse active' : ''}`;
      btnCam.title = voiceStore.isCameraOn ? 'Desligar Câmera' : 'Ligar Câmera';
      btnCam.innerHTML = `<span class="material-symbols-outlined">${voiceStore.isCameraOn ? 'videocam_off' : 'videocam'}</span>`;
    }

    const btnScreen = document.getElementById('stage-btn-screen');
    if (btnScreen) {
      const hasScreenAudio = screenAudioService.getIsCapturing();
      btnScreen.className = `btn btn-icon ${voiceStore.isScreenSharing ? 'broadcasting-pulse active' : ''}`;
      btnScreen.title = voiceStore.isScreenSharing
        ? `Parar Compartilhamento de Tela${hasScreenAudio ? ' (com áudio)' : ''}`
        : 'Compartilhar Tela';
      btnScreen.innerHTML = `
        <span class="material-symbols-outlined">${voiceStore.isScreenSharing ? 'stop_screen_share' : 'screen_share'}</span>
        ${hasScreenAudio ? '<span class="material-symbols-outlined screen-audio-badge" style="font-size: 12px; position: absolute; bottom: 2px; right: 2px; color: var(--success);">volume_up</span>' : ''}
      `;
    }

    // Top broadcast banner
    const bannerWrapper = document.getElementById('stage-broadcast-banner-wrapper');
    if (bannerWrapper) {
      const isBroadcasting = voiceStore.isCameraOn || voiceStore.isScreenSharing;
      if (isBroadcasting) {
        bannerWrapper.style.display = 'block';
        bannerWrapper.innerHTML = `
          <div class="stage-broadcast-banner">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="live-pulse-dot"></span>
              <span style="font-weight: 600; font-size: 12px; color: #ffffff;">
                ${voiceStore.isScreenSharing
                  ? `Transmissão de Tela Ativa${screenAudioService.getIsCapturing() ? ' 🔊 com Áudio' : ''} • Visível para todos na chamada`
                  : 'Câmera ao Vivo • Transmitindo vídeo'}
              </span>
            </div>
            <button id="btn-stage-quick-stop" class="btn btn-secondary" style="font-size: 11px; padding: 4px 12px; height: 26px; border-color: rgba(242, 63, 67, 0.5); color: #ff7b72;">
              <span class="material-symbols-outlined md-14" style="margin-right: 4px;">stop_circle</span>
              ${voiceStore.isScreenSharing ? 'Parar Tela' : 'Desligar Câmera'}
            </button>
          </div>
        `;
        const btnQuickStop = document.getElementById('btn-stage-quick-stop');
        btnQuickStop?.addEventListener('click', () => this.handleStopStreaming());
      } else {
        bannerWrapper.style.display = 'none';
        bannerWrapper.innerHTML = '';
      }
    }
  }

  private updateSpeakingClasses(): void {
    if (!this.currentChannelId) return;
    const participants = participantManager.getInVoiceChannel(this.currentChannelId);
    participants.forEach((p) => {
      const isLocal = p.user.id === serverStore.currentUser?.id;
      const isSpeaking = isLocal ? voiceStore.isSpeaking : p.isSpeaking;
      this.setCardSpeaking(p.user.id, isSpeaking);
    });
  }

  private setCardSpeaking(userId: string, isSpeaking: boolean): void {
    const card = document.getElementById(`card-${userId}`);
    if (card) {
      if (isSpeaking) {
        card.classList.add('speaking');
      } else {
        card.classList.remove('speaking');
      }
    }
  }

  public renderParticipants(): void {
    const area = document.getElementById('stage-content-area');
    if (!area || !this.currentChannelId) return;

    const participants = participantManager.getInVoiceChannel(this.currentChannelId);
    if (participants.length === 0) {
      area.innerHTML = `
        <div style="flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text-muted);">
          Aguardando outros amigos entrarem na chamada...
        </div>
      `;
      return;
    }

    if (this.focusedUserId && !participants.some((p) => p.user.id === this.focusedUserId)) {
      this.focusedUserId = null;
    }

    if (this.focusedUserId) {
      const focusedParticipant = participants.find((p) => p.user.id === this.focusedUserId)!;
      const otherParticipants = participants.filter((p) => p.user.id !== this.focusedUserId);
      const isFocusedSpeaking = (focusedParticipant.user.id === serverStore.currentUser?.id) ? voiceStore.isSpeaking : focusedParticipant.isSpeaking;

      area.innerHTML = `
        <div class="stage-focused-layout">
          <div class="stage-focused-main ${isFocusedSpeaking ? 'speaking' : ''}" id="card-${focusedParticipant.user.id}" data-user-id="${focusedParticipant.user.id}">
            <div class="stage-focus-hint-badge">
              <span class="material-symbols-outlined md-14">zoom_in</span>
              <span>Modo Foco • Clique para restaurar grade</span>
            </div>
            ${this.renderCardContent(focusedParticipant, true)}
          </div>

          ${otherParticipants.length > 0 ? `
            <div class="stage-focused-strip">
              ${otherParticipants.map((p) => {
                const isOtherSpeaking = (p.user.id === serverStore.currentUser?.id) ? voiceStore.isSpeaking : p.isSpeaking;
                return `
                  <div class="stage-mini-card ${isOtherSpeaking ? 'speaking' : ''}" id="card-${p.user.id}" data-user-id="${p.user.id}" title="Clique para focar em ${escapeHtml(p.user.nickname)}">
                    ${this.renderCardContent(p, false, true)}
                  </div>
                `;
              }).join('')}
            </div>
          ` : ''}
        </div>
      `;
    } else {
      area.innerHTML = `
        <div class="stage-grid ${this.gridExpanded ? 'stage-grid--expanded' : ''}" id="stage-grid">
          ${participants.map((p) => {
            const isSpeaking = (p.user.id === serverStore.currentUser?.id) ? voiceStore.isSpeaking : p.isSpeaking;
            return `
              <div class="stage-card ${isSpeaking ? 'speaking' : ''}" id="card-${p.user.id}" data-user-id="${p.user.id}" title="Clique para focar/destacar">
                ${this.renderCardContent(p, false, false)}
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // Attach click listeners to cards for focus toggle & right-click for volume adjustment
    const allCards = area.querySelectorAll('[data-user-id]');
    allCards.forEach((card) => {
      card.addEventListener('click', (e: Event) => {
        // Don't toggle focus when the click originates from an interactive
        // overlay (volume/fullscreen), nor right after a slider drag whose
        // pointer-up may land outside the controls (#75).
        if (Date.now() < this.suppressCardClickUntil) return;
        if ((e.target as HTMLElement).closest('.stage-card-controls')) return;
        const userId = card.getAttribute('data-user-id');
        if (userId) {
          this.focusedUserId = (this.focusedUserId === userId ? null : userId);
          this.renderParticipants();
        }
      });

      card.addEventListener('contextmenu', (e: Event) => {
        const mouseEvent = e as MouseEvent;
        mouseEvent.preventDefault();
        mouseEvent.stopPropagation();
        const userId = card.getAttribute('data-user-id');
        if (!userId) return;
        const participant = participantManager.get(userId);
        if (participant?.user) {
          userContextMenu.open(mouseEvent.clientX, mouseEvent.clientY, participant.user);
        }
      });
    });

    // Fullscreen buttons on video tiles (#68)
    const fsButtons = area.querySelectorAll('.stage-fullscreen-btn');
    fsButtons.forEach((btn) => {
      btn.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        const targetId = btn.getAttribute('data-fullscreen-target');
        if (targetId) this.toggleVideoFullscreen(targetId);
      });
    });

    // Screen audio volume sliders (#75)
    const volSliders = area.querySelectorAll('.stage-screen-volume-slider') as NodeListOf<HTMLInputElement>;
    volSliders.forEach((slider) => {
      slider.addEventListener('input', () => {
        const userId = slider.getAttribute('data-user-id');
        if (!userId) return;
        const vol = parseInt(slider.value, 10);
        settingsStore.setScreenAudioVolume(userId, vol);
        const audioEl = document.querySelector(`audio[data-screen-audio-user="${userId}"]`) as HTMLAudioElement | null;
        if (audioEl) audioEl.volume = vol / 100;
      });
    });

    // Volume button click → toggle mute screen audio
    const volButtons = area.querySelectorAll('.stage-volume-btn') as NodeListOf<HTMLButtonElement>;
    volButtons.forEach((btn) => {
      btn.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        const wrapper = btn.closest('.stage-volume-wrapper');
        const slider = wrapper?.querySelector('.stage-screen-volume-slider') as HTMLInputElement | null;
        if (!slider) return;
        const userId = slider.getAttribute('data-user-id');
        if (!userId) return;
        const audioEl = document.querySelector(`audio[data-screen-audio-user="${userId}"]`) as HTMLAudioElement | null;
        if (!audioEl) return;

        const icon = btn.querySelector('.material-symbols-outlined');
        if (audioEl.muted) {
          audioEl.muted = false;
          if (icon) icon.textContent = 'volume_up';
          btn.title = 'Volume do áudio da tela';
        } else {
          audioEl.muted = true;
          if (icon) icon.textContent = 'volume_off';
          btn.title = 'Áudio da tela mutado (clique para desmutar)';
        }
      });
    });

    // Volume controls must not toggle card focus (which re-renders and drops
    // fullscreen). Suppress the card click that follows any control interaction,
    // and keep the slider popup open + tracking the pointer while dragging, even
    // when the mouse leaves the small popup area (#75).
    const controlBars = area.querySelectorAll('.stage-card-controls');
    controlBars.forEach((bar) => {
      bar.addEventListener('pointerdown', () => {
        this.suppressCardClickUntil = Date.now() + 800;
      });
    });

    const volWrappers = area.querySelectorAll('.stage-volume-wrapper');
    volWrappers.forEach((wrapper) => {
      const slider = wrapper.querySelector('.stage-screen-volume-slider') as HTMLInputElement | null;
      if (!slider) return;
      slider.addEventListener('pointerdown', (e: Event) => {
        wrapper.classList.add('dragging');
        try { slider.setPointerCapture((e as PointerEvent).pointerId); } catch { /* ignore */ }
      });
      const endDrag = () => {
        wrapper.classList.remove('dragging');
        // Keep suppressing briefly so the trailing click can't reach the card.
        this.suppressCardClickUntil = Date.now() + 400;
      };
      slider.addEventListener('pointerup', endDrag);
      slider.addEventListener('lostpointercapture', endDrag);
    });

    // Attach media streams to video elements cleanly
    participants.forEach((p) => {
      const isLocal = p.user.id === serverStore.currentUser?.id;
      const isCamOn = isLocal ? voiceStore.isCameraOn : (p.voiceState?.isCameraOn ?? false);
      const isScreenOn = isLocal ? voiceStore.isScreenSharing : (p.voiceState?.isScreenSharing ?? false);

      if (isCamOn || isScreenOn) {
        const stream = isLocal
          ? (isScreenOn ? videoService.getScreenStream() : videoService.getCameraStream())
          : p.remoteStream;

        if (stream) {
          const videoEl = document.getElementById(`video-${p.user.id}`) as HTMLVideoElement;
          if (videoEl && videoEl.srcObject !== stream) {
            videoEl.muted = true;
            videoEl.srcObject = stream;
            this.hideVideoLoadingWhenReady(videoEl, `video-${p.user.id}`);
            videoEl.play().catch(() => {});
          }
          const miniVideoEl = document.getElementById(`video-mini-${p.user.id}`) as HTMLVideoElement;
          if (miniVideoEl && miniVideoEl.srcObject !== stream) {
            miniVideoEl.muted = true;
            miniVideoEl.srcObject = stream;
            this.hideVideoLoadingWhenReady(miniVideoEl, `video-mini-${p.user.id}`);
            miniVideoEl.play().catch(() => {});
          }
        }
      }
    });

    this.applyTelemetryOverlayState();
    this.syncTelemetryMonitor();
  }

  /** Removes the "loading video" overlay once the stream actually renders (#48). */
  private hideVideoLoadingWhenReady(videoEl: HTMLVideoElement, videoId: string): void {
    const overlay = document.getElementById(`loading-${videoId}`);
    if (!overlay) return;
    const hide = () => overlay.remove();
    if (videoEl.readyState >= 2) {
      hide();
      return;
    }
    videoEl.addEventListener('playing', hide, { once: true });
    videoEl.addEventListener('loadeddata', hide, { once: true });
  }

  /** Toggles native fullscreen for a stage video tile (#68).
   *  Fullscreens the whole card (a <div>), not the bare <video>, so Chromium's
   *  native video controls don't appear — they act on the muted <video> element
   *  and can't reach the screen-audio <audio> element. Keeping the card in
   *  fullscreen preserves the stage's real volume/mute controls (#75). */
  private async toggleVideoFullscreen(videoId: string): Promise<void> {
    const videoEl = document.getElementById(videoId) as HTMLVideoElement | null;
    if (!videoEl) return;
    const target = (videoEl.closest('.stage-card, .stage-focused-main, .stage-mini-card') as HTMLElement | null) ?? videoEl;
    try {
      if (document.fullscreenElement === target) {
        await document.exitFullscreen();
      } else {
        await target.requestFullscreen();
      }
    } catch (err) {
      console.warn('[VoiceStageView] Fullscreen request failed:', err);
    }
  }

  private renderCardContent(p: ParticipantViewModel, isFocused: boolean = false, isMini: boolean = false): string {
    const isLocal = p.user.id === serverStore.currentUser?.id;
    const isCamOn = isLocal ? voiceStore.isCameraOn : (p.voiceState?.isCameraOn ?? false);
    const isScreenOn = isLocal ? voiceStore.isScreenSharing : (p.voiceState?.isScreenSharing ?? false);
    const isMuted = isLocal ? voiceStore.isMuted : (p.voiceState?.isMuted ?? false);
    const isDeafened = isLocal ? voiceStore.isDeafened : (p.voiceState?.isDeafened ?? false);
    const avatarSrc = getAvatarUrl(p.user.avatarUrl);
    const videoId = isMini ? `video-mini-${p.user.id}` : `video-${p.user.id}`;

    return `
      ${(isCamOn || isScreenOn) ? `
        <video id="${videoId}" class="stage-video-element ${isScreenOn ? 'screen-share' : ''}" autoplay playsinline muted></video>
        <div class="stage-loading-overlay" id="loading-${videoId}">
          <div class="reconnect-spinner"></div>
          <span>${isScreenOn ? 'Carregando tela…' : 'Carregando câmera…'}</span>
        </div>
        ${isScreenOn ? `
          <div
            class="telemetry-overlay position-${settingsStore.screenShareTelemetryPosition}${settingsStore.screenShareTelemetryEnabled ? '' : ' is-hidden'}"
            data-telemetry-user-id="${p.user.id}"
          >${this.getTelemetryText(p.user.id)}</div>
        ` : ''}
        <div class="stage-card-controls">
          ${(isScreenOn && !isLocal) ? `
            <div class="stage-volume-wrapper">
              <div class="stage-volume-popup">
                <input type="range" class="stage-screen-volume-slider" data-user-id="${p.user.id}" min="0" max="100" value="${settingsStore.getScreenAudioVolume(p.user.id)}" />
              </div>
              <button class="stage-volume-btn" title="Volume do áudio da tela" aria-label="Volume">
                <span class="material-symbols-outlined md-18">volume_up</span>
              </button>
            </div>
          ` : ''}
          <button class="stage-fullscreen-btn" data-fullscreen-target="${videoId}" title="Tela cheia" aria-label="Tela cheia">
            <span class="material-symbols-outlined md-18">fullscreen</span>
          </button>
        </div>
      ` : `
        <div class="stage-avatar-wrapper">
          <img class="stage-avatar-img" src="${avatarSrc}">
          ${!isMini ? `
            <div class="stage-participant-name">${escapeHtml(p.user.nickname)} ${isLocal ? '(Você)' : ''}</div>
          ` : ''}
        </div>
      `}

      <div class="stage-badges-overlay">
        <span>${escapeHtml(p.user.nickname)}</span>
        ${isMuted ? '<span class="material-symbols-outlined md-14" style="color: var(--danger);">mic_off</span>' : ''}
        ${isDeafened ? '<span class="material-symbols-outlined md-14" style="color: var(--danger);">headset_off</span>' : ''}
        ${isCamOn ? '<span class="material-symbols-outlined md-14" style="color: var(--accent-primary);">videocam</span>' : ''}
        ${isScreenOn ? '<span class="material-symbols-outlined md-14" style="color: var(--success);">screen_share</span>' : ''}
      </div>
      ${(!isLocal && p.isReconnecting) ? `
        <div class="stage-reconnecting-overlay">
          <div class="reconnect-spinner"></div>
          <span>Reconectando…</span>
        </div>
      ` : ''}
    `;
  }

  private getTelemetryText(userId: string): string {
    const snapshot = this.telemetrySnapshots.get(userId);
    if (!snapshot) {
      return 'Coletando...';
    }

    const lines = [
      `FPS: ${this.formatTelemetryNumber(snapshot.fps, 0)}`,
      `Res: ${this.formatResolution(snapshot.width, snapshot.height)}`,
      `Bitrate: ${this.formatTelemetryNumber(snapshot.bitrateKbps, 0, ' kbps')}`,
    ];

    if (settingsStore.screenShareTelemetryMode === 'complete') {
      if (snapshot.kind === 'sender') {
        lines.push(
          `Codec: ${snapshot.codec || '--'}`,
          `Frames enc: ${this.formatTelemetryNumber(snapshot.framesEncoded, 0)}`,
          `Keyframes: ${this.formatTelemetryNumber(snapshot.keyFramesEncoded, 0)}`
        );
      } else {
        lines.push(
          `Codec: ${snapshot.codec || '--'}`,
          `Loss: ${this.formatTelemetryNumber(snapshot.packetLossPct, 1, '%')}`,
          `Jitter: ${this.formatTelemetryNumber(snapshot.jitterMs, 1, ' ms')}`,
          `Frames dec: ${this.formatTelemetryNumber(snapshot.framesDecoded, 0)}`,
          `Frames drop: ${this.formatTelemetryNumber(snapshot.framesDropped, 0)}`
        );
      }
    }

    return lines.join('\n');
  }

  private formatTelemetryNumber(value: number | null, decimals: number, suffix = ''): string {
    if (value === null || !Number.isFinite(value)) return `--${suffix}`;
    return `${value.toFixed(decimals)}${suffix}`;
  }

  private formatResolution(width: number | null, height: number | null): string {
    if (!width || !height) return '--';
    return `${width}x${height}`;
  }

  private applyTelemetryOverlayState(): void {
    const overlays = this.container.querySelectorAll('.telemetry-overlay');
    overlays.forEach((overlay) => {
      overlay.classList.remove(
        'position-top-left',
        'position-top-right',
        'position-bottom-left',
        'position-bottom-right'
      );
      overlay.classList.add(`position-${settingsStore.screenShareTelemetryPosition}`);
      overlay.classList.toggle('is-hidden', !settingsStore.screenShareTelemetryEnabled);
      const userId = overlay.getAttribute('data-telemetry-user-id');
      if (userId) {
        overlay.textContent = this.getTelemetryText(userId);
      }
    });
  }

  private hasActiveScreenShares(): boolean {
    if (!this.currentChannelId) return false;
    return participantManager.getInVoiceChannel(this.currentChannelId).some((participant) => {
      const isLocal = participant.user.id === serverStore.currentUser?.id;
      return isLocal ? voiceStore.isScreenSharing : (participant.voiceState?.isScreenSharing ?? false);
    });
  }

  private syncTelemetryMonitor(): void {
    if (!this.currentChannelId || !settingsStore.screenShareTelemetryEnabled || !this.hasActiveScreenShares()) {
      this.stopTelemetryMonitor(false);
      this.applyTelemetryOverlayState();
      return;
    }

    if (this.telemetryInterval !== null) {
      this.applyTelemetryOverlayState();
      return;
    }

    const tick = () => {
      void this.refreshTelemetry();
    };

    tick();
    this.telemetryInterval = window.setInterval(tick, 1500);
  }

  private async refreshTelemetry(): Promise<void> {
    if (this.telemetryRefreshInFlight || !this.currentChannelId || !settingsStore.screenShareTelemetryEnabled) {
      return;
    }

    this.telemetryRefreshInFlight = true;
    try {
      const participants = participantManager.getInVoiceChannel(this.currentChannelId);
      const screenParticipants = participants.filter((participant) => {
        const isLocal = participant.user.id === serverStore.currentUser?.id;
        return isLocal ? voiceStore.isScreenSharing : (participant.voiceState?.isScreenSharing ?? false);
      });

      if (screenParticipants.length === 0) {
        this.telemetrySnapshots.clear();
        this.telemetryByteSamples.clear();
        this.applyTelemetryOverlayState();
        this.stopTelemetryMonitor(false);
        return;
      }

      const nextSnapshots = new Map<string, ScreenTelemetrySnapshot>();
      await Promise.all(screenParticipants.map(async (participant) => {
        const snapshot = await this.collectTelemetrySnapshot(participant);
        if (snapshot) {
          nextSnapshots.set(participant.user.id, snapshot);
        }
      }));

      this.telemetrySnapshots = nextSnapshots;
      this.pruneTelemetryByteSamples(Array.from(screenParticipants, (participant) => participant.user.id));
      this.applyTelemetryOverlayState();
    } finally {
      this.telemetryRefreshInFlight = false;
    }
  }

  private async collectTelemetrySnapshot(participant: ParticipantViewModel): Promise<ScreenTelemetrySnapshot | null> {
    const isLocal = participant.user.id === serverStore.currentUser?.id;
    return isLocal
      ? this.collectSenderTelemetry(participant.user.id)
      : this.collectReceiverTelemetry(participant.user.id);
  }

  private async collectSenderTelemetry(userId: string): Promise<ScreenTelemetrySnapshot | null> {
    const peerConnections = webRtcManager.getPeerConnections();
    const localTrack = videoService.getScreenStream()?.getVideoTracks()[0] || null;
    const fallback = this.getLocalScreenFallback();

    if (peerConnections.length === 0) {
      return fallback;
    }

    let fps: number | null = fallback?.fps ?? null;
    let width: number | null = fallback?.width ?? null;
    let height: number | null = fallback?.height ?? null;
    let codec: string | null = null;
    let framesEncoded = 0;
    let keyFramesEncoded = 0;
    let totalBitrateKbps = 0;
    let reportCount = 0;

    await Promise.all(peerConnections.map(async (pc, index) => {
      try {
        const stats = await pc.getStats();
        stats.forEach((report: any) => {
          const kind = report.kind || report.mediaType;
          if (report.type !== 'outbound-rtp' || kind !== 'video' || typeof report.bytesSent !== 'number') {
            return;
          }

          reportCount++;
          fps = this.pickTelemetryNumber(fps, report.framesPerSecond);
          width = this.pickTelemetryNumber(width, report.frameWidth);
          height = this.pickTelemetryNumber(height, report.frameHeight);
          if (!codec) {
            codec = this.getCodecName(stats, report.codecId);
          }
          if (typeof report.framesEncoded === 'number') {
            framesEncoded += report.framesEncoded;
          }
          if (typeof report.keyFramesEncoded === 'number') {
            keyFramesEncoded += report.keyFramesEncoded;
          }

          const bitrate = this.computeBitrateKbps(`sender:${userId}:${index}:${report.id}`, report.bytesSent);
          if (bitrate !== null) {
            totalBitrateKbps += bitrate;
          }
        });
      } catch (err) {
        console.warn('[VoiceStageView] Error collecting sender telemetry:', err);
      }
    }));

    if (reportCount === 0) {
      if (localTrack) return fallback;
      return null;
    }

    return {
      kind: 'sender',
      fps,
      width,
      height,
      bitrateKbps: totalBitrateKbps > 0 ? totalBitrateKbps : 0,
      codec,
      framesEncoded,
      keyFramesEncoded,
      packetLossPct: null,
      jitterMs: null,
      framesDecoded: null,
      framesDropped: null,
    };
  }

  private async collectReceiverTelemetry(userId: string): Promise<ScreenTelemetrySnapshot | null> {
    const pc = webRtcManager.getPeerConnection(userId);
    if (!pc) return null;

    try {
      const stats = await pc.getStats();
      let snapshot: ScreenTelemetrySnapshot | null = null;

      stats.forEach((report: any) => {
        const kind = report.kind || report.mediaType;
        if (snapshot || report.type !== 'inbound-rtp' || kind !== 'video' || typeof report.bytesReceived !== 'number') {
          return;
        }

        const packetsReceived = typeof report.packetsReceived === 'number' ? report.packetsReceived : 0;
        const packetsLost = typeof report.packetsLost === 'number' ? report.packetsLost : 0;
        const totalPackets = packetsReceived + packetsLost;
        const packetLossPct = totalPackets > 0 ? (packetsLost / totalPackets) * 100 : 0;
        const jitterMs = typeof report.jitter === 'number' ? report.jitter * 1000 : null;

        snapshot = {
          kind: 'receiver',
          fps: this.pickTelemetryNumber(null, report.framesPerSecond),
          width: this.pickTelemetryNumber(null, report.frameWidth),
          height: this.pickTelemetryNumber(null, report.frameHeight),
          bitrateKbps: this.computeBitrateKbps(`receiver:${userId}:${report.id}`, report.bytesReceived) ?? 0,
          codec: this.getCodecName(stats, report.codecId),
          framesEncoded: null,
          keyFramesEncoded: null,
          packetLossPct,
          jitterMs,
          framesDecoded: typeof report.framesDecoded === 'number' ? report.framesDecoded : null,
          framesDropped: typeof report.framesDropped === 'number' ? report.framesDropped : null,
        };
      });

      return snapshot;
    } catch (err) {
      console.warn('[VoiceStageView] Error collecting receiver telemetry:', err);
      return null;
    }
  }

  private getLocalScreenFallback(): ScreenTelemetrySnapshot | null {
    const track = videoService.getScreenStream()?.getVideoTracks()[0];
    if (!track) return null;

    const settings = track.getSettings();
    return {
      kind: 'sender',
      fps: typeof settings.frameRate === 'number' ? settings.frameRate : null,
      width: typeof settings.width === 'number' ? settings.width : null,
      height: typeof settings.height === 'number' ? settings.height : null,
      bitrateKbps: 0,
      codec: null,
      framesEncoded: null,
      keyFramesEncoded: null,
      packetLossPct: null,
      jitterMs: null,
      framesDecoded: null,
      framesDropped: null,
    };
  }

  private pickTelemetryNumber(currentValue: number | null, nextValue: unknown): number | null {
    return typeof nextValue === 'number' && Number.isFinite(nextValue) ? nextValue : currentValue;
  }

  private getCodecName(stats: RTCStatsReport, codecId?: string): string | null {
    if (!codecId) return null;
    const codecReport = stats.get(codecId) as any;
    const mimeType = typeof codecReport?.mimeType === 'string' ? codecReport.mimeType : '';
    if (!mimeType) return null;
    const parts = mimeType.split('/');
    return parts[parts.length - 1] || mimeType;
  }

  private computeBitrateKbps(key: string, bytes: number): number | null {
    const now = Date.now();
    const previous = this.telemetryByteSamples.get(key);
    this.telemetryByteSamples.set(key, { bytes, timestamp: now });
    if (!previous) return null;

    const deltaBytes = bytes - previous.bytes;
    const deltaMs = now - previous.timestamp;
    if (deltaBytes < 0 || deltaMs <= 0) return null;

    return (deltaBytes * 8) / (deltaMs / 1000) / 1000;
  }

  private pruneTelemetryByteSamples(activeUserIds: string[]): void {
    const activePrefixes = new Set(activeUserIds.map((userId) => `:${userId}:`));
    for (const key of this.telemetryByteSamples.keys()) {
      const isActive = Array.from(activePrefixes).some((prefix) => key.includes(prefix));
      if (!isActive) {
        this.telemetryByteSamples.delete(key);
      }
    }
  }

  private stopTelemetryMonitor(clearSnapshots: boolean = true): void {
    if (this.telemetryInterval !== null) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
    }

    if (clearSnapshots) {
      this.telemetrySnapshots.clear();
      this.telemetryByteSamples.clear();
    }
  }

  private startPingMonitor(): void {
    this.stopPingMonitor();

    const updatePing = async () => {
      const pingBadge = document.getElementById('stage-ping-badge');
      const pingText = document.getElementById('stage-ping-text');
      const tooltipContent = document.getElementById('ping-tooltip-content');

      if (!pingBadge || !pingText || !this.currentChannelId) return;

      const participants = participantManager.getInVoiceChannel(this.currentChannelId);
      const isSolo = participants.length <= 1;

      if (isSolo) {
        pingBadge.className = 'stage-ping-badge good';
        pingText.textContent = '0 ms';
        if (tooltipContent) {
          tooltipContent.innerHTML = `
            <b>Status:</b> Conectado localmente<br>
            <b>Latência:</b> 0 ms (Você é o único no canal)
          `;
        }
        return;
      }

      const avgPing = await webRtcManager.getAverageP2pPing();

      if (avgPing !== null) {
        pingText.textContent = `${avgPing} ms`;

        let quality = 'Excelente';
        if (avgPing < 50) {
          pingBadge.className = 'stage-ping-badge good';
          quality = 'Excelente (Baixa Latência)';
        } else if (avgPing < 120) {
          pingBadge.className = 'stage-ping-badge medium';
          quality = 'Boa conexão';
        } else {
          pingBadge.className = 'stage-ping-badge bad';
          quality = 'Latência Alta';
        }

        if (tooltipContent) {
          tooltipContent.innerHTML = `
            <b>Latência P2P WebRTC:</b> ${avgPing} ms<br>
            <b>Qualidade:</b> ${quality}<br>
            <span style="color: var(--text-muted); font-size: 10px;">Comunicação ponto-a-ponto direta entre amigos</span>
          `;
        }
      } else {
        pingText.textContent = 'P2P';
        pingBadge.className = 'stage-ping-badge good';
        if (tooltipContent) {
          tooltipContent.innerHTML = `<b>Mesh P2P:</b> Estabelecendo rota direta...`;
        }
      }
    };

    updatePing();
    this.pingInterval = setInterval(updatePing, 2000);
  }

  private stopPingMonitor(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Leaves the current voice call. Public so it can also be triggered from the
   * sidebar voice-connection row (#60). No confirmation is shown (#59).
   */
  public leaveVoice(): void {
    if (!this.currentChannelId) return;
    this.stopPingMonitor();
    this.stopTelemetryMonitor();
    soundEffects.play('leave_voice');
    networkClient.send(MessageType.VOICE_LEAVE, { channelId: this.currentChannelId });
    audioProcessor.stopMicrophone();
    videoService.stopCamera();
    videoService.stopScreenShare();
    webRtcManager.closeAllPeers();
    voiceStore.reset();
    this.setChannel(null);
  }

  private async handleStopStreaming(): Promise<void> {
    if (voiceStore.isScreenSharing) {
      const confirmed = await showConfirm({
        title: 'Parar compartilhamento',
        message: 'Deseja parar o compartilhamento de tela?',
        confirmLabel: 'Parar',
        variant: 'warning',
      });
      if (!confirmed) return;
      videoService.stopScreenShare();
      await webRtcManager.setLocalScreenTrack(null);
      voiceStore.setScreenSharing(false);
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isScreenSharing: false });
    } else if (voiceStore.isCameraOn) {
      videoService.stopCamera();
      await webRtcManager.setLocalCameraTrack(null);
      voiceStore.setCameraOn(false);
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isCameraOn: false });
    }
    this.updateControlsUI();
    this.renderParticipants();
  }

  /**
   * Toggles the local camera. Extracted so it can be triggered both from the
   * stage controls and from the sidebar media bar (#29). Handles switching from
   * an active screen share and cleanly reverts state if the camera fails to
   * start (e.g. no camera plugged in).
   */
  public async toggleCamera(): Promise<void> {
    if (voiceStore.isCameraOn) {
      videoService.stopCamera();
      await webRtcManager.setLocalCameraTrack(null);
      voiceStore.setCameraOn(false);
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isCameraOn: false });
    } else {
      const wasScreenSharing = voiceStore.isScreenSharing;
      if (wasScreenSharing) {
        const confirmed = await showConfirm({
          title: 'Ligar câmera',
          message: 'O compartilhamento de tela será pausado para ligar a câmera. Deseja continuar?',
          confirmLabel: 'Continuar',
          variant: 'warning',
        });
        if (!confirmed) return;
        videoService.stopScreenShare();
        await webRtcManager.setLocalScreenTrack(null);
        voiceStore.setScreenSharing(false);
        // Broadcast the stop immediately so others don't keep seeing a stale
        // screen-share icon / black frame if the camera fails to start below.
        networkClient.send(MessageType.VOICE_STATE_UPDATE, { isScreenSharing: false });
      }
      try {
        const stream = await videoService.startCamera();
        const track = stream.getVideoTracks()[0];
        await webRtcManager.setLocalCameraTrack(track);
        voiceStore.setCameraOn(true);
        networkClient.send(MessageType.VOICE_STATE_UPDATE, { isCameraOn: true, isScreenSharing: false });
      } catch (err: any) {
        // Fully revert local state and make sure the server/other clients
        // reflect that nothing is being broadcast (no camera, no screen).
        videoService.stopCamera();
        await webRtcManager.setLocalCameraTrack(null);
        voiceStore.setCameraOn(false);
        networkClient.send(MessageType.VOICE_STATE_UPDATE, { isCameraOn: false, isScreenSharing: false });
        await showAlert({
          title: 'Erro na câmera',
          message: `Não foi possível acessar a câmera. Verifique se há uma câmera conectada e disponível.\n\nDetalhe: ${err?.message || err}`,
          variant: 'danger',
        });
      }
    }
    this.updateControlsUI();
    this.renderParticipants();
  }

  private attachEvents(): void {
    const btnMic = document.getElementById('stage-btn-mic');
    const btnDeafen = document.getElementById('stage-btn-deafen');
    const btnCam = document.getElementById('stage-btn-camera');
    const btnScreen = document.getElementById('stage-btn-screen');
    const btnLeave = document.getElementById('stage-btn-leave');

    btnMic?.addEventListener('click', () => {
      const newMuted = !voiceStore.isMuted;
      voiceStore.setMuted(newMuted);
      audioProcessor.setMuted(newMuted);
      soundEffects.play(newMuted ? 'mic_mute' : 'mic_unmute');
      // Unmuting the mic while deafened doesn't make sense (you'd talk but not
      // hear): also undeafen the audio output in that case (#62).
      let undeafened = false;
      if (!newMuted && voiceStore.isDeafened) {
        voiceStore.setDeafened(false);
        audioProcessor.setDeafened(false);
        webRtcManager.setDeafened(false);
        undeafened = true;
      }
      networkClient.send(MessageType.VOICE_STATE_UPDATE, {
        isMuted: newMuted,
        ...(undeafened ? { isDeafened: false } : {}),
      });
      this.updateControlsUI();
      this.renderParticipants();
    });

    btnDeafen?.addEventListener('click', () => {
      const newDeafened = !voiceStore.isDeafened;
      voiceStore.setDeafened(newDeafened);
      audioProcessor.setDeafened(newDeafened);
      // Restore the mic track to its (possibly restored) pre-deafen state (#74).
      audioProcessor.setMuted(voiceStore.isMuted);
      webRtcManager.setDeafened(newDeafened);
      soundEffects.play(newDeafened ? 'deafen' : 'undeafen');
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isDeafened: newDeafened, isMuted: voiceStore.isMuted });
      this.updateControlsUI();
      this.renderParticipants();
    });

    btnCam?.addEventListener('click', async () => {
      if (isButtonLoading(btnCam)) return;
      setButtonLoading(btnCam, true);
      try {
        await this.toggleCamera();
      } finally {
        setButtonLoading(btnCam, false);
      }
    });

    btnScreen?.addEventListener('click', () => {
      if (isButtonLoading(btnScreen)) return;
      // Show a loading state until the picker modal is actually open (#48).
      setButtonLoading(btnScreen, true);
      window.setTimeout(() => setButtonLoading(btnScreen, false), 10000);
      // Always open the picker: when not sharing, to start; when already sharing,
      // to switch source or stop (handled inside the modal).
      appEvents.emit('modal.open_screenshare_picker');
    });

    const btnViewMode = document.getElementById('stage-btn-viewmode');
    btnViewMode?.addEventListener('click', () => {
      this.gridExpanded = !this.gridExpanded;
      // The expanded grid is a full equal-split view, so leave focus mode.
      if (this.gridExpanded) this.focusedUserId = null;
      const icon = btnViewMode.querySelector('.material-symbols-outlined');
      if (icon) icon.textContent = this.gridExpanded ? 'view_agenda' : 'grid_view';
      this.renderParticipants();
    });

    const btnSoundboard = document.getElementById('stage-btn-soundboard');
    btnSoundboard?.addEventListener('click', () => {
      soundboardModal.open();
    });

    btnLeave?.addEventListener('click', () => this.leaveVoice());

    // Listeners that do NOT destroy the DOM
    const u1 = appEvents.on('participants.updated', () => {
      this.renderParticipants();
    });

    const u2 = appEvents.on('voice.state_updated', () => {
      this.updateControlsUI();
      this.updateSpeakingClasses();
      this.applyTelemetryOverlayState();
      this.syncTelemetryMonitor();
    });

    const u3 = appEvents.on('participants.speaking_changed', (data: { userId: string; speaking: boolean }) => {
      this.setCardSpeaking(data.userId, data.speaking);
    });

    const u4 = appEvents.on('voice.speaking_changed', (speaking: boolean) => {
      if (serverStore.currentUser) {
        this.setCardSpeaking(serverStore.currentUser.id, speaking);
      }
    });

    // Clear the screen-share button loading once the picker modal is open (or
    // closed, as a safety) — loading should last only until the modal opens (#48).
    const clearScreenLoading = () => setButtonLoading(btnScreen, false);
    const u5 = appEvents.on('modal.screenshare_picker_opened', clearScreenLoading);
    const u6 = appEvents.on('modal.screenshare_picker_closed', clearScreenLoading);
    const u7 = appEvents.on('settings.updated', () => {
      this.applyTelemetryOverlayState();
      this.syncTelemetryMonitor();
    });

    const u8 = appEvents.on('local.screen_audio_started', () => this.updateControlsUI());
    const u9 = appEvents.on('local.screen_audio_stopped', () => this.updateControlsUI());

    this.unbindEvents.push(u1, u2, u3, u4, u5, u6, u7, u8, u9);
  }

  private unbindListeners(): void {
    this.unbindEvents.forEach((u) => u());
    this.unbindEvents = [];
  }

  public destroy(): void {
    this.stopPingMonitor();
    this.stopTelemetryMonitor();
    this.unbindListeners();
  }
}
