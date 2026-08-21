import { MessageType } from '@mini-voice/shared';
import { escapeHtml } from '../utils/html';
import { appEvents } from '../core/EventBus';
import { networkClient } from '../core/NetworkClient';
import { participantManager, ParticipantViewModel } from '../core/ParticipantManager';
import { serverStore } from '../stores/serverStore';
import { voiceStore } from '../stores/voiceStore';
import { audioProcessor } from '../core/AudioProcessor';
import { videoService } from '../core/VideoService';
import { webRtcManager } from '../core/WebRtcManager';
import { soundEffects } from '../core/SoundEffects';
import { getAvatarUrl } from '../utils/avatar';
import { userContextMenu } from './UserContextMenu';

export class VoiceStageView {
  private container: HTMLElement;
  private currentChannelId: string | null = null;
  private unbindEvents: Array<() => void> = [];
  private focusedUserId: string | null = null;
  private pingInterval: any = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public setChannel(channelId: string | null): void {
    this.currentChannelId = channelId;
    this.focusedUserId = null;
    this.render();
  }

  public render(): void {
    this.stopPingMonitor();
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
        <div class="stage-controls-bar">
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
      btnScreen.className = `btn btn-icon ${voiceStore.isScreenSharing ? 'broadcasting-pulse active' : ''}`;
      btnScreen.title = voiceStore.isScreenSharing ? 'Parar Compartilhamento de Tela' : 'Compartilhar Tela';
      btnScreen.innerHTML = `<span class="material-symbols-outlined">${voiceStore.isScreenSharing ? 'stop_screen_share' : 'screen_share'}</span>`;
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
                ${voiceStore.isScreenSharing ? 'Transmissão de Tela Ativa • Visível para todos na chamada' : 'Câmera ao Vivo • Transmitindo vídeo'}
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
        <div class="stage-grid" id="stage-grid">
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
      card.addEventListener('click', () => {
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
            videoEl.srcObject = stream;
            videoEl.play().catch(() => {});
          }
          const miniVideoEl = document.getElementById(`video-mini-${p.user.id}`) as HTMLVideoElement;
          if (miniVideoEl && miniVideoEl.srcObject !== stream) {
            miniVideoEl.srcObject = stream;
            miniVideoEl.play().catch(() => {});
          }
        }
      }
    });
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
        <video id="${videoId}" class="stage-video-element ${isScreenOn ? 'screen-share' : ''}" autoplay playsinline ${isLocal ? 'muted' : ''}></video>
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
    `;
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

  private async handleStopStreaming(): Promise<void> {
    if (voiceStore.isScreenSharing) {
      if (!confirm('Deseja parar o compartilhamento de tela?')) return;
      videoService.stopScreenShare();
      await webRtcManager.setLocalScreenTrack(null);
      voiceStore.setScreenSharing(false);
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isScreenSharing: false });
    } else if (voiceStore.isCameraOn) {
      if (!confirm('Deseja desligar sua câmera?')) return;
      videoService.stopCamera();
      await webRtcManager.setLocalCameraTrack(null);
      voiceStore.setCameraOn(false);
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isCameraOn: false });
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
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isMuted: newMuted });
      this.updateControlsUI();
      this.renderParticipants();
    });

    btnDeafen?.addEventListener('click', () => {
      const newDeafened = !voiceStore.isDeafened;
      voiceStore.setDeafened(newDeafened);
      audioProcessor.setDeafened(newDeafened);
      webRtcManager.setDeafened(newDeafened);
      soundEffects.play(newDeafened ? 'deafen' : 'undeafen');
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isDeafened: newDeafened, isMuted: voiceStore.isMuted });
      this.updateControlsUI();
      this.renderParticipants();
    });

    btnCam?.addEventListener('click', async () => {
      if (voiceStore.isCameraOn) {
        if (!confirm('Deseja desligar a sua câmera?')) return;
        videoService.stopCamera();
        await webRtcManager.setLocalCameraTrack(null);
        voiceStore.setCameraOn(false);
        networkClient.send(MessageType.VOICE_STATE_UPDATE, { isCameraOn: false });
      } else {
        if (voiceStore.isScreenSharing) {
          if (!confirm('O compartilhamento de tela será pausado para ligar a câmera. Deseja continuar?')) {
            return;
          }
          videoService.stopScreenShare();
          await webRtcManager.setLocalScreenTrack(null);
          voiceStore.setScreenSharing(false);
        }
        try {
          const stream = await videoService.startCamera();
          const track = stream.getVideoTracks()[0];
          await webRtcManager.setLocalCameraTrack(track);
          voiceStore.setCameraOn(true);
          networkClient.send(MessageType.VOICE_STATE_UPDATE, { isCameraOn: true, isScreenSharing: false });
        } catch (err: any) {
          alert(`Não foi possível acessar a câmera: ${err.message}`);
        }
      }
      this.updateControlsUI();
      this.renderParticipants();
    });

    btnScreen?.addEventListener('click', async () => {
      if (voiceStore.isScreenSharing) {
        if (!confirm('Deseja parar o compartilhamento de tela?')) return;
        videoService.stopScreenShare();
        await webRtcManager.setLocalScreenTrack(null);
        voiceStore.setScreenSharing(false);
        networkClient.send(MessageType.VOICE_STATE_UPDATE, { isScreenSharing: false });
        this.updateControlsUI();
        this.renderParticipants();
      } else {
        appEvents.emit('modal.open_screenshare_picker');
      }
    });

    btnLeave?.addEventListener('click', () => {
      if (confirm('Deseja sair da chamada de voz?')) {
        if (this.currentChannelId) {
          this.stopPingMonitor();
          soundEffects.play('leave_voice');
          networkClient.send(MessageType.VOICE_LEAVE, { channelId: this.currentChannelId });
          audioProcessor.stopMicrophone();
          videoService.stopCamera();
          videoService.stopScreenShare();
          webRtcManager.closeAllPeers();
          voiceStore.reset();
          this.setChannel(null);
        }
      }
    });

    // Listeners that do NOT destroy the DOM
    const u1 = appEvents.on('participants.updated', () => {
      this.renderParticipants();
    });

    const u2 = appEvents.on('voice.state_updated', () => {
      this.updateControlsUI();
      this.updateSpeakingClasses();
    });

    const u3 = appEvents.on('participants.speaking_changed', (data: { userId: string; speaking: boolean }) => {
      this.setCardSpeaking(data.userId, data.speaking);
    });

    const u4 = appEvents.on('voice.speaking_changed', (speaking: boolean) => {
      if (serverStore.currentUser) {
        this.setCardSpeaking(serverStore.currentUser.id, speaking);
      }
    });

    this.unbindEvents.push(u1, u2, u3, u4);
  }

  private unbindListeners(): void {
    this.unbindEvents.forEach((u) => u());
    this.unbindEvents = [];
  }

  public destroy(): void {
    this.stopPingMonitor();
    this.unbindListeners();
  }
}
