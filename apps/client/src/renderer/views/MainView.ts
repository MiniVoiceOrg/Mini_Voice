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
import { serverSettingsModal } from './ServerSettingsModal';
import { inviteModal } from './InviteModal';
import { soundEffects } from '../core/SoundEffects';
import { getAvatarUrl } from '../utils/avatar';
import logoUrl from '../assets/Logo.png';

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
            <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; flex: 1;">
              <img src="${logoUrl}" alt="Mini Voice" style="width: 22px; height: 22px; object-fit: contain; border-radius: 4px; flex-shrink: 0;">
              <span id="server-name-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 700;">${this.escapeHtml(s.name)}</span>
            </div>
            <div style="display: flex; gap: 6px; align-items: center;">
              <button id="btn-server-settings" class="btn btn-secondary" style="padding: 3px 7px; font-size: 11px; height: 26px;" title="Configurações do Servidor (Alterar/Remover Senha)">
                <span class="material-symbols-outlined md-16">settings</span>
              </button>
              <button id="btn-invite-friends" class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px; height: 26px;" title="Convidar Amigos (Copiar IP)">
                <span class="material-symbols-outlined md-16" style="margin-right: 4px;">person_add</span>
                Convidar
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
                <span class="material-symbols-outlined md-18">${voiceStore.isMuted ? 'mic_off' : 'mic'}</span>
              </button>
              <button id="bar-btn-deafen" class="btn btn-icon ${voiceStore.isDeafened ? 'danger-active' : ''}" style="width: 32px; height: 32px;" title="${voiceStore.isDeafened ? 'Ouvir' : 'Ensurdecer'}">
                <span class="material-symbols-outlined md-18">${voiceStore.isDeafened ? 'headset_off' : 'headphones'}</span>
              </button>
              <button id="bar-btn-settings" class="btn btn-icon" style="width: 32px; height: 32px;" title="Configurações">
                <span class="material-symbols-outlined md-18">tune</span>
              </button>
              <button id="bar-btn-disconnect" class="btn btn-icon" style="width: 32px; height: 32px; color: var(--danger);" title="Desconectar do Servidor">
                <span class="material-symbols-outlined md-18">logout</span>
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
          <span class="material-symbols-outlined md-16 channel-icon" style="color: var(--text-muted);">tag</span>
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
              <span class="material-symbols-outlined md-16 channel-icon" style="color: ${isActive ? 'var(--success)' : 'var(--text-muted)'};">volume_up</span>
              <span class="channel-name">${this.escapeHtml(c.name)}</span>
              ${isActive ? '<span style="font-size: 11px; color: var(--success); font-weight: 600; margin-left: auto;">(Você)</span>' : ''}
            </div>

            ${inVoice.length > 0 ? `
              <div class="voice-participants-sublist">
                ${inVoice.map((p) => {
                  const isLocal = p.user.id === serverStore.currentUser?.id;
                  const isSpeaking = isLocal ? voiceStore.isSpeaking : p.isSpeaking;
                  const avatar = getAvatarUrl(p.user.avatarUrl);

                  return `
                    <div id="voice-mini-user-${p.user.id}" class="voice-participant-mini ${isSpeaking ? 'speaking' : ''}">
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
    soundEffects.play('join_voice');
    networkClient.send(MessageType.VOICE_JOIN, { channelId });

    // Connect to all peers already in this voice channel
    const peersInChannel = participantManager.getInVoiceChannel(channelId);
    for (const peer of peersInChannel) {
      if (peer.user.id !== serverStore.currentUser?.id) {
        await webRtcManager.connectToPeer(peer.user.id, true);
      }
    }
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
        const voiceState = serverStore.serverDetails?.voiceStates[m.id];
        const inVoice = !!voiceState;
        const avatar = getAvatarUrl(m.avatarUrl);

        return `
          <div class="member-item" title="${this.escapeHtml(m.nickname)} ${isLocal ? '(Você)' : ''}">
            <div class="member-avatar-wrapper">
              <img class="member-avatar-img" src="${avatar}">
              <span class="status-indicator ${inVoice ? 'voice' : 'online'}"></span>
            </div>
            <div class="member-info">
              <div class="member-name-row">
                <span class="member-name">${this.escapeHtml(m.nickname)}</span>
                ${isLocal ? '<span class="member-badge-you">Você</span>' : ''}
              </div>
              <span class="member-subtext">${inVoice ? 'No canal de voz' : 'Online'}</span>
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
    const btnServerSettings = document.getElementById('btn-server-settings');
    const btnProfile = document.getElementById('user-profile-btn');
    const btnSettings = document.getElementById('bar-btn-settings');
    const btnMic = document.getElementById('bar-btn-mic');
    const btnDeafen = document.getElementById('bar-btn-deafen');
    const btnDisconnect = document.getElementById('bar-btn-disconnect');

    btnAddText?.addEventListener('click', () => createChannelModal.open('TEXT'));
    btnAddVoice?.addEventListener('click', () => createChannelModal.open('VOICE'));
    btnInvite?.addEventListener('click', () => inviteModal.open());
    btnServerSettings?.addEventListener('click', () => serverSettingsModal.open());
    btnProfile?.addEventListener('click', () => settingsModal.open());
    btnSettings?.addEventListener('click', () => settingsModal.open());

    btnMic?.addEventListener('click', () => {
      const newMuted = !voiceStore.isMuted;
      voiceStore.setMuted(newMuted);
      audioProcessor.setMuted(newMuted);
      soundEffects.play(newMuted ? 'mic_mute' : 'mic_unmute');
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isMuted: newMuted });
      if (btnMic) {
        btnMic.className = `btn btn-icon ${newMuted ? 'danger-active' : ''}`;
        btnMic.innerHTML = `<span class="material-symbols-outlined md-18">${newMuted ? 'mic_off' : 'mic'}</span>`;
      }
    });

    btnDeafen?.addEventListener('click', () => {
      const newDeafened = !voiceStore.isDeafened;
      voiceStore.setDeafened(newDeafened);
      audioProcessor.setDeafened(newDeafened);
      webRtcManager.setDeafened(newDeafened);
      soundEffects.play(newDeafened ? 'deafen' : 'undeafen');
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isDeafened: newDeafened, isMuted: voiceStore.isMuted });
      if (btnDeafen) {
        btnDeafen.className = `btn btn-icon ${newDeafened ? 'danger-active' : ''}`;
        btnDeafen.innerHTML = `<span class="material-symbols-outlined md-18">${newDeafened ? 'headset_off' : 'headphones'}</span>`;
      }
    });

    btnDisconnect?.addEventListener('click', () => {
      if (confirm('Deseja realmente desconectar do servidor?')) {
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
      if (avatarEl && user.avatarUrl) avatarEl.src = user.avatarUrl;
      if (nameEl) nameEl.innerText = user.nickname;
    });

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
      serverStore.updateServerMeta(payload.name, payload.hasPassword);
      const titleEl = document.getElementById('server-name-title');
      if (titleEl) titleEl.innerText = payload.name;
    });

    this.unbindEvents.push(u1, u2, u3, u4, u5, u6, u7);
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
