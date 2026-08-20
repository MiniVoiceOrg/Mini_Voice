import { MessageType } from '@mini-voice/shared';
import { appEvents } from '../core/EventBus';
import { networkClient } from '../core/NetworkClient';
import { participantManager, ParticipantViewModel } from '../core/ParticipantManager';
import { serverStore } from '../stores/serverStore';
import { voiceStore } from '../stores/voiceStore';
import { audioProcessor } from '../core/AudioProcessor';
import { videoService } from '../core/VideoService';
import { webRtcManager } from '../core/WebRtcManager';
import { getAvatarUrl } from '../utils/avatar';

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
    if (!this.currentChannelId || !serverStore.serverDetails) {
      this.stopPingMonitor();
      this.container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); gap: 10px;">
          <div style="font-size: 40px;">🔊</div>
          <div style="font-size: 16px; font-weight: 600;">Nenhum canal de voz conectado</div>
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
            <span style="color: var(--success); font-size: 18px;">🔊</span>
            <span class="channel-title">${this.escapeHtml(channelName)}</span>
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

            <div class="header-status-badge" style="background-color: rgba(35, 165, 90, 0.15); color: var(--success);">
              Conectado (Voz P2P)
            </div>
          </div>
        </div>

        <!-- Participants Container (Grid or Focused) -->
        <div id="stage-content-area" style="flex: 1; min-height: 0; display: flex; flex-direction: column;"></div>

        <div class="stage-controls-bar">
          <button id="stage-btn-mic" class="btn btn-icon ${voiceStore.isMuted ? 'danger-active' : ''}" title="${voiceStore.isMuted ? 'Desmutar Microfone' : 'Mutar Microfone'}">
            ${voiceStore.isMuted ? '🔇' : '🎤'}
          </button>
          <button id="stage-btn-deafen" class="btn btn-icon ${voiceStore.isDeafened ? 'danger-active' : ''}" title="${voiceStore.isDeafened ? 'Ouvir Áudio' : 'Mutar Tudo'}">
            ${voiceStore.isDeafened ? '🔇' : '🎧'}
          </button>
          <button id="stage-btn-camera" class="btn btn-icon ${voiceStore.isCameraOn ? 'active' : ''}" title="${voiceStore.isCameraOn ? 'Desligar Câmera' : 'Ligar Câmera'}">
            📷
          </button>
          <button id="stage-btn-screen" class="btn btn-icon ${voiceStore.isScreenSharing ? 'active' : ''}" title="${voiceStore.isScreenSharing ? 'Parar Compartilhamento' : 'Compartilhar Tela'}">
            🖥️
          </button>
          <button id="stage-btn-leave" class="btn btn-danger" style="margin-left: 12px; padding: 0 16px; height: 38px;" title="Desconectar do canal">
            <span>🚪</span> Sair da Voz
          </button>
        </div>
      </div>
    `;

    this.renderParticipants();
    this.attachEvents();
    this.startPingMonitor();
  }

  private renderParticipants(): void {
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

    // Check if focused user still exists in channel
    if (this.focusedUserId && !participants.some((p) => p.user.id === this.focusedUserId)) {
      this.focusedUserId = null;
    }

    if (this.focusedUserId) {
      // Focused View Mode
      const focusedParticipant = participants.find((p) => p.user.id === this.focusedUserId)!;
      const otherParticipants = participants.filter((p) => p.user.id !== this.focusedUserId);

      area.innerHTML = `
        <div class="stage-focused-layout">
          <div class="stage-focused-main ${focusedParticipant.isSpeaking ? 'speaking' : ''}" id="card-${focusedParticipant.user.id}" data-user-id="${focusedParticipant.user.id}">
            <div class="stage-focus-hint-badge">
              <span>🔎 Modo Foco</span> • Clique para restaurar grade
            </div>

            ${this.renderCardContent(focusedParticipant, true)}
          </div>

          ${otherParticipants.length > 0 ? `
            <div class="stage-focused-strip">
              ${otherParticipants.map((p) => `
                <div class="stage-mini-card ${p.isSpeaking ? 'speaking' : ''}" id="card-${p.user.id}" data-user-id="${p.user.id}" title="Clique para focar em ${this.escapeHtml(p.user.nickname)}">
                  ${this.renderCardContent(p, false, true)}
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
    } else {
      // Standard Grid Mode (Square cards)
      area.innerHTML = `
        <div class="stage-grid" id="stage-grid">
          ${participants.map((p) => `
            <div class="stage-card ${p.isSpeaking ? 'speaking' : ''}" id="card-${p.user.id}" data-user-id="${p.user.id}" title="Clique para focar/destacar">
              ${this.renderCardContent(p, false, false)}
            </div>
          `).join('')}
        </div>
      `;
    }

    // Attach click listeners to cards for focus toggle
    const allCards = area.querySelectorAll('[data-user-id]');
    allCards.forEach((card) => {
      card.addEventListener('click', () => {
        const userId = card.getAttribute('data-user-id');
        if (userId) {
          this.focusedUserId = (this.focusedUserId === userId ? null : userId);
          this.renderParticipants();
        }
      });
    });

    // Attach media streams to video elements
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
          if (videoEl) {
            videoEl.srcObject = stream;
            videoEl.play().catch(() => {});
          }
          const miniVideoEl = document.getElementById(`video-mini-${p.user.id}`) as HTMLVideoElement;
          if (miniVideoEl) {
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
            <div class="stage-participant-name">${this.escapeHtml(p.user.nickname)} ${isLocal ? '(Você)' : ''}</div>
          ` : ''}
        </div>
      `}

      <div class="stage-badges-overlay">
        <span>${this.escapeHtml(p.user.nickname)}</span>
        ${isMuted ? '<span class="stage-badge-icon">🔇</span>' : ''}
        ${isDeafened ? '<span class="stage-badge-icon">🚫</span>' : ''}
        ${isCamOn ? '<span class="stage-badge-icon">📷</span>' : ''}
        ${isScreenOn ? '<span class="stage-badge-icon">🖥️</span>' : ''}
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
    this.pingInterval = setInterval(updatePing, 1800);
  }

  private stopPingMonitor(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private attachEvents(): void {
    this.unbindEvents.forEach((u) => u());
    this.unbindEvents = [];

    const btnMic = document.getElementById('stage-btn-mic');
    const btnDeafen = document.getElementById('stage-btn-deafen');
    const btnCam = document.getElementById('stage-btn-camera');
    const btnScreen = document.getElementById('stage-btn-screen');
    const btnLeave = document.getElementById('stage-btn-leave');

    btnMic?.addEventListener('click', () => {
      const newMuted = !voiceStore.isMuted;
      voiceStore.setMuted(newMuted);
      audioProcessor.setMuted(newMuted);
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isMuted: newMuted });
      this.render();
    });

    btnDeafen?.addEventListener('click', () => {
      const newDeafened = !voiceStore.isDeafened;
      voiceStore.setDeafened(newDeafened);
      audioProcessor.setDeafened(newDeafened);
      webRtcManager.setDeafened(newDeafened);
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isDeafened: newDeafened, isMuted: voiceStore.isMuted });
      this.render();
    });

    btnCam?.addEventListener('click', async () => {
      if (voiceStore.isCameraOn) {
        videoService.stopCamera();
        await webRtcManager.setLocalCameraTrack(null);
        voiceStore.setCameraOn(false);
        networkClient.send(MessageType.VOICE_STATE_UPDATE, { isCameraOn: false });
      } else {
        try {
          if (voiceStore.isScreenSharing) {
            videoService.stopScreenShare();
            await webRtcManager.setLocalScreenTrack(null);
            voiceStore.setScreenSharing(false);
          }
          const stream = await videoService.startCamera();
          const track = stream.getVideoTracks()[0];
          await webRtcManager.setLocalCameraTrack(track);
          voiceStore.setCameraOn(true);
          networkClient.send(MessageType.VOICE_STATE_UPDATE, { isCameraOn: true, isScreenSharing: false });
        } catch (err: any) {
          alert(`Não foi possível acessar a câmera: ${err.message}`);
        }
      }
      this.render();
    });

    btnScreen?.addEventListener('click', async () => {
      if (voiceStore.isScreenSharing) {
        videoService.stopScreenShare();
        await webRtcManager.setLocalScreenTrack(null);
        voiceStore.setScreenSharing(false);
        networkClient.send(MessageType.VOICE_STATE_UPDATE, { isScreenSharing: false });
        this.render();
      } else {
        appEvents.emit('modal.open_screenshare_picker');
      }
    });

    btnLeave?.addEventListener('click', () => {
      if (this.currentChannelId) {
        this.stopPingMonitor();
        networkClient.send(MessageType.VOICE_LEAVE, { channelId: this.currentChannelId });
        audioProcessor.stopMicrophone();
        videoService.stopCamera();
        videoService.stopScreenShare();
        webRtcManager.closeAllPeers();
        voiceStore.reset();
        this.setChannel(null);
      }
    });

    const u1 = appEvents.on('participants.updated', () => {
      this.renderParticipants();
    });

    const u2 = appEvents.on('local.speaking', (speaking: boolean) => {
      voiceStore.setSpeaking(speaking);
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isSpeaking: speaking });
      const currentUserId = serverStore.currentUser?.id;
      if (currentUserId) {
        const card = document.getElementById(`card-${currentUserId}`);
        if (card) {
          if (speaking) card.classList.add('speaking');
          else card.classList.remove('speaking');
        }
      }
    });

    this.unbindEvents.push(u1, u2);
  }

  private escapeHtml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  public destroy(): void {
    this.stopPingMonitor();
    this.unbindEvents.forEach((u) => u());
    this.unbindEvents = [];
  }
}
