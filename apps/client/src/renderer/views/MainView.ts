import { MessageType } from '@mini-voice/shared';
import { appEvents } from '../core/EventBus';
import { networkClient } from '../core/NetworkClient';
import { participantManager } from '../core/ParticipantManager';
import { serverStore } from '../stores/serverStore';
import { voiceStore } from '../stores/voiceStore';
import { audioProcessor } from '../core/AudioProcessor';
import { webRtcManager } from '../core/WebRtcManager';
import { ChatView } from './ChatView';
import { VoiceStageView } from './VoiceStageView';
import { createChannelModal } from './CreateChannelModal';
import { settingsModal } from './SettingsModal';
import { inviteModal } from './InviteModal';
import { getAvatarUrl } from '../utils/avatar';

export class MainView {
  private container: HTMLElement;
  private chatView: ChatView | null = null;
  private voiceStageView: VoiceStageView | null = null;
  private unbindEvents: Array<() => void> = [];
  private activeContentView: 'chat' | 'stage' = 'chat';

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
        <!-- Left Sidebar: Channels & User Controls -->
        <div class="channels-sidebar">
          <div class="server-header">
            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 700;">${this.escapeHtml(s.name)}</span>
            <button id="btn-invite-friends" class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px; height: 26px;" title="Convidar Amigos (Copiar IP)">🔗 Convidar</button>
          </div>

          <div class="channels-list-container">
            <!-- Text Channels -->
            <div class="channel-category">
              <div class="category-title">
                <span>Canais de Texto</span>
                <button id="btn-add-text-channel" class="category-add-btn" title="Criar Canal de Texto">+</button>
              </div>
              <div id="text-channels-list"></div>
            </div>

            <!-- Voice Channels -->
            <div class="channel-category">
              <div class="category-title">
                <span>Canais de Voz</span>
                <button id="btn-add-voice-channel" class="category-add-btn" title="Criar Canal de Voz">+</button>
              </div>
              <div id="voice-channels-list"></div>
            </div>
          </div>

          <!-- Bottom User Bar -->
          <div class="user-control-bar">
            <div id="user-profile-btn" class="user-profile-summary" title="Configurações de Perfil">
              <div class="user-avatar-container">
                <img id="main-user-avatar" class="user-avatar-main ${voiceStore.isSpeaking ? 'speaking' : ''}" src="${getAvatarUrl(u.avatarUrl)}">
              </div>
              <div class="user-info-text">
                <span id="main-user-name" class="user-name-display">${this.escapeHtml(u.nickname)}</span>
                <span class="user-status-text">Online</span>
              </div>
            </div>

            <div class="user-quick-actions">
              <button id="bar-btn-mic" class="btn btn-icon ${voiceStore.isMuted ? 'danger-active' : ''}" style="width: 32px; height: 32px;" title="${voiceStore.isMuted ? 'Desmutar' : 'Mutar'}">
                ${voiceStore.isMuted ? '🔇' : '🎤'}
              </button>
              <button id="bar-btn-deafen" class="btn btn-icon ${voiceStore.isDeafened ? 'danger-active' : ''}" style="width: 32px; height: 32px;" title="${voiceStore.isDeafened ? 'Ouvir' : 'Ensurdecer'}">
                ${voiceStore.isDeafened ? '🔇' : '🎧'}
              </button>
              <button id="bar-btn-settings" class="btn btn-icon" style="width: 32px; height: 32px;" title="Configurações">
                ⚙️
              </button>
              <button id="bar-btn-disconnect" class="btn btn-icon" style="width: 32px; height: 32px; color: var(--danger);" title="Desconectar do Servidor">
                🚪
              </button>
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

    const centerStageEl = document.getElementById('main-center-stage')!;
    this.chatView = new ChatView(centerStageEl);
    this.voiceStageView = new VoiceStageView(centerStageEl);

    if (serverStore.activeTextChannelId) {
      this.chatView.setChannel(serverStore.activeTextChannelId);
    }

    this.attachEvents();
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
          <span class="channel-icon">#</span>
          <span class="channel-name">${this.escapeHtml(c.name)}</span>
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
              <span class="channel-icon">🔊</span>
              <span class="channel-name">${this.escapeHtml(c.name)}</span>
              ${isActive ? '<span style="font-size: 11px; color: var(--success); font-weight: 600;">(Você)</span>' : ''}
            </div>

            ${inVoice.length > 0 ? `
              <div class="voice-participants-sublist">
                ${inVoice.map((p) => {
                  const isLocal = p.user.id === serverStore.currentUser?.id;
                  const isSpeaking = isLocal ? voiceStore.isSpeaking : p.isSpeaking;
                  const avatar = getAvatarUrl(p.user.avatarUrl);

                  return `
                    <div class="voice-participant-mini ${isSpeaking ? 'speaking' : ''}">
                      <img class="voice-mini-avatar" src="${avatar}">
                      <span>${this.escapeHtml(p.user.nickname)}</span>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : ''}
          </div>
        `;
      }).join('');
    }

    // Attach click listeners to channel items
    this.container.querySelectorAll('.channel-item').forEach((item) => {
      item.addEventListener('click', async () => {
        const channelId = item.getAttribute('data-channel-id')!;
        const type = item.getAttribute('data-channel-type')!;

        if (type === 'TEXT') {
          serverStore.setActiveTextChannel(channelId);
          this.activeContentView = 'chat';
          this.chatView?.setChannel(channelId);
          this.renderChannels();
        } else if (type === 'VOICE') {
          await this.handleJoinVoiceChannel(channelId);
          this.activeContentView = 'stage';
          this.voiceStageView?.setChannel(channelId);
          this.renderChannels();
        }
      });
    });
  }

  private async handleJoinVoiceChannel(channelId: string): Promise<void> {
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

    // Send VOICE_JOIN to server
    networkClient.send(MessageType.VOICE_JOIN, { channelId });

    // Connect WebRTC Mesh to all existing members in this voice channel
    const inChannel = participantManager.getInVoiceChannel(channelId);
    for (const member of inChannel) {
      if (member.user.id !== serverStore.currentUser?.id) {
        webRtcManager.connectToPeer(member.user.id, true);
      }
    }
  }

  private renderMembers(): void {
    const listEl = document.getElementById('members-list-items');
    const countEl = document.getElementById('members-count-label');
    const members = participantManager.getAll();

    if (countEl) {
      countEl.innerText = `MEMBROS — ${members.length}`;
    }

    if (listEl) {
      listEl.innerHTML = members.map((p) => {
        const avatar = getAvatarUrl(p.user.avatarUrl);
        const isLocal = p.user.id === serverStore.currentUser?.id;
        const isSpeaking = isLocal ? voiceStore.isSpeaking : p.isSpeaking;

        return `
          <div class="member-item">
            <img class="member-avatar" style="${isSpeaking ? 'box-shadow: 0 0 0 2px var(--success);' : ''}" src="${avatar}">
            <div class="member-info">
              <div class="member-name">${this.escapeHtml(p.user.nickname)} ${isLocal ? '(Você)' : ''}</div>
              <div style="font-size: 11px; color: ${p.voiceState ? 'var(--success)' : 'var(--text-muted)'};">
                ${p.voiceState ? 'No canal de voz' : 'Online'}
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  private attachEvents(): void {
    this.unbindEvents.forEach((u) => u());
    this.unbindEvents = [];

    const btnAddText = document.getElementById('btn-add-text-channel');
    const btnAddVoice = document.getElementById('btn-add-voice-channel');
    const btnInvite = document.getElementById('btn-invite-friends');
    const btnProfile = document.getElementById('user-profile-btn');
    const btnSettings = document.getElementById('bar-btn-settings');
    const btnMic = document.getElementById('bar-btn-mic');
    const btnDeafen = document.getElementById('bar-btn-deafen');
    const btnDisconnect = document.getElementById('bar-btn-disconnect');

    btnAddText?.addEventListener('click', () => createChannelModal.open('TEXT'));
    btnAddVoice?.addEventListener('click', () => createChannelModal.open('VOICE'));
    btnInvite?.addEventListener('click', () => inviteModal.open());
    btnProfile?.addEventListener('click', () => settingsModal.open());
    btnSettings?.addEventListener('click', () => settingsModal.open());

    btnMic?.addEventListener('click', () => {
      const newMuted = !voiceStore.isMuted;
      voiceStore.setMuted(newMuted);
      audioProcessor.setMuted(newMuted);
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isMuted: newMuted });
      if (btnMic) {
        btnMic.className = `btn btn-icon ${newMuted ? 'danger-active' : ''}`;
        btnMic.innerHTML = newMuted ? '🔇' : '🎤';
      }
    });

    btnDeafen?.addEventListener('click', () => {
      const newDeafened = !voiceStore.isDeafened;
      voiceStore.setDeafened(newDeafened);
      audioProcessor.setDeafened(newDeafened);
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isDeafened: newDeafened, isMuted: voiceStore.isMuted });
      if (btnDeafen) {
        btnDeafen.className = `btn btn-icon ${newDeafened ? 'danger-active' : ''}`;
        btnDeafen.innerHTML = newDeafened ? '🔇' : '🎧';
      }
    });

    btnDisconnect?.addEventListener('click', () => {
      if (confirm('Deseja realmente desconectar do servidor?')) {
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
      if (avatarEl && user.avatarUrl) avatarEl.src = user.avatarUrl;
      if (nameEl) nameEl.innerText = user.nickname;
    });

    const u4 = appEvents.on('voice.state_updated', () => {
      const avatarEl = document.getElementById('main-user-avatar');
      if (avatarEl) {
        if (voiceStore.isSpeaking) avatarEl.classList.add('speaking');
        else avatarEl.classList.remove('speaking');
      }
    });

    this.unbindEvents.push(u1, u2, u3, u4);
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
    this.unbindEvents.forEach((u) => u());
    this.unbindEvents = [];
    this.chatView?.destroy();
    this.voiceStageView?.destroy();
  }
}
