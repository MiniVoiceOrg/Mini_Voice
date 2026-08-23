import { MessageType } from '@mini-voice/shared';
import { escapeHtml } from '../utils/html';
import { appEvents } from '../core/EventBus';
import { networkClient } from '../core/NetworkClient';
import { participantManager } from '../core/ParticipantManager';
import { serverStore } from '../stores/serverStore';
import { voiceStore } from '../stores/voiceStore';
import { settingsStore } from '../stores/settingsStore';
import { connectionStore, SavedServer } from '../stores/connectionStore';
import { audioProcessor } from '../core/AudioProcessor';
import { webRtcManager } from '../core/WebRtcManager';
import { ChatView } from './ChatView';
import { VoiceStageView } from './VoiceStageView';
import { createChannelModal } from './CreateChannelModal';
import { settingsModal } from './SettingsModal';
import { serverSettingsModal } from './ServerSettingsModal';
import { inviteModal } from './InviteModal';
import { showConfirm, showAlert } from './Dialog';
import { setButtonLoading, withButtonLoading } from '../utils/buttonLoading';
import { checkServerOnline } from '../utils/serverStatus';
import { userContextMenu } from './UserContextMenu';
import { soundboardModal } from './SoundboardModal';
import { soundEffects } from '../core/SoundEffects';
import { getAvatarUrl } from '../utils/avatar';
import logoUrl from '../assets/Logo.png';

export class MainView {
  private container: HTMLElement;
  private chatView: ChatView | null = null;
  private voiceStageView: VoiceStageView | null = null;
  private unbindEvents: Array<() => void> = [];
  private activeContentView: 'chat' | 'stage' = 'chat';
  private sidebarPingInterval: number | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public render(): void {
    if (!serverStore.serverDetails || !serverStore.currentUser) {
      return;
    }

    const s = serverStore.serverDetails;
    const u = serverStore.currentUser;

    this.container.innerHTML = `
      <div class="main-layout">
        <!-- Server Rail: saved servers + home (#29) -->
        <div class="server-rail" id="server-rail"></div>

        <!-- Left Sidebar: Channels & User Controls -->
        <div class="channels-sidebar">
          <div class="channels-resizer" id="channels-resizer" title="Arraste para redimensionar"></div>
          <div class="server-header">
            <button id="server-dropdown-toggle" class="server-dropdown-toggle" title="Opções do servidor">
              <img id="server-header-icon" src="${s.iconUrl ? getAvatarUrl(s.iconUrl) : logoUrl}" alt="Ícone do Servidor" style="width: 22px; height: 22px; object-fit: cover; border-radius: 4px; flex-shrink: 0;">
              <span id="server-name-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 700;">${escapeHtml(s.name)}</span>
              <span class="material-symbols-outlined md-18 server-dropdown-caret">expand_more</span>
            </button>
            <div id="server-dropdown-menu" class="server-dropdown-menu" style="display: none;">
              <button id="btn-server-settings" class="server-dropdown-item" title="Configurações do Servidor (Alterar/Remover Senha)">
                <span class="material-symbols-outlined md-18">settings</span>
                <span>Configurações do Servidor</span>
              </button>
              <button id="btn-invite-friends" class="server-dropdown-item" title="Convidar Amigos (Copiar IP)">
                <span class="material-symbols-outlined md-18">person_add</span>
                <span>Convidar Amigos</span>
              </button>
            </div>
          </div>

          <div class="channels-list-container">
            <!-- Text Channels -->
            <div class="channel-category">
              <div class="category-title">
                <span>Canais de Texto</span>
                <button id="btn-add-text-channel" class="category-add-btn" title="Criar Canal de Texto">
                  <span class="material-symbols-outlined md-14">add</span>
                </button>
              </div>
              <div id="text-channels-list"></div>
            </div>

            <!-- Voice Channels -->
            <div class="channel-category">
              <div class="category-title">
                <span>Canais de Voz</span>
                <button id="btn-add-voice-channel" class="category-add-btn" title="Criar Canal de Voz">
                  <span class="material-symbols-outlined md-14">add</span>
                </button>
              </div>
              <div id="voice-channels-list"></div>
            </div>
          </div>

          <!-- Bottom User Bar -->
          <div class="user-control-bar">
            <div id="voice-connection-row-slot"></div>
            <div class="user-media-bar" id="user-media-bar">
              <button id="media-btn-camera" class="btn btn-icon media-bar-btn-lg ${voiceStore.isCameraOn ? 'broadcasting-pulse active' : ''}" title="Ligar/Desligar Câmera">
                <span class="material-symbols-outlined md-18">${voiceStore.isCameraOn ? 'videocam_off' : 'videocam'}</span>
              </button>
              <button id="media-btn-screen" class="btn btn-icon media-bar-btn-lg ${voiceStore.isScreenSharing ? 'broadcasting-pulse active' : ''}" title="Compartilhar Tela">
                <span class="material-symbols-outlined md-18">${voiceStore.isScreenSharing ? 'stop_screen_share' : 'screen_share'}</span>
              </button>
              <button id="media-btn-soundboard" class="btn btn-icon media-bar-btn-lg" title="Abrir Soundboard">
                <span class="material-symbols-outlined md-18">music_note</span>
              </button>
            </div>
            <div class="user-control-main">
              <div id="user-profile-btn" class="user-profile-summary" title="Configurações de Perfil">
                <div class="user-avatar-container">
                  <img id="main-user-avatar" class="user-avatar-main ${voiceStore.isSpeaking ? 'speaking' : ''}" src="${getAvatarUrl(u.avatarUrl)}">
                </div>
                <div class="user-info-text">
                  <span id="main-user-name" class="user-name-display">${escapeHtml(u.nickname)}</span>
                  <span class="user-status-text">Online</span>
                </div>
              </div>

              <div class="user-quick-actions">
                <button id="bar-btn-mic" class="btn btn-icon ${voiceStore.isMuted ? 'danger-active' : ''}" title="${voiceStore.isMuted ? 'Desmutar' : 'Mutar'}">
                  <span class="material-symbols-outlined md-18">${voiceStore.isMuted ? 'mic_off' : 'mic'}</span>
                </button>
                <button id="bar-btn-deafen" class="btn btn-icon ${voiceStore.isDeafened ? 'danger-active' : ''}" title="${voiceStore.isDeafened ? 'Ouvir' : 'Ensurdecer'}">
                  <span class="material-symbols-outlined md-18">${voiceStore.isDeafened ? 'headset_off' : 'headphones'}</span>
                </button>
                <button id="bar-btn-settings" class="btn btn-icon" title="Configurações">
                  <span class="material-symbols-outlined md-18">tune</span>
                </button>
                <button id="bar-btn-disconnect" class="btn btn-icon" style="color: var(--danger);" title="Desconectar do Servidor">
                  <span class="material-symbols-outlined md-18">logout</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Center: Chat Feed or Voice Stage -->
        <div id="main-center-stage" class="main-content-area"></div>

        <!-- Right Sidebar: Connected Members -->
        <div class="members-sidebar">
          <div class="members-header">
            <span id="members-count-label">MEMBROS — 0</span>
          </div>
          <div id="members-list-items" class="members-list"></div>
        </div>
      </div>
    `;

    this.renderChannels();
    this.renderMembers();
    this.renderServerRail();
    this.setupChannelsResizer();

    const centerStageEl = document.getElementById('main-center-stage')!;
    this.chatView = new ChatView(centerStageEl);
    this.voiceStageView = new VoiceStageView(centerStageEl);

    if (serverStore.activeTextChannelId) {
      this.chatView.setChannel(serverStore.activeTextChannelId);
    }

    this.attachEvents();
    this.updateVoiceConnectionRow();
  }

  /**
   * Builds (or clears) the sidebar voice-connection row shown only while the
   * user is in a voice channel: channel name, ping and a leave button (#60).
   */
  private updateVoiceConnectionRow(): void {
    const slot = document.getElementById('voice-connection-row-slot');
    if (!slot) return;

    const vc = serverStore.serverDetails?.channels.find((c) => c.id === voiceStore.currentVoiceChannelId);
    if (!voiceStore.currentVoiceChannelId || !vc) {
      slot.innerHTML = '';
      this.stopSidebarPing();
      return;
    }

    slot.innerHTML = `
      <div class="voice-connection-row" id="voice-connection-row">
        <div class="voice-conn-info">
          <span class="material-symbols-outlined md-16 voice-conn-signal">graphic_eq</span>
          <div class="voice-conn-text">
            <span class="voice-conn-status">Voz conectada</span>
            <span class="voice-conn-channel" id="sidebar-voice-channel">${escapeHtml(vc.name)}</span>
          </div>
          <span class="voice-conn-ping" id="sidebar-voice-ping" title="Latência média">-- ms</span>
        </div>
        <div class="voice-conn-actions">
          <button id="sidebar-btn-rnnoise" class="btn btn-icon voice-conn-rnnoise ${settingsStore.noiseSuppressionEnabled ? 'rnnoise-active' : ''}" title="${settingsStore.noiseSuppressionEnabled ? 'Supressão de Ruído (RNNoise): Ativada (Clique para desativar)' : 'Supressão de Ruído (RNNoise): Desativada (Clique para ativar)'}">
            <span class="material-symbols-outlined md-18">graphic_eq</span>
          </button>
          <button id="sidebar-btn-leave-voice" class="btn btn-icon voice-conn-leave" title="Sair da chamada">
            <span class="material-symbols-outlined md-18">call_end</span>
          </button>
        </div>
      </div>
    `;

    const btnRnnoise = document.getElementById('sidebar-btn-rnnoise');
    btnRnnoise?.addEventListener('click', async () => {
      const enabled = !settingsStore.noiseSuppressionEnabled;
      settingsStore.noiseSuppressionEnabled = enabled;
      settingsStore.save();
      await audioProcessor.setNoiseSuppression(enabled);

      if (btnRnnoise) {
        btnRnnoise.className = `btn btn-icon voice-conn-rnnoise ${enabled ? 'rnnoise-active' : ''}`;
        btnRnnoise.setAttribute('title', enabled ? 'Supressão de Ruído (RNNoise): Ativada (Clique para desativar)' : 'Supressão de Ruído (RNNoise): Desativada (Clique para ativar)');
      }
    });

    document.getElementById('sidebar-btn-leave-voice')?.addEventListener('click', () => {
      this.voiceStageView?.leaveVoice();
    });

    this.startSidebarPing();
  }

  private startSidebarPing(): void {
    this.stopSidebarPing();
    const update = async () => {
      const pingEl = document.getElementById('sidebar-voice-ping');
      if (!pingEl) return;
      const participants = participantManager.getInVoiceChannel(voiceStore.currentVoiceChannelId || '');
      if (participants.length <= 1) {
        pingEl.textContent = '0 ms';
        return;
      }
      const avg = await webRtcManager.getAverageP2pPing();
      pingEl.textContent = avg !== null ? `${avg} ms` : '-- ms';
    };
    update();
    this.sidebarPingInterval = window.setInterval(update, 2000);
  }

  private stopSidebarPing(): void {
    if (this.sidebarPingInterval) {
      clearInterval(this.sidebarPingInterval);
      this.sidebarPingInterval = null;
    }
  }

  private closeServerDropdown(): void {
    const menu = document.getElementById('server-dropdown-menu');
    const toggle = document.getElementById('server-dropdown-toggle');
    if (menu) menu.style.display = 'none';
    toggle?.classList.remove('open');
  }

  private ensureInVoiceChannel(): boolean {
    if (!voiceStore.currentVoiceChannelId) {
      showAlert({
        title: 'Entre em um canal de voz',
        message: 'Para usar a câmera ou compartilhar a tela, entre primeiro em um canal de voz.',
        variant: 'warning',
      });
      return false;
    }
    return true;
  }

  private renderServerRail(): void {
    const railEl = document.getElementById('server-rail');
    if (!railEl) return;

    const currentUrl = networkClient.getCurrentServerUrl();
    const saved = connectionStore.savedServers || [];

    const serverButtons = saved.map((srv) => {
      const url = `ws://${srv.host.trim().replace(/^wss?:\/\//, '')}:${srv.port}`;
      const isCurrent = url === currentUrl;
      const initial = (srv.name || srv.host || '?').trim().charAt(0).toUpperCase();
      const iconUrl = isCurrent && serverStore.serverDetails?.iconUrl ? serverStore.serverDetails.iconUrl : (srv as any).iconUrl;
      return `
        <button class="server-rail-avatar ${isCurrent ? 'active' : ''}" data-host="${escapeHtml(srv.host)}" data-port="${srv.port}" title="${escapeHtml(srv.name || `${srv.host}:${srv.port}`)}" style="overflow: hidden; padding: 0;">
          ${iconUrl ? `<img src="${getAvatarUrl(iconUrl)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: inherit;">` : `<span>${escapeHtml(initial)}</span>`}
          <span class="server-rail-status-dot" data-status="${isCurrent ? 'online' : 'checking'}"></span>
        </button>
      `;
    }).join('');

    railEl.innerHTML = `
      <button class="server-rail-home" id="server-rail-home" title="Início (voltar à tela de conexão)">
        <span class="material-symbols-outlined md-22">home</span>
      </button>
      <div class="server-rail-divider"></div>
      <div class="server-rail-list">
        ${serverButtons}
      </div>
    `;

    railEl.querySelector('#server-rail-home')?.addEventListener('click', async () => {
      const confirmed = await showConfirm({
        title: 'Voltar ao início',
        message: 'Você será desconectado deste servidor e voltará à tela inicial. Deseja continuar?',
        confirmLabel: 'Voltar ao início',
        variant: 'warning',
      });
      if (!confirmed) return;
      soundEffects.play('leave_voice');
      audioProcessor.stopMicrophone();
      webRtcManager.closeAllPeers();
      networkClient.disconnect();
    });

    railEl.querySelectorAll('.server-rail-avatar').forEach((btn) => {
      btn.addEventListener('click', () => {
        const host = btn.getAttribute('data-host');
        const port = parseInt(btn.getAttribute('data-port') || '0', 10);
        if (!host || !port) return;
        const target = saved.find((s) => s.host === host && s.port === port);
        if (target) this.connectToSavedServer(target);
      });
    });

    void this.refreshServerRailStatuses();
  }

  /**
   * Checks each saved server (except the one we're already connected to) and
   * updates its online/offline dot in the sidebar rail (#37).
   */
  private async refreshServerRailStatuses(): Promise<void> {
    const railEl = document.getElementById('server-rail');
    if (!railEl) return;
    const dots = Array.from(
      railEl.querySelectorAll('.server-rail-avatar')
    ) as HTMLElement[];

    await Promise.all(
      dots.map(async (btn) => {
        const dot = btn.querySelector('.server-rail-status-dot') as HTMLElement | null;
        if (!dot || dot.getAttribute('data-status') === 'online') return;
        const host = btn.getAttribute('data-host');
        const port = parseInt(btn.getAttribute('data-port') || '0', 10);
        if (!host || !port) return;
        const online = await checkServerOnline(host, port);
        dot.setAttribute('data-status', online ? 'online' : 'offline');
        const baseTitle = btn.getAttribute('title')?.split(' • ')[0] || '';
        btn.title = `${baseTitle} • ${online ? 'Online' : 'Offline'}`;
      })
    );
  }

  private async connectToSavedServer(server: SavedServer): Promise<void> {
    const targetUrl = `ws://${server.host.trim().replace(/^wss?:\/\//, '')}:${server.port}`;
    // Already viewing this server – nothing to do.
    if (targetUrl === networkClient.getCurrentServerUrl()) return;

    const confirmed = await showConfirm({
      title: 'Trocar de servidor',
      message: `Deseja se conectar a "${server.name || server.host}"? Você sairá do servidor atual.`,
      confirmLabel: 'Conectar',
      variant: 'warning',
    });
    if (!confirmed) return;

    // Leave the current server first, then connect to the selected one.
    audioProcessor.stopMicrophone();
    webRtcManager.closeAllPeers();
    networkClient.disconnect();

    try {
      let clientId = connectionStore.clientId;
      if (!clientId && window.api?.getClientId) {
        clientId = await window.api.getClientId();
        connectionStore.clientId = clientId;
      }
      const nickname = connectionStore.savedNickname || 'Usuário';
      const res = await networkClient.connect(server.host, server.port, clientId, nickname, server.password);
      connectionStore.addSavedServer({
        host: server.host,
        port: server.port,
        name: res.server.name,
        password: server.password,
        lastConnected: Date.now(),
      });
    } catch (err: any) {
      // Connection failed – bounce back to the connection screen with an error.
      appEvents.emit('network.disconnected');
    }
  }

  private setupChannelsResizer(): void {
    const resizer = document.getElementById('channels-resizer');
    const sidebar = this.container.querySelector('.channels-sidebar') as HTMLElement | null;
    if (!resizer || !sidebar) return;

    // Restore a previously persisted width.
    try {
      const saved = localStorage.getItem('mini_voice_channels_width');
      if (saved) {
        const w = parseInt(saved, 10);
        if (!isNaN(w)) sidebar.style.width = `${this.clampSidebarWidth(w)}px`;
      }
    } catch (e) {}

    let startX = 0;
    let startWidth = 0;

    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newWidth = this.clampSidebarWidth(startWidth + delta);
      sidebar.style.width = `${newWidth}px`;
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        localStorage.setItem('mini_voice_channels_width', String(parseInt(sidebar.style.width, 10)));
      } catch (e) {}
    };

    resizer.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = sidebar.getBoundingClientRect().width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  private clampSidebarWidth(width: number): number {
    const min = 280;
    const max = Math.max(min, Math.floor(window.innerWidth * 0.35));
    return Math.min(max, Math.max(min, width));
  }

  private renderChannels(): void {
    if (!serverStore.serverDetails) return;

    const textListEl = document.getElementById('text-channels-list');
    const voiceListEl = document.getElementById('voice-channels-list');

    const textChannels = serverStore.serverDetails.channels.filter((c) => c.type === 'TEXT');
    const voiceChannels = serverStore.serverDetails.channels.filter((c) => c.type === 'VOICE');

    if (textListEl) {
      textListEl.innerHTML = textChannels.map((c) => `
        <div class="channel-item ${c.id === serverStore.activeTextChannelId && this.activeContentView === 'chat' ? 'active' : ''}" data-channel-id="${c.id}" data-channel-type="TEXT">
          <span class="material-symbols-outlined md-16 channel-icon" style="color: var(--text-muted);">tag</span>
          <span class="channel-name">${escapeHtml(c.name)}</span>
          <button class="channel-delete-btn" data-del-channel="${c.id}" title="Apagar canal">
            <span class="material-symbols-outlined md-14">delete</span>
          </button>
        </div>
      `).join('');
    }

    if (voiceListEl) {
      voiceListEl.innerHTML = voiceChannels.map((c) => {
        const inVoice = participantManager.getInVoiceChannel(c.id);
        const isActive = c.id === voiceStore.currentVoiceChannelId;

        return `
          <div style="display: flex; flex-direction: column;">
            <div class="channel-item ${isActive ? 'active' : ''}" data-channel-id="${c.id}" data-channel-type="VOICE">
              <span class="material-symbols-outlined md-16 channel-icon" style="color: ${isActive ? 'var(--success)' : 'var(--text-muted)'};">volume_up</span>
              <span class="channel-name">${escapeHtml(c.name)}</span>
              ${isActive ? '<span style="font-size: 11px; color: var(--success); font-weight: 600; margin-left: auto;">(Você)</span>' : ''}
              <button class="channel-delete-btn" data-del-channel="${c.id}" title="Apagar canal">
                <span class="material-symbols-outlined md-14">delete</span>
              </button>
            </div>

            ${inVoice.length > 0 ? `
              <div class="voice-participants-sublist">
                ${inVoice.map((p) => {
                  const isLocal = p.user.id === serverStore.currentUser?.id;
                  const isSpeaking = isLocal ? voiceStore.isSpeaking : p.isSpeaking;
                  const isMicMuted = isLocal ? voiceStore.isMuted : (p.voiceState?.isMuted ?? false);
                  const isAudioMuted = isLocal ? voiceStore.isDeafened : (p.voiceState?.isDeafened ?? false);
                  const avatar = getAvatarUrl(p.user.avatarUrl);

                  return `
                    <div id="voice-mini-user-${p.user.id}" class="voice-participant-mini ${isSpeaking ? 'speaking' : ''}" data-user-id="${p.user.id}" title="${escapeHtml(p.user.nickname)} (Clique c/ botão direito p/ ajustar volume)">
                      <img class="voice-mini-avatar" src="${avatar}">
                      <span class="voice-mini-name">${escapeHtml(p.user.nickname)}</span>
                      ${isMicMuted ? '<span class="material-symbols-outlined md-14 voice-mini-icon muted" title="Microfone mutado">mic_off</span>' : ''}
                      ${isAudioMuted ? '<span class="material-symbols-outlined md-14 voice-mini-icon muted" title="Áudio mutado">headset_off</span>' : ''}
                      ${p.voiceState?.isScreenSharing ? '<span class="material-symbols-outlined md-14 voice-mini-icon live" title="Compartilhando tela">screen_share</span>' : ''}
                      ${p.voiceState?.isCameraOn ? '<span class="material-symbols-outlined md-14 voice-mini-icon" title="Câmera ligada">videocam</span>' : ''}
                    </div>
                  `;
                }).join('')}
              </div>
            ` : ''}
          </div>
        `;
      }).join('');
    }

    // Attach right-click context menu listeners to voice mini participant items
    this.container.querySelectorAll('.voice-participant-mini').forEach((miniEl) => {
      miniEl.addEventListener('contextmenu', (e: Event) => {
        const mouseEvent = e as MouseEvent;
        mouseEvent.preventDefault();
        const userId = miniEl.getAttribute('data-user-id');
        if (!userId) return;
        const participant = participantManager.get(userId);
        if (participant?.user) {
          userContextMenu.open(mouseEvent.clientX, mouseEvent.clientY, participant.user);
        }
      });
    });

    // Attach click listeners to channel items
    this.container.querySelectorAll('.channel-item').forEach((item) => {
      item.addEventListener('click', async (e) => {
        if ((e.target as HTMLElement).closest('.channel-delete-btn')) return;
        const channelId = item.getAttribute('data-channel-id')!;
        const type = item.getAttribute('data-channel-type')!;

        if (type === 'TEXT') {
          serverStore.setActiveTextChannel(channelId);
          this.activeContentView = 'chat';
          this.chatView?.setChannel(channelId);
          this.renderChannels();
        } else if (type === 'VOICE') {
          // Show a loading spinner on the channel while the voice join happens (#48).
          const iconEl = item.querySelector('.channel-icon');
          if (iconEl) {
            iconEl.textContent = 'progress_activity';
            iconEl.classList.add('channel-loading');
          }
          item.classList.add('joining');
          try {
            await this.handleJoinVoiceChannel(channelId);
            this.activeContentView = 'stage';
            this.voiceStageView?.setChannel(channelId);
          } finally {
            this.renderChannels();
          }
        }
      });
    });

    // Attach delete listeners
    this.container.querySelectorAll('.channel-delete-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const channelId = btn.getAttribute('data-del-channel');
        if (!channelId) return;
        await this.handleDeleteChannel(channelId);
      });
    });
  }

  private async handleJoinVoiceChannel(channelId: string, silent: boolean = false): Promise<void> {
    if (voiceStore.currentVoiceChannelId === channelId) {
      // Already in this channel, just switch view to stage
      this.activeContentView = 'stage';
      this.voiceStageView?.setChannel(channelId);
      return;
    }

    // If in another channel, leave it first
    if (voiceStore.currentVoiceChannelId) {
      networkClient.send(MessageType.VOICE_LEAVE, { channelId: voiceStore.currentVoiceChannelId });
      webRtcManager.closeAllPeers();
    }

    // Start local mic
    try {
      const stream = await audioProcessor.startMicrophone();
      const audioTrack = stream.getAudioTracks()[0];
      webRtcManager.setLocalAudioTrack(audioTrack);
    } catch (err) {
      console.warn('Microphone permission or hardware error:', err);
    }

    voiceStore.setChannel(channelId);
    if (!silent) soundEffects.play('join_voice');
    networkClient.send(MessageType.VOICE_JOIN, { channelId });

    // Connect to all peers already in this voice channel
    const peersInChannel = participantManager.getInVoiceChannel(channelId);
    for (const peer of peersInChannel) {
      if (peer.user.id !== serverStore.currentUser?.id) {
        await webRtcManager.connectToPeer(peer.user.id, true);
      }
    }
  }

  public async rejoinVoiceChannel(channelId: string): Promise<void> {
    // Reset the stored voice channel so handleJoinVoiceChannel performs a full
    // (re)join instead of early-returning, then reconnect the mesh.
    voiceStore.setChannel(null);
    this.activeContentView = 'stage';
    await this.handleJoinVoiceChannel(channelId, true);
    this.voiceStageView?.setChannel(channelId);
    this.renderChannels();
  }

  private async handleDeleteChannel(channelId: string): Promise<void> {
    if (!serverStore.serverDetails) return;
    const channel = serverStore.serverDetails.channels.find((c) => c.id === channelId);
    if (!channel) return;

    const isText = channel.type === 'TEXT';
    const confirmed = await showConfirm({
      title: isText ? 'Apagar canal de texto' : 'Apagar canal de voz',
      message: isText
        ? `Deseja apagar o canal "${channel.name}"? Todo o histórico de mensagens será removido permanentemente.`
        : `Deseja apagar o canal de voz "${channel.name}"? Todos que estiverem nele serão desconectados.`,
      confirmLabel: 'Apagar',
      variant: 'danger',
    });
    if (!confirmed) return;

    // If we are currently in this voice channel, leave it first locally.
    if (channel.type === 'VOICE' && voiceStore.currentVoiceChannelId === channelId) {
      networkClient.send(MessageType.VOICE_LEAVE, { channelId });
      webRtcManager.closeAllPeers();
      audioProcessor.stopMicrophone();
      voiceStore.reset();
      this.voiceStageView?.setChannel(null);
      this.activeContentView = 'chat';
    }

    networkClient.send(MessageType.CHANNEL_DELETE, { channelId });
  }

  private renderMembers(): void {
    if (!serverStore.serverDetails) return;

    const listEl = document.getElementById('members-list-items');
    const countEl = document.getElementById('members-count-label');

    const members = serverStore.serverDetails.members;

    if (countEl) {
      countEl.innerText = `MEMBROS — ${members.length}`;
    }

    if (listEl) {
      listEl.innerHTML = members.map((m) => {
        const isLocal = m.id === serverStore.currentUser?.id;
        const vm = participantManager.get(m.id);
        const voiceState = vm?.voiceState;
        const inVoice = !!voiceState;
        const isReconnecting = !!vm?.isReconnecting;
        const avatar = getAvatarUrl(m.avatarUrl);

        return `
          <div class="member-item ${isReconnecting ? 'reconnecting' : ''}" data-user-id="${m.id}" title="${escapeHtml(m.nickname)} ${isLocal ? '(Você)' : '(Botão direito para ajustar volume)'}">
            <div class="member-avatar-wrapper">
              <img class="member-avatar-img" src="${avatar}">
              <span class="status-indicator ${isReconnecting ? 'reconnecting' : (inVoice ? 'voice' : 'online')}"></span>
            </div>
            <div class="member-info">
              <div class="member-name-row">
                <span class="member-name">${escapeHtml(m.nickname)}</span>
                ${isLocal ? '<span class="member-badge-you">Você</span>' : ''}
                ${isReconnecting ? '<span class="member-reconnecting-badge" title="Perdeu a conexão, tentando reconectar"><span class="material-symbols-outlined md-14 spin">sync</span></span>' : ''}
                ${voiceState?.isScreenSharing ? '<span class="member-live-badge" title="Compartilhando tela">LIVE</span>' : ''}
                ${voiceState?.isCameraOn ? '<span class="material-symbols-outlined md-14 member-cam-icon" title="Câmera ligada">videocam</span>' : ''}
              </div>
              <span class="member-subtext">${isReconnecting ? 'Reconectando…' : (inVoice ? 'No canal de voz' : 'Online')}</span>
            </div>
          </div>
        `;
      }).join('');

      // Attach contextmenu listeners to member items
      listEl.querySelectorAll('.member-item').forEach((item) => {
        item.addEventListener('contextmenu', (e: Event) => {
          const mouseEvent = e as MouseEvent;
          mouseEvent.preventDefault();
          const userId = item.getAttribute('data-user-id');
          if (!userId) return;
          const member = serverStore.serverDetails?.members.find((u) => u.id === userId);
          if (member) {
            userContextMenu.open(mouseEvent.clientX, mouseEvent.clientY, member);
          }
        });
      });
    }
  }

  private attachEvents(): void {
    this.unbindEvents.forEach((u) => u());
    this.unbindEvents = [];

    const btnAddText = document.getElementById('btn-add-text-channel');
    const btnAddVoice = document.getElementById('btn-add-voice-channel');
    const btnInvite = document.getElementById('btn-invite-friends');
    const btnServerSettings = document.getElementById('btn-server-settings');
    const btnProfile = document.getElementById('user-profile-btn');
    const btnSettings = document.getElementById('bar-btn-settings');
    const btnMic = document.getElementById('bar-btn-mic');
    const btnDeafen = document.getElementById('bar-btn-deafen');
    const btnDisconnect = document.getElementById('bar-btn-disconnect');

    btnAddText?.addEventListener('click', (e) => withButtonLoading(e.currentTarget as HTMLElement, () => createChannelModal.open('TEXT')));
    btnAddVoice?.addEventListener('click', (e) => withButtonLoading(e.currentTarget as HTMLElement, () => createChannelModal.open('VOICE')));
    btnInvite?.addEventListener('click', (e) => { this.closeServerDropdown(); withButtonLoading(e.currentTarget as HTMLElement, () => inviteModal.open()); });
    btnServerSettings?.addEventListener('click', (e) => { this.closeServerDropdown(); withButtonLoading(e.currentTarget as HTMLElement, () => serverSettingsModal.open()); });
    btnProfile?.addEventListener('click', (e) => withButtonLoading(e.currentTarget as HTMLElement, () => settingsModal.open()));
    btnSettings?.addEventListener('click', (e) => withButtonLoading(e.currentTarget as HTMLElement, () => settingsModal.open()));

    const dropdownToggle = document.getElementById('server-dropdown-toggle');
    dropdownToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = document.getElementById('server-dropdown-menu');
      if (!menu) return;
      const isOpen = menu.style.display !== 'none';
      menu.style.display = isOpen ? 'none' : 'flex';
      dropdownToggle.classList.toggle('open', !isOpen);
    });
    const outsideClickHandler = (e: MouseEvent) => {
      const menu = document.getElementById('server-dropdown-menu');
      const toggle = document.getElementById('server-dropdown-toggle');
      if (!menu || menu.style.display === 'none') return;
      if (!menu.contains(e.target as Node) && !toggle?.contains(e.target as Node)) {
        this.closeServerDropdown();
      }
    };
    document.addEventListener('click', outsideClickHandler);
    this.unbindEvents.push(() => document.removeEventListener('click', outsideClickHandler));

    const mediaCam = document.getElementById('media-btn-camera');
    const mediaScreen = document.getElementById('media-btn-screen');
    mediaCam?.addEventListener('click', async () => {
      if (!this.ensureInVoiceChannel()) return;
      if ((mediaCam as HTMLButtonElement).dataset.loading === '1') return;
      setButtonLoading(mediaCam, true);
      try {
        await this.voiceStageView?.toggleCamera();
      } finally {
        setButtonLoading(mediaCam, false);
      }
    });
    mediaScreen?.addEventListener('click', () => {
      if (!this.ensureInVoiceChannel()) return;
      if ((mediaScreen as HTMLButtonElement).dataset.loading === '1') return;
      // Show loading until the picker modal is actually open (#48).
      setButtonLoading(mediaScreen, true);
      window.setTimeout(() => setButtonLoading(mediaScreen, false), 10000);
      appEvents.emit('modal.open_screenshare_picker');
    });
    const clearScreenLoading = () => setButtonLoading(mediaScreen, false);
    const usL1 = appEvents.on('modal.screenshare_picker_opened', clearScreenLoading);
    const usL2 = appEvents.on('modal.screenshare_picker_closed', clearScreenLoading);
    this.unbindEvents.push(usL1, usL2);

    const mediaSoundboard = document.getElementById('media-btn-soundboard');
    mediaSoundboard?.addEventListener('click', () => {
      soundboardModal.open();
    });

    btnMic?.addEventListener('click', () => {
      const newMuted = !voiceStore.isMuted;
      voiceStore.setMuted(newMuted);
      audioProcessor.setMuted(newMuted);
      soundEffects.play(newMuted ? 'mic_mute' : 'mic_unmute');
      // Unmuting the mic while deafened also undeafens the audio output (#62).
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
      if (btnMic) {
        btnMic.className = `btn btn-icon ${newMuted ? 'danger-active' : ''}`;
        btnMic.innerHTML = `<span class="material-symbols-outlined md-18">${newMuted ? 'mic_off' : 'mic'}</span>`;
      }
      if (undeafened && btnDeafen) {
        btnDeafen.className = 'btn btn-icon';
        btnDeafen.innerHTML = `<span class="material-symbols-outlined md-18">headphones</span>`;
      }
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
      if (btnDeafen) {
        btnDeafen.className = `btn btn-icon ${newDeafened ? 'danger-active' : ''}`;
        btnDeafen.innerHTML = `<span class="material-symbols-outlined md-18">${newDeafened ? 'headset_off' : 'headphones'}</span>`;
      }
    });

    btnDisconnect?.addEventListener('click', async () => {
      const confirmed = await showConfirm({
        title: 'Desconectar',
        message: 'Deseja realmente desconectar do servidor?',
        confirmLabel: 'Desconectar',
        variant: 'danger',
      });
      if (confirmed) {
        soundEffects.play('leave_voice');
        audioProcessor.stopMicrophone();
        webRtcManager.closeAllPeers();
        networkClient.disconnect();
      }
    });

    const u1 = appEvents.on('server.updated', () => {
      this.renderChannels();
      this.renderMembers();
    });

    const u2 = appEvents.on('participants.updated', () => {
      this.renderChannels();
      this.renderMembers();
    });

    const u3 = appEvents.on('user.updated', (user) => {
      const avatarEl = document.getElementById('main-user-avatar') as HTMLImageElement;
      const nameEl = document.getElementById('main-user-name');
      if (avatarEl) avatarEl.src = getAvatarUrl(user.avatarUrl);
      if (nameEl) nameEl.innerText = user.nickname;
    });

    let lastLocalMuted = voiceStore.isMuted;
    let lastLocalDeafened = voiceStore.isDeafened;
    let lastVoiceChannelId = voiceStore.currentVoiceChannelId;
    const u4 = appEvents.on('voice.state_updated', () => {
      const avatarEl = document.getElementById('main-user-avatar');
      if (avatarEl) {
        if (voiceStore.isSpeaking) avatarEl.classList.add('speaking');
        else avatarEl.classList.remove('speaking');
      }

      const btnMicEl = document.getElementById('bar-btn-mic');
      if (btnMicEl) {
        btnMicEl.className = `btn btn-icon ${voiceStore.isMuted ? 'danger-active' : ''}`;
        btnMicEl.title = voiceStore.isMuted ? 'Desmutar' : 'Mutar';
        btnMicEl.innerHTML = `<span class="material-symbols-outlined md-18">${voiceStore.isMuted ? 'mic_off' : 'mic'}</span>`;
      }

      const btnDeafenEl = document.getElementById('bar-btn-deafen');
      if (btnDeafenEl) {
        btnDeafenEl.className = `btn btn-icon ${voiceStore.isDeafened ? 'danger-active' : ''}`;
        btnDeafenEl.title = voiceStore.isDeafened ? 'Ouvir' : 'Ensurdecer';
        btnDeafenEl.innerHTML = `<span class="material-symbols-outlined md-18">${voiceStore.isDeafened ? 'headset_off' : 'headphones'}</span>`;
      }

      const mediaCamEl = document.getElementById('media-btn-camera');
      if (mediaCamEl) {
        mediaCamEl.className = `btn btn-icon media-bar-btn-lg ${voiceStore.isCameraOn ? 'broadcasting-pulse active' : ''}`;
        mediaCamEl.innerHTML = `<span class="material-symbols-outlined md-18">${voiceStore.isCameraOn ? 'videocam_off' : 'videocam'}</span>`;
      }
      const mediaScreenEl = document.getElementById('media-btn-screen');
      if (mediaScreenEl) {
        mediaScreenEl.className = `btn btn-icon media-bar-btn-lg ${voiceStore.isScreenSharing ? 'broadcasting-pulse active' : ''}`;
        mediaScreenEl.innerHTML = `<span class="material-symbols-outlined md-18">${voiceStore.isScreenSharing ? 'stop_screen_share' : 'screen_share'}</span>`;
      }

      // Keep the local user's mute/deafen icons in the channel sidebar in sync,
      // but only re-render when those actually change (not on every VAD/speaking
      // update, which also emits this event) (#58).
      if (voiceStore.isMuted !== lastLocalMuted || voiceStore.isDeafened !== lastLocalDeafened) {
        lastLocalMuted = voiceStore.isMuted;
        lastLocalDeafened = voiceStore.isDeafened;
        this.renderChannels();
      }

      // Show/hide the sidebar voice-connection row when joining/leaving a call (#60).
      if (voiceStore.currentVoiceChannelId !== lastVoiceChannelId) {
        lastVoiceChannelId = voiceStore.currentVoiceChannelId;
        this.updateVoiceConnectionRow();
      }
    });

    const u5 = appEvents.on('voice.speaking_changed', (speaking: boolean) => {
      const avatarEl = document.getElementById('main-user-avatar');
      if (avatarEl) {
        if (speaking) avatarEl.classList.add('speaking');
        else avatarEl.classList.remove('speaking');
      }
      if (serverStore.currentUser) {
        const miniEl = document.getElementById(`voice-mini-user-${serverStore.currentUser.id}`);
        if (miniEl) {
          if (speaking) miniEl.classList.add('speaking');
          else miniEl.classList.remove('speaking');
        }
      }
    });

    const u6 = appEvents.on('participants.speaking_changed', (data: { userId: string; speaking: boolean }) => {
      const miniEl = document.getElementById(`voice-mini-user-${data.userId}`);
      if (miniEl) {
        if (data.speaking) miniEl.classList.add('speaking');
        else miniEl.classList.remove('speaking');
      }
    });

    const u7 = appEvents.on(`message.${MessageType.SERVER_SETTINGS_UPDATED}`, (payload: any) => {
      serverStore.updateServerMeta(payload.name, payload.hasPassword, payload.allowSoundboard, payload.iconUrl);
      const titleEl = document.getElementById('server-name-title');
      if (titleEl) titleEl.innerText = payload.name;
      const iconEl = document.getElementById('server-header-icon') as HTMLImageElement;
      if (iconEl) iconEl.src = payload.iconUrl ? getAvatarUrl(payload.iconUrl) : logoUrl;
      this.renderServerRail();
    });

    const u8 = appEvents.on(`message.${MessageType.CHANNEL_DELETED}`, () => {
      // If the text channel currently shown was removed, fall back to the
      // remaining active channel so the chat view is never left orphaned.
      if (
        this.activeContentView === 'chat' &&
        serverStore.activeTextChannelId &&
        this.chatView
      ) {
        this.chatView.setChannel(serverStore.activeTextChannelId);
      }
    });

    // Joining/leaving a voice channel emits `voice.channel_changed` (not
    // `voice.state_updated`), so update the sidebar voice-connection row and the
    // channel list highlight here — otherwise the row only appeared by luck when
    // a later state update happened to fire (#60).
    const u9 = appEvents.on('voice.channel_changed', () => {
      lastVoiceChannelId = voiceStore.currentVoiceChannelId;
      this.updateVoiceConnectionRow();
      this.renderChannels();
    });

    const u10 = appEvents.on('settings.updated', () => {
      const btnRnnoise = document.getElementById('sidebar-btn-rnnoise');
      if (btnRnnoise) {
        const enabled = settingsStore.noiseSuppressionEnabled;
        btnRnnoise.className = `btn btn-icon voice-conn-rnnoise ${enabled ? 'rnnoise-active' : ''}`;
        btnRnnoise.setAttribute('title', enabled ? 'Supressão de Ruído (RNNoise): Ativada (Clique para desativar)' : 'Supressão de Ruído (RNNoise): Desativada (Clique para ativar)');
      }
    });

    const u11 = appEvents.on('server.members_updated', () => {
      this.renderMembers();
    });

    this.unbindEvents.push(u1, u2, u3, u4, u5, u6, u7, u8, u9, u10, u11);
  }

  public destroy(): void {
    this.stopSidebarPing();
    this.unbindEvents.forEach((u) => u());
    this.unbindEvents = [];
    this.chatView?.destroy();
    this.voiceStageView?.destroy();
  }
}
