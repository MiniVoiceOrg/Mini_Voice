import { MessageType, Permission } from '@monky/shared';
import { escapeHtml } from '../utils/html';
import { appEvents } from '../core/EventBus';
import { networkClient } from '../core/NetworkClient';
import { participantManager } from '../core/ParticipantManager';
import { serverStore } from '../stores/serverStore';
import { voiceStore } from '../stores/voiceStore';
import { chatStore } from '../stores/chatStore';
import { settingsStore, ChatSoundMode } from '../stores/settingsStore';
import { connectionStore, SavedServer } from '../stores/connectionStore';
import { audioProcessor } from '../core/AudioProcessor';
import { webRtcManager } from '../core/WebRtcManager';
import { ChatView } from './ChatView';
import { VoiceStageView } from './VoiceStageView';
import { createChannelModal } from './CreateChannelModal';
import { settingsModal } from './SettingsModal';
import { serverSettingsModal } from './ServerSettingsModal';
import { serverMonitorModal } from './ServerMonitorModal';
import { inviteModal } from './InviteModal';
import { contextMenu, ContextMenuItem } from './ContextMenu';
import { showConfirm, showAlert } from './Dialog';
import { setButtonLoading, withButtonLoading } from '../utils/buttonLoading';
import { checkServerOnline } from '../utils/serverStatus';
import { userContextMenu } from './UserContextMenu';
import { soundboardModal } from './SoundboardModal';
import { soundEffects } from '../core/SoundEffects';
import { getAvatarUrl, toAbsoluteServerIconUrl } from '../utils/avatar';
import { serverRailView } from './ServerRailView';
import logoUrl from '../assets/Logo.png';
import { t, tCount } from '../i18n';

export class MainView {
  private container: HTMLElement;
  private chatView: ChatView | null = null;
  public voiceStageView: VoiceStageView | null = null;
  private unbindEvents: Array<() => void> = [];
  private activeContentView: 'chat' | 'stage' = 'chat';
  private sidebarPingInterval: number | null = null;
  // Caches the rendered screen-share notice so the frequent (per-frame)
  // 'participants.updated' events don't rebuild it on every speaking change,
  // which would flicker the button and drop its listener (#282).
  private screenShareNoticeSignature: string | null = null;
  private textChannelDragHoverTimer: number | null = null;
  private textChannelDragHoverId: string | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public render(): void {
    this.unbindListeners();
    this.stopSidebarPing();

    if (!serverStore.serverDetails || !serverStore.currentUser) {
      return;
    }

    const s = serverStore.serverDetails;
    const u = serverStore.currentUser;
    const canManageChannels = serverStore.hasPermission(Permission.MANAGE_CHANNELS);
    const canManageServer = serverStore.hasPermission(Permission.MANAGE_SERVER);
    const canManageRoles = serverStore.hasPermission(Permission.MANAGE_ROLES);

    this.container.innerHTML = `
      <div class="main-layout">
        <!-- Server Rail: saved servers + home (#29) -->
        <div class="server-rail" id="server-rail"></div>

        <!-- Left Sidebar: Channels & User Controls -->
        <div class="channels-sidebar">
          <div class="channels-resizer" id="channels-resizer" title="${t('main.resizeHandle')}"></div>
          <div class="server-header">
            <button id="server-dropdown-toggle" class="server-dropdown-toggle" title="${t('main.serverOptions')}">
              <img id="server-header-icon" src="${s.iconUrl ? getAvatarUrl(s.iconUrl) : logoUrl}" alt="${t('serverSettings.iconAlt')}" style="width: 22px; height: 22px; object-fit: cover; border-radius: 4px; flex-shrink: 0;">
              <span id="server-name-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 700;">${escapeHtml(s.name)}</span>
              <span class="material-symbols-outlined md-18 server-dropdown-caret">expand_more</span>
            </button>
            <div id="server-dropdown-menu" class="server-dropdown-menu" style="display: none;">
              ${(canManageServer || canManageRoles) ? `
              <button id="btn-server-settings" class="server-dropdown-item" title="${t('main.serverSettingsTitle')}">
                <span class="material-symbols-outlined md-18">settings</span>
                <span>${t('serverSettings.title')}</span>
              </button>
              ` : ''}
              <button id="btn-server-monitor" class="server-dropdown-item" title="${t('serverMonitor.title')}" style="display: none;">
                <span class="material-symbols-outlined md-18">monitoring</span>
                <span>${t('serverMonitor.title')}</span>
              </button>
              <button id="btn-invite-friends" class="server-dropdown-item" title="${t('main.inviteTitle')}">
                <span class="material-symbols-outlined md-18">person_add</span>
                <span>${t('invite.title')}</span>
              </button>
            </div>
          </div>

          <div class="channels-list-container">
            <!-- Text Channels -->
            <div class="channel-category">
              <div class="category-title">
                <span>${t('main.textChannels')}</span>
                ${canManageChannels ? `<button id="btn-add-text-channel" class="category-add-btn" title="${t('main.createTextChannel')}">
                  <span class="material-symbols-outlined md-14">add</span>
                </button>` : ''}
              </div>
              <div id="text-channels-list"></div>
            </div>

            <!-- Voice Channels -->
            <div class="channel-category">
              <div class="category-title">
                <span>${t('main.voiceChannels')}</span>
                ${canManageChannels ? `<button id="btn-add-voice-channel" class="category-add-btn" title="${t('main.createVoiceChannel')}">
                  <span class="material-symbols-outlined md-14">add</span>
                </button>` : ''}
              </div>
              <div id="voice-channels-list"></div>
            </div>
          </div>

          <!-- Bottom User Bar -->
          <div class="user-control-bar">
            <div id="screenshare-notice-slot"></div>
            <div id="voice-connection-row-slot"></div>
            <div class="user-media-bar" id="user-media-bar">
              <button id="media-btn-camera" class="btn btn-icon media-bar-btn-lg ${voiceStore.isCameraOn ? 'broadcasting-pulse active' : ''}" title="${t('main.toggleCamera')}">
                <span class="material-symbols-outlined md-18">${voiceStore.isCameraOn ? 'videocam_off' : 'videocam'}</span>
              </button>
              <button id="media-btn-screen" class="btn btn-icon media-bar-btn-lg ${voiceStore.isScreenSharing ? 'broadcasting-pulse active' : ''}" title="${t('main.shareScreen')}">
                <span class="material-symbols-outlined md-18">${voiceStore.isScreenSharing ? 'stop_screen_share' : 'screen_share'}</span>
              </button>
              <button id="media-btn-soundboard" class="btn btn-icon media-bar-btn-lg" title="${t('main.openSoundboard')}">
                <span class="material-symbols-outlined md-18">music_note</span>
              </button>
            </div>
            <div class="user-control-main">
              <div id="user-profile-btn" class="user-profile-summary" title="${t('main.profileSettings')}">
                <div class="user-avatar-container">
                  <img id="main-user-avatar" class="user-avatar-main ${voiceStore.isSpeaking ? 'speaking' : ''}" src="${getAvatarUrl(u.avatarUrl)}">
                </div>
                <div class="user-info-text">
                  <span id="main-user-name" class="user-name-display">${escapeHtml(u.nickname)}</span>
                  <span class="user-status-text">${t('main.statusOnline')}</span>
                </div>
              </div>

              <div class="user-quick-actions">
                <button id="bar-btn-mic" class="btn btn-icon ${voiceStore.getEffectiveMuted() ? 'danger-active' : ''}" title="${voiceStore.getEffectiveMuted() ? t('main.unmute') : t('main.mute')}">
                  <span class="material-symbols-outlined md-18">${voiceStore.getEffectiveMuted() ? 'mic_off' : 'mic'}</span>
                </button>
                <button id="bar-btn-deafen" class="btn btn-icon ${voiceStore.getEffectiveDeafened() ? 'danger-active' : ''}" title="${voiceStore.getEffectiveDeafened() ? t('main.undeafen') : t('main.deafen')}">
                  <span class="material-symbols-outlined md-18">${voiceStore.getEffectiveDeafened() ? 'headset_off' : 'headphones'}</span>
                </button>
                <button id="bar-btn-settings" class="btn btn-icon" title="${t('connection.settingsTitle')}">
                  <span class="material-symbols-outlined md-18">settings</span>
                </button>
                <button id="bar-btn-disconnect" class="btn btn-icon" style="color: var(--danger);" title="${t('main.disconnectTitle')}">
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
            <span id="members-count-label">${t('main.membersCount', { count: 0 })}</span>
          </div>
          <div id="members-list-items" class="members-list"></div>
        </div>
      </div>
    `;

    this.renderChannels();
    this.renderMembers();
    serverRailView.render();
    this.setupChannelsResizer();

    const centerStageEl = document.getElementById('main-center-stage')!;
    this.chatView = new ChatView(centerStageEl);
    this.voiceStageView = new VoiceStageView(centerStageEl);

    // A re-render (e.g. after switching languages, #16) must not drop someone
    // who is watching the voice stage back into the text channel.
    if (this.activeContentView === 'stage' && voiceStore.currentVoiceChannelId) {
      this.voiceStageView.setChannel(voiceStore.currentVoiceChannelId);
    } else if (serverStore.activeTextChannelId) {
      this.chatView.setChannel(serverStore.activeTextChannelId);
    }

    this.attachEvents();
    this.updateVoiceConnectionRow();
    // Fresh DOM below means the (empty) slot must be repopulated, so drop the
    // cached signature (#282).
    this.screenShareNoticeSignature = null;
    this.updateScreenShareNotice();
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
            <span class="voice-conn-status">${t('main.voiceConnected')}</span>
            <span class="voice-conn-channel" id="sidebar-voice-channel">${escapeHtml(vc.name)}</span>
          </div>
          <span class="voice-conn-ping" id="sidebar-voice-ping" title="${t('main.averagePing')}">-- ms</span>
        </div>
        <div class="voice-conn-actions">
          <button id="sidebar-btn-rnnoise" class="btn btn-icon voice-conn-rnnoise ${settingsStore.noiseSuppressionEnabled ? 'rnnoise-active' : ''}" title="${settingsStore.noiseSuppressionEnabled ? t('main.rnnoiseOn') : t('main.rnnoiseOff')}">
            <span class="material-symbols-outlined md-18">graphic_eq</span>
          </button>
          <button id="sidebar-btn-leave-voice" class="btn btn-icon voice-conn-leave" title="${t('main.leaveCall')}">
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
        btnRnnoise.setAttribute('title', enabled ? t('main.rnnoiseOn') : t('main.rnnoiseOff'));
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

  /**
   * Remote participants broadcasting their screen in the voice channel the
   * local user is currently connected to (#282).
   */
  private getRemoteScreenSharers(): Array<{ id: string; nickname: string }> {
    const channelId = voiceStore.currentVoiceChannelId;
    if (!channelId) return [];
    return participantManager
      .getInVoiceChannel(channelId)
      .filter((p) => !serverStore.isMySession(p.user.sessionId) && (p.voiceState?.isScreenSharing ?? false))
      .map((p) => ({
        id: p.user.sessionId || p.user.id,
        nickname: participantManager.displayName(p),
      }));
  }

  /**
   * Sidebar notice shown while someone in the call is sharing their screen and
   * the user is looking at a text channel instead of the stage (#282). With a
   * single broadcaster the button opts straight into watching; with several it
   * only opens the stage, since there is no way to guess which one to watch.
   */
  private updateScreenShareNotice(): void {
    const slot = document.getElementById('screenshare-notice-slot');
    if (!slot) return;

    const sharers = this.getRemoteScreenSharers();
    const signature = `${this.activeContentView}|${sharers.map((s) => `${s.id}:${s.nickname}`).join(',')}`;
    if (signature === this.screenShareNoticeSignature) return;
    this.screenShareNoticeSignature = signature;

    if (this.activeContentView === 'stage' || sharers.length === 0) {
      slot.innerHTML = '';
      return;
    }

    const names = sharers.map((s) => escapeHtml(s.nickname));
    let label: string;
    if (names.length === 1) {
      label = t('main.screenShareNoticeOne', { name: names[0] });
    } else if (names.length === 2) {
      label = t('main.screenShareNoticeTwo', { first: names[0], second: names[1] });
    } else {
      label = tCount('main.screenShareNoticeMany', names.length - 2, {
        first: names[0],
        second: names[1],
      });
    }

    const single = sharers.length === 1;
    slot.innerHTML = `
      <div class="screenshare-notice">
        <span class="material-symbols-outlined md-16 screenshare-notice-icon">screen_share</span>
        <span class="screenshare-notice-text" title="${label}">${label}</span>
        <button id="screenshare-notice-btn" class="screenshare-notice-btn">${single ? t('main.screenShareWatch') : t('main.screenShareGoToStage')}</button>
      </div>
    `;

    document.getElementById('screenshare-notice-btn')?.addEventListener('click', () => {
      this.openVoiceStage(single ? sharers[0].id : undefined);
    });
  }

  /**
   * Switches the center area to the voice stage, optionally opting into a
   * specific remote screen share on the way in (#282).
   */
  private openVoiceStage(watchSessionId?: string): void {
    const channelId = voiceStore.currentVoiceChannelId;
    if (!channelId) return;
    this.activeContentView = 'stage';
    this.voiceStageView?.setChannel(channelId);
    if (watchSessionId) this.voiceStageView?.watchScreenShare(watchSessionId);
    this.renderChannels();
    this.updateScreenShareNotice();
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
        title: t('main.joinVoiceFirstTitle'),
        message: t('main.joinVoiceFirstMessage'),
        variant: 'warning',
      });
      return false;
    }
    return true;
  }

  private setupChannelsResizer(): void {
    const resizer = document.getElementById('channels-resizer');
    const sidebar = this.container.querySelector('.channels-sidebar') as HTMLElement | null;
    if (!resizer || !sidebar) return;

    // Restore a previously persisted width.
    try {
      const saved = localStorage.getItem('monky_channels_width');
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
        localStorage.setItem('monky_channels_width', String(parseInt(sidebar.style.width, 10)));
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

  private activateTextChannel(channelId: string): void {
    this.clearTextChannelDragHover();
    serverStore.setActiveTextChannel(channelId);
    this.activeContentView = 'chat';
    this.chatView?.setChannel(channelId);
    this.renderChannels();
    this.updateScreenShareNotice();
  }

  private isFileDrag(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;
    return !!types && Array.from(types).includes('Files');
  }

  private clearTextChannelDragHover(): void {
    if (this.textChannelDragHoverTimer !== null) {
      window.clearTimeout(this.textChannelDragHoverTimer);
      this.textChannelDragHoverTimer = null;
    }

    if (this.textChannelDragHoverId) {
      const previousItem = this.container.querySelector(
        `.channel-item[data-channel-id="${this.textChannelDragHoverId}"][data-channel-type="TEXT"]`
      ) as HTMLElement | null;
      previousItem?.classList.remove('drag-hover');
    }

    this.textChannelDragHoverId = null;
  }

  private arePermissionsResolved(): boolean {
    return serverStore.myPermissions > 0 || serverStore.ownerId !== null;
  }

  private canReadTextChannels(): boolean {
    return !this.arePermissionsResolved() || serverStore.hasPermission(Permission.READ_MESSAGES);
  }

  private canSpeakInVoiceChannels(): boolean {
    return !this.arePermissionsResolved() || serverStore.hasPermission(Permission.SPEAK);
  }

  private showVoicePermissionDenied(): void {
    void showAlert({
      title: t('main.voicePermissionDeniedTitle'),
      message: t('main.voicePermissionDeniedMessage'),
      variant: 'warning',
    });
  }

  private scheduleTextChannelAutoSwitch(item: HTMLElement, channelId: string): void {
    if (this.textChannelDragHoverId !== channelId) {
      this.clearTextChannelDragHover();
      this.textChannelDragHoverId = channelId;
      item.classList.add('drag-hover');
    }

    if (this.textChannelDragHoverTimer !== null) return;

    this.textChannelDragHoverTimer = window.setTimeout(() => {
      this.textChannelDragHoverTimer = null;
      if (this.textChannelDragHoverId !== channelId) return;
      if (serverStore.activeTextChannelId === channelId && this.activeContentView === 'chat') return;
      this.activateTextChannel(channelId);
    }, 500);
  }

  private renderChannels(): void {
    if (!serverStore.serverDetails) return;

    const textListEl = document.getElementById('text-channels-list');
    const voiceListEl = document.getElementById('voice-channels-list');
    const canReadTextChannels = this.canReadTextChannels();
    const canSpeakInVoiceChannels = this.canSpeakInVoiceChannels();
    const permissionsResolved = this.arePermissionsResolved();

    const textChannels = canReadTextChannels
      ? serverStore.serverDetails.channels.filter((c) => c.type === 'TEXT')
      : [];
    const voiceChannels = serverStore.serverDetails.channels.filter((c) => c.type === 'VOICE');

    if (textListEl) {
      textListEl.innerHTML = textChannels.map((c) => `
        <div class="channel-item ${c.id === serverStore.activeTextChannelId && this.activeContentView === 'chat' ? 'active' : ''}" data-channel-id="${c.id}" data-channel-type="TEXT">
          <span class="material-symbols-outlined md-16 channel-icon" style="color: var(--text-muted);">tag</span>
          <span class="channel-name">${escapeHtml(c.name)}</span>
          ${chatStore.hasMention(c.id)
            ? `<span class="channel-mention-badge" title="${t('main.mentionBadge')}">@</span>`
            : chatStore.hasUnread(c.id)
              ? `<span class="channel-unread-dot" title="${t('main.unreadBadge')}"></span>`
              : ''}
          <button class="channel-menu-btn" data-menu-channel="${c.id}" title="${t('common.moreOptions')}">
            <span class="material-symbols-outlined md-16">more_vert</span>
          </button>
        </div>
      `).join('');
    }

    if (voiceListEl) {
      voiceListEl.innerHTML = voiceChannels.map((c) => {
        const inVoice = participantManager.getInVoiceChannel(c.id);
        const isActive = c.id === voiceStore.currentVoiceChannelId;
        const showRestrictedIcon = permissionsResolved && !canSpeakInVoiceChannels;
        const isRestricted = showRestrictedIcon && !isActive;

        return `
          <div style="display: flex; flex-direction: column;">
            <div class="channel-item ${isActive ? 'active' : ''} ${isRestricted ? 'restricted' : ''}" data-channel-id="${c.id}" data-channel-type="VOICE">
              <span class="material-symbols-outlined md-16 channel-icon" style="color: ${isActive ? 'var(--success)' : 'var(--text-muted)'};">volume_up</span>
              <span class="channel-name">${escapeHtml(c.name)}</span>
              ${showRestrictedIcon ? `<span class="material-symbols-outlined md-16 channel-restricted-icon" title="${t('main.voiceChannelRestricted')}">lock</span>` : ''}
              ${isActive ? `<span style="font-size: 11px; color: var(--success); font-weight: 600; margin-left: auto;">(${t('common.you')})</span>` : ''}
              <button class="channel-menu-btn" data-menu-channel="${c.id}" title="${t('common.moreOptions')}">
                <span class="material-symbols-outlined md-16">more_vert</span>
              </button>
            </div>

            ${inVoice.length > 0 ? `
              <div class="voice-participants-sublist">
                ${inVoice.map((p) => {
                  const sessionId = p.user.sessionId || p.user.id;
                  const isLocal = serverStore.isMySession(p.user.sessionId);
                  const isSpeaking = isLocal ? voiceStore.isSpeaking : p.isSpeaking;
                  const isServerDeafened = isLocal ? voiceStore.serverDeafened : (p.voiceState?.serverDeafened ?? false);
                  const isServerMuted = isLocal ? voiceStore.serverMuted : (p.voiceState?.serverMuted ?? false);
                  const isSelfDeafened = isLocal ? voiceStore.isDeafened : (p.voiceState?.isDeafened ?? false);
                  const isSelfMuted = isLocal ? voiceStore.isMuted : (p.voiceState?.isMuted ?? false);
                  const isMicMuted = isSelfMuted || isServerMuted || isSelfDeafened || isServerDeafened;
                  const avatar = getAvatarUrl(p.user.avatarUrl);
                  const displayName = participantManager.displayName(p);

                  return `
                    <div id="voice-mini-user-${sessionId}" class="voice-participant-mini ${isSpeaking ? 'speaking' : ''}" data-session-id="${sessionId}" title="${escapeHtml(displayName)} (${t('main.rightClickVolumeShort')})">
                      <img class="voice-mini-avatar" src="${avatar}">
                      <span class="voice-mini-name">${escapeHtml(displayName)}</span>
                      ${isServerDeafened ? `<span class="material-symbols-outlined md-14 voice-mini-icon muted" title="${t('permissions.serverDeafened')}">hearing_disabled</span>` : ''}
                      ${isServerMuted ? `<span class="material-symbols-outlined md-14 voice-mini-icon muted" title="${t('permissions.serverMuted')}">admin_panel_settings</span>` : ''}
                      ${isMicMuted ? `<span class="material-symbols-outlined md-14 voice-mini-icon muted" title="${t('main.micMuted')}">mic_off</span>` : ''}
                      ${isSelfDeafened ? `<span class="material-symbols-outlined md-14 voice-mini-icon muted" title="${t('main.audioMuted')}">headset_off</span>` : ''}
                      ${p.voiceState?.isScreenSharing ? `<span class="material-symbols-outlined md-14 voice-mini-icon live" title="${t('main.sharingScreen')}">screen_share</span>` : ''}
                      ${p.voiceState?.isCameraOn ? `<span class="material-symbols-outlined md-14 voice-mini-icon" title="${t('main.cameraOn')}">videocam</span>` : ''}
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
        const sessionId = miniEl.getAttribute('data-session-id');
        if (!sessionId) return;
        const participant = participantManager.get(sessionId);
        if (participant?.user) {
          userContextMenu.open(mouseEvent.clientX, mouseEvent.clientY, participant.user);
        }
      });

      // Drag-and-drop users between voice channels (#248)
      if (serverStore.hasPermission(Permission.MOVE_MEMBERS)) {
        const el = miniEl as HTMLElement;
        el.draggable = true;
        el.addEventListener('dragstart', (e: Event) => {
          const de = e as DragEvent;
          const sessionId = el.getAttribute('data-session-id');
          if (sessionId) {
            de.dataTransfer?.setData('text/monky-session-id', sessionId);
            de.dataTransfer!.effectAllowed = 'move';
            el.classList.add('dragging');
          }
        });
        el.addEventListener('dragend', () => { el.classList.remove('dragging'); });
      }
    });

    // Voice channel drop targets for user drag-and-drop (#248)
    if (serverStore.hasPermission(Permission.MOVE_MEMBERS)) {
      this.container.querySelectorAll('.channel-item[data-channel-type="VOICE"]').forEach((item) => {
        const el = item as HTMLElement;
        el.addEventListener('dragover', (e: Event) => {
          const de = e as DragEvent;
          if (de.dataTransfer?.types.includes('text/monky-session-id')) {
            de.preventDefault();
            de.dataTransfer!.dropEffect = 'move';
            el.classList.add('drop-target');
          }
        });
        el.addEventListener('dragleave', (e: Event) => {
          const de = e as DragEvent;
          const next = de.relatedTarget as Node | null;
          if (next && el.contains(next)) return;
          el.classList.remove('drop-target');
        });
        el.addEventListener('drop', (e: Event) => {
          const de = e as DragEvent;
          de.preventDefault();
          el.classList.remove('drop-target');
          const sessionId = de.dataTransfer?.getData('text/monky-session-id');
          const channelId = el.getAttribute('data-channel-id');
          if (sessionId && channelId) {
            void networkClient.sendRequest(MessageType.ADMIN_MOVE_USER, {
              targetSessionId: sessionId,
              channelId,
            }).catch(() => {});
          }
        });
      });
    }

    // Attach click listeners to channel items
    this.container.querySelectorAll('.channel-item').forEach((item) => {
      item.addEventListener('click', async (e) => {
        if ((e.target as HTMLElement).closest('.channel-menu-btn')) return;
        const channelId = item.getAttribute('data-channel-id')!;
        const type = item.getAttribute('data-channel-type')!;

        if (type === 'TEXT') {
          this.activateTextChannel(channelId);
        } else if (type === 'VOICE') {
          if (channelId !== voiceStore.currentVoiceChannelId && this.arePermissionsResolved() && !serverStore.hasPermission(Permission.SPEAK)) {
            item.classList.add('restricted-feedback');
            window.setTimeout(() => item.classList.remove('restricted-feedback'), 600);
            this.showVoicePermissionDenied();
            return;
          }
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
            this.updateScreenShareNotice();
          } finally {
            this.renderChannels();
          }
        }
      });
    });

    this.container.querySelectorAll('.channel-item[data-channel-type="TEXT"]').forEach((item) => {
      const el = item as HTMLElement;
      const channelId = el.getAttribute('data-channel-id');
      if (!channelId) return;

      const handleDragHover = (e: Event) => {
        const dragEvent = e as DragEvent;
        if (!this.isFileDrag(dragEvent)) return;
        dragEvent.preventDefault();
        if (dragEvent.dataTransfer) dragEvent.dataTransfer.dropEffect = 'copy';
        this.scheduleTextChannelAutoSwitch(el, channelId);
      };

      el.addEventListener('dragenter', handleDragHover);
      el.addEventListener('dragover', handleDragHover);
      el.addEventListener('dragleave', (e) => {
        const dragEvent = e as DragEvent;
        if (!this.isFileDrag(dragEvent)) return;
        const nextTarget = dragEvent.relatedTarget as Node | null;
        if (nextTarget && el.contains(nextTarget)) return;
        if (this.textChannelDragHoverId === channelId) {
          this.clearTextChannelDragHover();
        }
      });
      el.addEventListener('drop', () => this.clearTextChannelDragHover());
    });

    // Right-clicking a channel opens the same options menu as the ⋮ button (#151).
    this.container.querySelectorAll('.channel-item').forEach((item) => {
      item.addEventListener('contextmenu', (e) => {
        const mouseEvent = e as MouseEvent;
        mouseEvent.preventDefault();
        const channelId = item.getAttribute('data-channel-id');
        if (!channelId) return;
        this.openChannelMenu(channelId, mouseEvent.clientX, mouseEvent.clientY);
      });
    });

    // Attach "more options" menu listeners (#151). Delete now lives inside a
    // dropdown so more per-channel actions can be added later, and the same menu
    // is also reachable by right-clicking the channel above.
    this.container.querySelectorAll('.channel-menu-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const channelId = btn.getAttribute('data-menu-channel');
        if (!channelId) return;
        const rect = (btn as HTMLElement).getBoundingClientRect();
        this.openChannelMenu(channelId, rect.left, rect.bottom + 4);
      });
    });
  }

  /** Opens the per-channel options menu at the given screen coordinates (#151). */
  private openChannelMenu(channelId: string, x: number, y: number): void {
    const channel = serverStore.serverDetails?.channels.find((c) => c.id === channelId);
    const items: ContextMenuItem[] = [];

    // Chat-sound notifications only apply to text channels (#153).
    if (channel?.type === 'TEXT') {
      items.push({
        label: t('channelMenu.notifications'),
        icon: 'notifications',
        onClick: () => this.openChannelNotificationMenu(channelId, x, y),
      });

      // Only offered when there is actually something to clear (#263).
      if (chatStore.hasUnread(channelId) || chatStore.hasMention(channelId)) {
        items.push({
          label: t('channelMenu.markAsRead'),
          icon: 'mark_chat_read',
          onClick: () => {
            chatStore.clearUnread(channelId);
            if (chatStore.hasMention(channelId)) {
              chatStore.clearMention(channelId);
              networkClient.send(MessageType.CHAT_MENTIONS_READ, { channelId });
            }
          },
        });
      }
    }

    if (serverStore.hasPermission(Permission.MANAGE_CHANNELS)) {
      items.push({
        label: t('main.deleteChannel'),
        icon: 'delete',
        danger: true,
        onClick: () => {
          void this.handleDeleteChannel(channelId);
        },
      });
    }

    contextMenu.open(x, y, items);
  }

  /** Submenu to pick the per-channel chat-sound mode, overriding server/global (#153). */
  private openChannelNotificationMenu(channelId: string, x: number, y: number): void {
    const current = settingsStore.getChannelChatSoundOverride(channelId);
    const item = (mode: ChatSoundMode, label: string) => ({
      label,
      icon: current === mode ? 'check' : undefined,
      onClick: () => settingsStore.setChannelChatSoundOverride(channelId, mode),
    });
    contextMenu.open(x, y, [
      item('inherit', t('chatSound.inheritServer')),
      item('all', t('chatSound.all')),
      item('mentions', t('chatSound.mentions')),
      item('none', t('chatSound.none')),
    ]);
  }

  private async handleJoinVoiceChannel(channelId: string, silent: boolean = false): Promise<void> {
    if (voiceStore.currentVoiceChannelId === channelId) {
      // Already in this channel, just switch view to stage
      this.activeContentView = 'stage';
      this.voiceStageView?.setChannel(channelId);
      this.updateScreenShareNotice();
      return;
    }

    if (this.arePermissionsResolved() && !serverStore.hasPermission(Permission.SPEAK)) {
      if (!silent) this.showVoicePermissionDenied();
      return;
    }

    // If in another channel, close the current mesh locally; the server-side
    // join handler updates the stored voice state to the new room directly.
    if (voiceStore.currentVoiceChannelId) {
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
      const peerSessionId = peer.user.sessionId || peer.user.id;
      if (!serverStore.isMySession(peer.user.sessionId)) {
        await webRtcManager.connectToPeer(peerSessionId, true);
      }
    }
  }

  public async rejoinVoiceChannel(channelId: string): Promise<void> {
    // Close existing peer connections before moving (#248)
    webRtcManager.closeAllPeers();
    // Reset the stored voice channel so handleJoinVoiceChannel performs a full
    // (re)join instead of early-returning, then reconnect the mesh.
    voiceStore.setChannel(null);
    this.activeContentView = 'stage';
    await this.handleJoinVoiceChannel(channelId, true);
    this.voiceStageView?.setChannel(channelId);
    this.renderChannels();
    this.updateScreenShareNotice();
  }

  private async handleDeleteChannel(channelId: string): Promise<void> {
    if (!serverStore.serverDetails) return;
    const channel = serverStore.serverDetails.channels.find((c) => c.id === channelId);
    if (!channel) return;

    const isText = channel.type === 'TEXT';
    const confirmed = await showConfirm({
      title: isText ? t('main.deleteTextChannelTitle') : t('main.deleteVoiceChannelTitle'),
      message: isText
        ? t('main.deleteTextChannelMessage', { name: channel.name })
        : t('main.deleteVoiceChannelMessage', { name: channel.name }),
      confirmLabel: t('main.delete'),
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

  // Re-evaluate UI elements that depend on the current user's permissions (#246)
  private updatePermissionDependentUI(): void {
    const canManageServer = serverStore.hasPermission(Permission.MANAGE_SERVER);
    const canManageRoles = serverStore.hasPermission(Permission.MANAGE_ROLES);
    const btnSettings = document.getElementById('btn-server-settings');
    if (btnSettings) {
      (btnSettings as HTMLElement).style.display = (canManageServer || canManageRoles) ? '' : 'none';
    }
  }

  private renderMembers(): void {
    if (!serverStore.serverDetails) return;

    const listEl = document.getElementById('members-list-items');
    const countEl = document.getElementById('members-count-label');

    const members = serverStore.getMembersInDisplayOrder();

    if (countEl) {
      countEl.innerText = t('main.membersCount', { count: members.length });
    }

    if (listEl) {
      listEl.innerHTML = members.map((m) => {
        const isLocal = m.id === serverStore.currentUser?.id;
        const vm = participantManager.getByUserId(m.id);
        const voiceState = vm?.voiceState;
        const inVoice = !!voiceState;
        const isReconnecting = participantManager.isUserReconnecting(m.id);
        const avatar = getAvatarUrl(m.avatarUrl);
        const isServerDeafened = isLocal ? voiceStore.serverDeafened : (voiceState?.serverDeafened ?? false);
        const isServerMuted = isLocal ? voiceStore.serverMuted : (voiceState?.serverMuted ?? false);
        const isSelfDeafened = isLocal ? voiceStore.isDeafened : (voiceState?.isDeafened ?? false);
        const isSelfMuted = isLocal ? voiceStore.isMuted : (voiceState?.isMuted ?? false);
        const isMicMuted = inVoice && (isSelfMuted || isServerMuted || isSelfDeafened || isServerDeafened);

        return `
          <div class="member-item ${isReconnecting ? 'reconnecting' : ''}" data-user-id="${m.id}" title="${escapeHtml(m.nickname)} ${isLocal ? `(${t('common.you')})` : `(${t('main.rightClickVolume')})`}">
            <div class="member-avatar-wrapper">
              <img class="member-avatar-img" src="${avatar}">
              <span class="status-indicator ${isReconnecting ? 'reconnecting' : (inVoice ? 'voice' : 'online')}"></span>
            </div>
            <div class="member-info">
              <div class="member-name-row">
                <span class="member-name">${escapeHtml(m.nickname)}</span>
                ${isLocal ? `<span class="member-badge-you">${t('common.you')}</span>` : ''}
                ${m.id === serverStore.ownerId ? `<span class="member-badge-you">${t('roles.ownerBadge')}</span>` : ''}
                ${isReconnecting ? `<span class="member-reconnecting-badge" title="${t('main.reconnectingTitle')}"><span class="material-symbols-outlined md-14 spin">sync</span></span>` : ''}
                ${voiceState?.isScreenSharing ? `<span class="member-live-badge" title="${t('main.sharingScreen')}">LIVE</span>` : ''}
                ${voiceState?.isCameraOn ? `<span class="material-symbols-outlined md-14 member-cam-icon" title="${t('main.cameraOn')}">videocam</span>` : ''}
                ${isServerDeafened ? `<span class="material-symbols-outlined md-14 member-cam-icon" title="${t('permissions.serverDeafened')}">hearing_disabled</span>` : ''}
                ${isServerMuted ? `<span class="material-symbols-outlined md-14 member-cam-icon" title="${t('permissions.serverMuted')}">admin_panel_settings</span>` : ''}
                ${isMicMuted ? `<span class="material-symbols-outlined md-14 member-cam-icon" title="${t('main.micMuted')}">mic_off</span>` : ''}
                ${isSelfDeafened ? `<span class="material-symbols-outlined md-14 member-cam-icon" title="${t('main.audioMuted')}">headset_off</span>` : ''}
              </div>
              ${(() => {
                const userRoles = serverStore.getUserRoles(m.id).filter((r) => !r.isDefault);
                return userRoles.length ? `<div class="member-role-tags">${userRoles.map((role) => `<span class="member-role-tag" style="${role.color ? `--role-color: ${role.color}` : ''}">${escapeHtml(role.name)}</span>`).join('')}</div>` : '';
              })()}
              <span class="member-subtext">${isReconnecting ? t('main.reconnecting') : (inVoice ? t('main.inVoiceChannel') : t('main.statusOnline'))}</span>
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

  private async refreshServerMonitorVisibility(): Promise<void> {
    const btn = document.getElementById('btn-server-monitor');
    if (!btn) return;

    // Only makes sense for the server this machine is hosting (#GUI retirement).
    let isHosting = false;
    try {
      const status = await window.api?.hostServerStatus?.();
      isHosting = Boolean(status?.isRunning);
    } catch {
      isHosting = false;
    }
    btn.style.display = isHosting ? '' : 'none';
  }

  private attachEvents(): void {
    this.unbindEvents.forEach((u) => u());
    this.unbindEvents = [];

    const btnAddText = document.getElementById('btn-add-text-channel');
    const btnAddVoice = document.getElementById('btn-add-voice-channel');
    const btnInvite = document.getElementById('btn-invite-friends');
    const btnServerSettings = document.getElementById('btn-server-settings');
    const btnServerMonitor = document.getElementById('btn-server-monitor');
    const btnProfile = document.getElementById('user-profile-btn');
    const btnSettings = document.getElementById('bar-btn-settings');
    const btnMic = document.getElementById('bar-btn-mic');
    const btnDeafen = document.getElementById('bar-btn-deafen');
    const btnDisconnect = document.getElementById('bar-btn-disconnect');

    btnAddText?.addEventListener('click', (e) => withButtonLoading(e.currentTarget as HTMLElement, () => createChannelModal.open('TEXT')));
    btnAddVoice?.addEventListener('click', (e) => withButtonLoading(e.currentTarget as HTMLElement, () => createChannelModal.open('VOICE')));
    btnInvite?.addEventListener('click', (e) => { this.closeServerDropdown(); withButtonLoading(e.currentTarget as HTMLElement, () => inviteModal.open()); });
    btnServerSettings?.addEventListener('click', (e) => { this.closeServerDropdown(); withButtonLoading(e.currentTarget as HTMLElement, () => serverSettingsModal.open()); });
    btnServerMonitor?.addEventListener('click', (e) => { this.closeServerDropdown(); withButtonLoading(e.currentTarget as HTMLElement, () => serverMonitorModal.open()); });
    void this.refreshServerMonitorVisibility();
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

    const clearTextChannelDragHover = () => this.clearTextChannelDragHover();
    document.addEventListener('drop', clearTextChannelDragHover);
    document.addEventListener('dragend', clearTextChannelDragHover);
    this.unbindEvents.push(
      () => document.removeEventListener('drop', clearTextChannelDragHover),
      () => document.removeEventListener('dragend', clearTextChannelDragHover)
    );

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
      audioProcessor.setMuted(voiceStore.getEffectiveMuted());
      soundEffects.play(newMuted ? 'mic_mute' : 'mic_unmute');
      // Unmuting the mic while deafened also undeafens the audio output (#62).
      let undeafened = false;
      if (!newMuted && voiceStore.isDeafened) {
        voiceStore.setDeafened(false);
        audioProcessor.setDeafened(voiceStore.getEffectiveDeafened());
        webRtcManager.setDeafened(voiceStore.getEffectiveDeafened());
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
      audioProcessor.setDeafened(voiceStore.getEffectiveDeafened());
      // Restore the mic track to its (possibly restored) pre-deafen state (#74).
      audioProcessor.setMuted(voiceStore.getEffectiveMuted());
      webRtcManager.setDeafened(voiceStore.getEffectiveDeafened());
      soundEffects.play(newDeafened ? 'deafen' : 'undeafen');
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isDeafened: newDeafened, isMuted: voiceStore.isMuted });
      if (btnDeafen) {
        btnDeafen.className = `btn btn-icon ${newDeafened ? 'danger-active' : ''}`;
        btnDeafen.innerHTML = `<span class="material-symbols-outlined md-18">${newDeafened ? 'headset_off' : 'headphones'}</span>`;
      }
    });

    btnDisconnect?.addEventListener('click', async () => {
      const confirmed = await showConfirm({
        title: t('main.disconnect'),
        message: t('main.disconnectMessage'),
        confirmLabel: t('main.disconnect'),
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
      this.updatePermissionDependentUI();
    });

    const u2 = appEvents.on('participants.updated', () => {
      this.renderChannels();
      this.renderMembers();
      this.updateScreenShareNotice();
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
        btnMicEl.className = `btn btn-icon ${voiceStore.getEffectiveMuted() ? 'danger-active' : ''}`;
        btnMicEl.title = voiceStore.getEffectiveMuted() ? t('main.unmute') : t('main.mute');
        btnMicEl.innerHTML = `<span class="material-symbols-outlined md-18">${voiceStore.getEffectiveMuted() ? 'mic_off' : 'mic'}</span>`;
      }

      const btnDeafenEl = document.getElementById('bar-btn-deafen');
      if (btnDeafenEl) {
        btnDeafenEl.className = `btn btn-icon ${voiceStore.getEffectiveDeafened() ? 'danger-active' : ''}`;
        btnDeafenEl.title = voiceStore.getEffectiveDeafened() ? t('main.undeafen') : t('main.deafen');
        btnDeafenEl.innerHTML = `<span class="material-symbols-outlined md-18">${voiceStore.getEffectiveDeafened() ? 'headset_off' : 'headphones'}</span>`;
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
      // Hanging up via VoiceStageView.leaveVoice() goes through voiceStore.reset(),
      // which only emits 'voice.state_updated', so the screen-share notice has to
      // be cleared here too — otherwise it lingers until the server echo (#282).
      if (voiceStore.currentVoiceChannelId !== lastVoiceChannelId) {
        lastVoiceChannelId = voiceStore.currentVoiceChannelId;
        this.updateVoiceConnectionRow();
        this.updateScreenShareNotice();
      }
    });

    const u5 = appEvents.on('voice.speaking_changed', (speaking: boolean) => {
      const avatarEl = document.getElementById('main-user-avatar');
      if (avatarEl) {
        if (speaking) avatarEl.classList.add('speaking');
        else avatarEl.classList.remove('speaking');
      }
      if (serverStore.currentUser) {
        const mySessionId = serverStore.currentUser.sessionId || serverStore.currentUser.id;
        const miniEl = document.getElementById(`voice-mini-user-${mySessionId}`);
        if (miniEl) {
          if (speaking) miniEl.classList.add('speaking');
          else miniEl.classList.remove('speaking');
        }
      }
    });

    const u6 = appEvents.on('participants.speaking_changed', (data: { sessionId: string; speaking: boolean }) => {
      const miniEl = document.getElementById(`voice-mini-user-${data.sessionId}`);
      if (miniEl) {
        if (data.speaking) miniEl.classList.add('speaking');
        else miniEl.classList.remove('speaking');
      }
    });

    const u7 = appEvents.on(`message.${MessageType.SERVER_SETTINGS_UPDATED}`, (payload: any) => {
      serverStore.updateServerMeta(payload.name, payload.hasPassword, payload.allowSoundboard, payload.iconUrl, payload.attachmentStorage);
      const titleEl = document.getElementById('server-name-title');
      if (titleEl) titleEl.innerText = payload.name;
      const iconEl = document.getElementById('server-header-icon') as HTMLImageElement;
      if (iconEl) iconEl.src = payload.iconUrl ? getAvatarUrl(payload.iconUrl) : logoUrl;
      // Persist updated icon on the saved server entry
      const url = networkClient.getCurrentServerUrl();
      if (url) {
        const match = url.match(/\/\/([^:]+):(\d+)/);
        if (match) {
          const port = parseInt(match[2], 10);
          connectionStore.updateSavedServerIcon(
            match[1],
            port,
            toAbsoluteServerIconUrl(match[1], port, payload.iconUrl)
          );
        }
      }
      serverRailView.render();
    });

    const u7b = appEvents.on('connection.saved_servers_changed', () => {
      serverRailView.render();
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
      this.updateScreenShareNotice();
    });

    const u10 = appEvents.on('settings.updated', () => {
      const btnRnnoise = document.getElementById('sidebar-btn-rnnoise');
      if (btnRnnoise) {
        const enabled = settingsStore.noiseSuppressionEnabled;
        btnRnnoise.className = `btn btn-icon voice-conn-rnnoise ${enabled ? 'rnnoise-active' : ''}`;
        btnRnnoise.setAttribute('title', enabled ? t('main.rnnoiseOn') : t('main.rnnoiseOff'));
      }
    });

    const u11 = appEvents.on('server.members_updated', () => {
      this.renderMembers();
    });

    // Re-render the channel list when an @-mention arrives or is cleared so the
    // red indicator on the text channel appears/disappears immediately (#14).
    const u12 = appEvents.on('chat.mentions_updated', () => {
      this.renderChannels();
    });

    // Same for the unread-messages dot (#263).
    const u13 = appEvents.on('chat.unread_updated', () => {
      this.renderChannels();
    });

    this.unbindEvents.push(u1, u2, u3, u4, u5, u6, u7, u7b, u8, u9, u10, u11, u12, u13);
  }

  /** True when the given text channel is the one currently visible on screen (#14). */
  public isViewingTextChannel(channelId: string): boolean {
    return (
      this.activeContentView === 'chat' &&
      serverStore.activeTextChannelId === channelId
    );
  }

  private unbindListeners(): void {
    this.unbindEvents.forEach((u) => u());
    this.unbindEvents = [];
  }

  public destroy(): void {
    this.stopSidebarPing();
    this.clearTextChannelDragHover();
    this.unbindListeners();
    this.chatView?.destroy();
    this.voiceStageView?.destroy();
  }
}
