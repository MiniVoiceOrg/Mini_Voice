import { escapeHtml } from '../utils/html';
import { MessageType } from '@monky/shared';
import { connectionStore, type CreatedServer } from '../stores/connectionStore';
import { networkClient } from '../core/NetworkClient';
import { getAvatarUrl } from '../utils/avatar';
import { settingsModal } from './SettingsModal';
import { withButtonLoading } from '../utils/buttonLoading';
import { showAlert, showConfirm } from './Dialog';
import { showIdentityImportDialog } from './IdentityDialogs';
import logoUrl from '../assets/Logo.png';
import { getLanguage, t } from '../i18n';

interface DiscoveredServer {
  host: string;
  port: number;
  serverName: string;
  version: string;
}

export class ConnectionView {
  private container: HTMLElement;
  private activeTab: 'join' | 'host' = 'join';
  private selectedAvatarBase64: string = '';
  private selectedSavedHost: string | null = null;
  private selectedSavedPort: number | null = null;
  private isHostedServerRunning: boolean = false;
  private runningCreatedServerId: string | null = null;
  private readonly discoveredServers: Map<string, DiscoveredServer> = new Map();

  constructor(container: HTMLElement) {
    this.container = container;
    connectionStore.loadUserProfile();
    connectionStore.loadSavedServers();
    connectionStore.loadCreatedServers();
    this.selectedAvatarBase64 = connectionStore.savedAvatarBase64 || '';
    this.setupLanDiscoveryListeners();
    void this.syncHostedServerStatus();
  }

  private async syncHostedServerStatus(): Promise<void> {
    if (!window.api?.hostServerStatus) return;

    try {
      const status = await window.api.hostServerStatus();
      this.isHostedServerRunning = !!status.isRunning;
      if (!this.isHostedServerRunning) {
        this.runningCreatedServerId = null;
      }
    } catch {
      this.isHostedServerRunning = false;
      this.runningCreatedServerId = null;
    }
  }

  private formatDateTime(timestamp: number): string {
    if (!timestamp) return t('connection.neverStarted');

    try {
      return new Intl.DateTimeFormat(getLanguage(), {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(timestamp);
    } catch {
      return new Date(timestamp).toLocaleString(getLanguage());
    }
  }

  private createCreatedServerId(): string {
    return `created-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private getHostNicknameValue(): string {
    const input = document.getElementById('host-nickname') as HTMLInputElement | null;
    return (input?.value || connectionStore.savedNickname || '').trim();
  }

  private getCreatedServersSectionHtml(createdServers: CreatedServer[]): string {
    if (createdServers.length === 0) {
      return `
        <div class="saved-servers-container" style="margin-bottom: 14px;">
          <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px; display: flex; align-items: center; gap: 4px;">
            <span class="material-symbols-outlined md-14" style="color: var(--accent-primary);">dns</span>
            ${t('connection.createdServers')}
          </div>
          <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.45;">
            ${t('connection.noCreatedServers')}
          </div>
        </div>
      `;
    }

    return `
      <div class="saved-servers-container" style="margin-bottom: 14px;">
        <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
          <span style="display: flex; align-items: center; gap: 4px;">
            <span class="material-symbols-outlined md-14" style="color: var(--accent-primary);">dns</span>
            ${t('connection.createdServersCount', { count: createdServers.length, max: 10 })}
          </span>
          <span style="font-size: 10px; font-weight: normal; color: var(--text-muted);">${t('connection.createdServersHint')}</span>
        </div>
        <div class="saved-servers-list" style="max-height: 220px;">
          ${createdServers.map((server) => {
            const isRunning = this.isHostedServerRunning && this.runningCreatedServerId === server.id;
            return `
              <div class="saved-server-item" style="cursor: default;" data-created-server-id="${escapeHtml(server.id)}">
                <div style="display: flex; flex-direction: column; overflow: hidden; min-width: 0;">
                  <span style="font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px;">
                    <span class="material-symbols-outlined md-16" style="color: ${isRunning ? 'var(--success)' : 'var(--accent-primary)'};">${isRunning ? 'radio_button_checked' : 'storage'}</span>
                    ${escapeHtml(server.name)}
                  </span>
                  <span style="font-size: 11px; color: var(--text-muted); margin-left: 22px;">${t('connection.portLabelValue', { port: server.port })}${server.password ? ` • ${t('connection.withPassword')}` : ` • ${t('connection.withoutPassword')}`}</span>
                  <span style="font-size: 11px; color: var(--text-muted); margin-left: 22px;">#${escapeHtml(server.textChannel)} • ${escapeHtml(server.voiceChannel)}</span>
                  <span style="font-size: 10px; color: ${isRunning ? 'var(--success)' : 'var(--text-muted)'}; margin-left: 22px; margin-top: 4px;">
                    ${isRunning ? t('connection.serverRunning') : t('connection.lastStarted', { date: escapeHtml(this.formatDateTime(server.lastStarted)) })}
                  </span>
                </div>
                <div style="display: flex; gap: 6px; align-items: center; margin-left: 10px; flex-shrink: 0;">
                  ${
                    isRunning
                      ? `
                        <button type="button" class="btn btn-danger btn-stop-created-server" data-created-server-id="${escapeHtml(server.id)}" style="padding: 2px 10px; font-size: 11px; height: 28px;">
                          ${t('connection.stop')}
                        </button>
                      `
                      : `
                        <button type="button" class="btn btn-start-created-server" data-created-server-id="${escapeHtml(server.id)}" style="padding: 2px 10px; font-size: 11px; height: 28px; background: var(--success); color: #fff; border: 1px solid var(--success);">
                          ${t('connection.start')}
                        </button>
                      `
                  }
                  <button type="button" class="btn-delete-saved-srv btn-remove-created-server" data-created-server-id="${escapeHtml(server.id)}" title="${t('connection.deleteSavedServer')}" style="color: var(--danger); background: rgba(242, 63, 67, 0.12);">
                    <span class="material-symbols-outlined md-16">close</span>
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  public render(): void {
    const savedNick = connectionStore.savedNickname || '';
    const savedServers = connectionStore.savedServers || [];
    const createdServers = connectionStore.createdServers || [];

    this.container.innerHTML = `
      <div class="connection-layout">
        <div class="connection-card">
          
          <button id="btn-open-settings" class="btn btn-secondary" title="${t('connection.settingsTitle')}" style="position: absolute; top: 12px; right: 12px; padding: 6px 8px; z-index: 2;">
            <span class="material-symbols-outlined md-18">settings</span>
          </button>

          <div class="brand-header" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; margin-bottom: 16px;">
            <img src="${logoUrl}" alt="Monky Logo" style="width: 200px; max-width: 70%; height: auto; max-height: 80px; object-fit: contain; filter: drop-shadow(0 4px 16px rgba(88, 101, 242, 0.4));">
            <div class="brand-logo" style="display: flex; align-items: center; justify-content: center; gap: 8px;">
              <span style="font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">Monky</span>
              <span class="brand-badge" style="font-size: 11px; padding: 2px 8px;">P2P</span>
            </div>
            <div class="brand-tagline" style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">${t('connection.tagline')}</div>
          </div>

          <div class="nav-tabs" style="margin-bottom: 14px;">
            <button id="tab-join" class="tab-button ${this.activeTab === 'join' ? 'active' : ''}">${t('connection.tabJoin')}</button>
            <button id="tab-host" class="tab-button ${this.activeTab === 'host' ? 'active' : ''}">${t('connection.tabHost')}</button>
          </div>

          <div id="error-banner" class="error-banner"></div>

          <!-- Avatar Picker -->
          <div class="avatar-picker" style="margin-bottom: 14px; gap: 12px;">
            <img id="avatar-preview" class="avatar-preview-img" style="width: 46px; height: 46px;" src="${getAvatarUrl(this.selectedAvatarBase64)}">
            <div>
              <button id="btn-select-avatar" class="btn btn-secondary" style="padding: 5px 10px; font-size: 11px;">
                <span class="material-symbols-outlined md-14" style="margin-right: 4px;">photo_camera</span>
                ${t('connection.choosePhoto')}
              </button>
              <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">${t('connection.photoHint')}</div>
            </div>
          </div>

          <!-- Tab 1: Join Server -->
          <form id="form-join" style="display: ${this.activeTab === 'join' ? 'block' : 'none'};">
            <div id="lan-discovery-section">
              ${this.getDiscoveredServersSectionHtml()}
            </div>

            ${
              !connectionStore.hasIdentity
                ? `
              <div style="margin-bottom: 14px; padding: 12px; border: 1px solid rgba(88, 101, 242, 0.35); border-radius: var(--radius-md); background: rgba(88, 101, 242, 0.08);">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; color: var(--text-primary); font-weight: 600;">
                  <span class="material-symbols-outlined md-18" style="color: var(--accent-primary);">manage_accounts</span>
                  ${t('identity.firstLaunchTitle')}
                </div>
                <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.45; margin-bottom: 10px;">
                  ${t('identity.firstLaunchHint')}
                </div>
                <button type="button" id="btn-import-existing-identity" class="btn btn-secondary" style="font-size: 12px;">
                  <span class="material-symbols-outlined md-16" style="margin-right: 4px;">qr_code_scanner</span>
                  ${t('identity.importAction')}
                </button>
              </div>
            `
                : ''
            }

            ${savedServers.length > 0 ? `
              <div class="saved-servers-container">
                <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
                  <span style="display: flex; align-items: center; gap: 4px;">
                    <span class="material-symbols-outlined md-14" style="color: var(--accent-primary);">bookmark</span>
                    ${t('connection.savedServersCount', { count: savedServers.length })}
                  </span>
                  <span style="font-size: 10px; font-weight: normal; color: var(--text-muted);">${t('connection.clickToSelect')}</span>
                </div>
                <div class="saved-servers-list">
                  ${savedServers.map((s) => {
                    const isSelected = this.selectedSavedHost === s.host && this.selectedSavedPort === s.port;
                    return `
                      <div class="saved-server-item ${isSelected ? 'selected' : ''}" data-host="${escapeHtml(s.host)}" data-port="${s.port}" data-password="${escapeHtml(s.password || '')}">
                        <div style="display: flex; flex-direction: column; overflow: hidden; pointer-events: none;">
                          <span style="font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px;">
                            <span class="server-status-dot" data-status="checking" data-host="${escapeHtml(s.host)}" data-port="${s.port}" title="${t('connection.checkingStatus')}"></span>
                            <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">dns</span>
                            ${escapeHtml(s.name || t('connection.serverFallbackName'))}
                          </span>
                          <span style="font-size: 11px; color: var(--text-muted); margin-left: 22px;">${escapeHtml(s.host)}:${s.port}</span>
                          <div class="saved-server-preview" data-host="${escapeHtml(s.host)}" data-port="${s.port}" style="margin-left: 22px; margin-top: 4px;"></div>
                        </div>
                        <div style="display: flex; gap: 6px; align-items: center;">
                          <button type="button" class="btn btn-secondary btn-select-saved" data-host="${escapeHtml(s.host)}" data-port="${s.port}" data-password="${escapeHtml(s.password || '')}" style="padding: 2px 8px; font-size: 11px; height: 24px;">
                            ${isSelected ? `✓ ${t('connection.selected')}` : t('connection.use')}
                          </button>
                          <button type="button" class="btn-delete-saved-srv" data-host="${escapeHtml(s.host)}" data-port="${s.port}" title="${t('connection.removeFromSaved')}">
                            <span class="material-symbols-outlined md-16">close</span>
                          </button>
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            ` : ''}

            <div class="form-group">
              <label>${t('connection.nicknameLabel')}</label>
              <input id="join-nickname" type="text" placeholder="${t('connection.nicknamePlaceholder')}" value="${escapeHtml(savedNick)}" required minlength="2" maxlength="32">
            </div>

            <div class="form-row">
              <div class="form-group" style="flex: 2;">
                <label>${t('connection.hostLabel')}</label>
                <input id="join-host" type="text" placeholder="${t('connection.hostPlaceholder')}" value="${this.selectedSavedHost || '127.0.0.1'}" required>
              </div>
              <div class="form-group small-col">
                <label>${t('connection.portLabel')}</label>
                <input id="join-port" type="number" placeholder="3000" value="${this.selectedSavedPort || 3000}" required min="1024" max="65535">
              </div>
            </div>

            <div class="form-group">
              <label>${t('connection.passwordLabel')}</label>
              <input id="join-password" type="password" placeholder="••••••••">
            </div>

            <button type="submit" id="btn-submit-join" class="btn btn-primary" style="width: 100%; margin-top: 8px;">
              <span class="material-symbols-outlined md-18" style="margin-right: 6px;">login</span>
              ${t('connection.tabJoin')}
            </button>
          </form>

          <!-- Tab 2: Meus Servidores -->
          <form id="form-host" style="display: ${this.activeTab === 'host' ? 'block' : 'none'};">
            ${this.getCreatedServersSectionHtml(createdServers)}

            <div id="host-create-toggle" style="margin-bottom: 10px;">
              <button type="button" id="btn-show-create-form" class="btn btn-secondary" style="width: 100%; padding: 8px 12px; font-size: 12px;">
                <span class="material-symbols-outlined md-18" style="margin-right: 6px;">add_circle</span>
                ${t('connection.createServer')}
              </button>
            </div>

            <div id="host-create-form-section" style="display: none;">
              <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 10px;">
                <span class="material-symbols-outlined md-14" style="color: var(--accent-primary);">add_circle</span>
                ${t('connection.createNewServer')}
              </div>

              <div style="background: rgba(88, 101, 242, 0.1); border: 1px solid rgba(88, 101, 242, 0.3); border-radius: var(--radius-md); padding: 10px 12px; font-size: 12px; color: var(--text-secondary); margin-bottom: 14px; line-height: 1.4; display: flex; gap: 8px; align-items: flex-start;">
                <span class="material-symbols-outlined md-18" style="color: var(--accent-primary); flex-shrink: 0; margin-top: 1px;">info</span>
                <div>
                  ${t('connection.howItWorks')}
                </div>
              </div>

              <div class="form-group">
                <label>${t('connection.hostNicknameLabel')}</label>
                <input id="host-nickname" type="text" placeholder="${t('connection.nicknamePlaceholder')}" value="${escapeHtml(savedNick)}" required minlength="2" maxlength="32">
              </div>

              <div class="form-group">
                <label>${t('connection.serverNameLabel')}</label>
                <input id="host-name" type="text" placeholder="${t('connection.serverNamePlaceholder')}" value="${t('connection.serverNameDefault')}" required minlength="2" maxlength="50">
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label>${t('connection.localPortLabel')}</label>
                  <input id="host-port" type="number" value="3000" required min="1024" max="65535">
                </div>
                <div class="form-group">
                  <label>${t('connection.accessPasswordLabel')}</label>
                  <input id="host-password" type="password" placeholder="${t('connection.optional')}">
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label>${t('connection.textChannelLabel')}</label>
                  <input id="host-text-channel" type="text" value="geral" required>
                </div>
                <div class="form-group">
                  <label>${t('connection.voiceChannelLabel')}</label>
                  <input id="host-voice-channel" type="text" value="Geral" required>
                </div>
              </div>

              <button type="submit" id="btn-submit-host" class="btn btn-primary" style="width: 100%; margin-top: 8px;">
                <span class="material-symbols-outlined md-18" style="margin-right: 6px;">add_circle</span>
                ${t('connection.createAndStart')}
              </button>
            </div>
          </form>

        </div>
      </div>
    `;

    this.attachEvents();
  }

  private async startHostedServer(server: CreatedServer, nickname: string): Promise<void> {
    connectionStore.saveUserProfile(nickname, this.selectedAvatarBase64);

    await this.syncHostedServerStatus();
    if (this.isHostedServerRunning && window.api?.hostServerStop) {
      const confirmed = await showConfirm({
        title: t('connection.serverAlreadyRunningTitle'),
        message: t('connection.serverAlreadyRunningMessage'),
        confirmLabel: t('connection.switchServer'),
        cancelLabel: t('common.cancel'),
        variant: 'warning',
      });
      if (!confirmed) return;

      const stopRes = await window.api.hostServerStop();
      if (!stopRes.success) {
        throw new Error(t('connection.stopCurrentServerError'));
      }

      this.isHostedServerRunning = false;
      this.runningCreatedServerId = null;
    }

    if (window.api?.hostServerStart) {
      const hostRes = await window.api.hostServerStart({
        port: server.port,
        serverName: server.name,
        password: server.password,
        initialTextChannel: server.textChannel,
        initialVoiceChannel: server.voiceChannel,
      });

      if (!hostRes.success) {
        throw new Error(hostRes.error || t('connection.startServerError'));
      }
    }

    const startedAt = Date.now();
    const updatedServer: CreatedServer = {
      ...server,
      lastStarted: startedAt,
    };
    connectionStore.saveCreatedServer(updatedServer);
    this.isHostedServerRunning = true;
    this.runningCreatedServerId = updatedServer.id;

    const identity = connectionStore.hasIdentity && connectionStore.clientId && connectionStore.publicKey
      ? { clientId: connectionStore.clientId, publicKey: connectionStore.publicKey }
      : await window.api.getIdentity();
    connectionStore.setIdentity(identity);

    await networkClient.connect('127.0.0.1', updatedServer.port, identity, nickname, updatedServer.password);

    if (this.selectedAvatarBase64) {
      try {
        await networkClient.sendRequest(MessageType.USER_UPDATE_AVATAR, {
          avatarBase64: this.selectedAvatarBase64,
          mimeType: 'image/png',
        });
      } catch (err) {}
    }

    connectionStore.addSavedServer({
      host: '127.0.0.1',
      port: updatedServer.port,
      name: updatedServer.name,
      password: updatedServer.password,
      lastConnected: startedAt,
    });

    await window.api?.maximizeWindow?.();
  }

  private async stopHostedServer(serverId?: string): Promise<void> {
    if (!window.api?.hostServerStop) return;

    const stopRes = await window.api.hostServerStop();
    if (!stopRes.success) {
      throw new Error(t('connection.stopServerError'));
    }

    this.isHostedServerRunning = false;
    if (!serverId || this.runningCreatedServerId === serverId) {
      this.runningCreatedServerId = null;
    }
  }

  private async removeCreatedServer(server: CreatedServer): Promise<void> {
    const needsStop = this.isHostedServerRunning && this.runningCreatedServerId === server.id;
    const confirmed = await showConfirm({
      title: t('connection.deleteSavedServer'),
      message: needsStop
        ? t('connection.deleteRunningServerMessage', { name: server.name })
        : t('connection.deleteServerMessage', { name: server.name }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      variant: 'danger',
    });
    if (!confirmed) return;

    if (needsStop) {
      await this.stopHostedServer(server.id);
    }

    connectionStore.removeCreatedServer(server.id);
    this.render();
  }

  private setupLanDiscoveryListeners(): void {
    if (!window.api?.onLanDiscoveryFound || !window.api?.onLanDiscoveryLost) return;

    window.api.onLanDiscoveryFound((server) => {
      this.discoveredServers.set(this.getDiscoveredServerKey(server.host, server.port), server);
      this.renderDiscoveredServersSection();
    });

    window.api.onLanDiscoveryLost((server) => {
      this.discoveredServers.delete(this.getDiscoveredServerKey(server.host, server.port));
      this.renderDiscoveredServersSection();
    });
  }

  private async loadServerPreviews(): Promise<void> {
    const nodes = Array.from(
      this.container.querySelectorAll('.saved-server-preview')
    ) as HTMLElement[];

    for (const node of nodes) {
      const host = node.getAttribute('data-host');
      const port = node.getAttribute('data-port');
      if (!host || !port) continue;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(`http://${host}:${port}/preview`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) {
          this.setServerStatusDot(host, port, 'offline');
          continue;
        }
        this.setServerStatusDot(host, port, 'online');
        const info = await res.json();
        this.renderServerPreview(node, host, port, info);
      } catch {
        // Server offline/unreachable — mark the indicator and leave the preview empty.
        this.setServerStatusDot(host, port, 'offline');
      }
    }
  }

  private setServerStatusDot(host: string, port: string, status: 'online' | 'offline'): void {
    const dot = this.container.querySelector(
      `.server-status-dot[data-host="${CSS.escape(host)}"][data-port="${CSS.escape(port)}"]`
    ) as HTMLElement | null;
    if (!dot) return;
    dot.setAttribute('data-status', status);
    dot.title = status === 'online' ? t('connection.serverOnline') : t('connection.serverOffline');
  }

  private renderServerPreview(
    node: HTMLElement,
    host: string,
    port: string,
    info: {
      userCount?: number;
      maxUsers?: number;
      users?: Array<{ nickname?: string; avatarUrl?: string }>;
    }
  ): void {
    const users = Array.isArray(info.users) ? info.users.slice(0, 5) : [];
    const count = typeof info.userCount === 'number' ? info.userCount : users.length;
    const max = typeof info.maxUsers === 'number' ? info.maxUsers : null;

    const avatars = users
      .map((u) => {
        const raw = u.avatarUrl && u.avatarUrl.startsWith('/avatars/')
          ? `http://${host}:${port}${u.avatarUrl}`
          : u.avatarUrl || getAvatarUrl(null);
        const title = escapeHtml(u.nickname || t('connection.unknownUser'));
        return `<img class="preview-avatar" src="${raw}" title="${title}" onerror="this.src='${getAvatarUrl(null)}'">`;
      })
      .join('');

    node.innerHTML = `
      <div class="server-preview-row">
        <div class="preview-avatars">${avatars}</div>
        <span class="preview-count">${count}${max ? `/${max}` : ''} ${t('connection.online')}</span>
      </div>
    `;
  }

  private getDiscoveredServersSectionHtml(): string {
    const servers = Array.from(this.discoveredServers.values()).sort((a, b) => {
      if (a.serverName !== b.serverName) {
        return a.serverName.localeCompare(b.serverName, 'pt-BR');
      }
      return a.host.localeCompare(b.host, 'pt-BR') || a.port - b.port;
    });

    return `
      <div class="saved-servers-container" style="margin-bottom: 14px;">
        <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
          <span style="display: flex; align-items: center; gap: 4px;">
            <span class="material-symbols-outlined md-14" style="color: #3ba55d;">wifi</span>
            ${t('connection.lanServersCount', { count: servers.length })}
          </span>
          <button type="button" id="btn-scan-lan" class="btn btn-secondary" style="padding: 2px 10px; font-size: 10px; height: 22px;">
            <span class="material-symbols-outlined md-14" style="margin-right: 3px;">radar</span>
            ${t('connection.scan')}
          </button>
        </div>
        ${servers.length > 0 ? `
          <div class="saved-servers-list">
            ${servers.map((server) => `
              <div class="saved-server-item">
                <div style="display: flex; flex-direction: column; overflow: hidden;">
                  <span style="font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px;">
                    <span title="${t('connection.discoveredOnLan')}" style="width: 9px; height: 9px; border-radius: 50%; background: #3ba55d; box-shadow: 0 0 0 2px rgba(59, 165, 93, 0.16); display: inline-block;"></span>
                    <span class="material-symbols-outlined md-16" style="color: #3ba55d;">lan</span>
                    ${escapeHtml(server.serverName)}
                  </span>
                  <span style="font-size: 11px; color: var(--text-muted); margin-left: 21px;">${escapeHtml(server.host)}:${server.port} • v${escapeHtml(server.version)}</span>
                </div>
                <button
                  type="button"
                  class="btn btn-primary btn-join-discovered-server"
                  data-host="${escapeHtml(server.host)}"
                  data-port="${server.port}"
                  style="padding: 2px 10px; font-size: 11px; height: 28px; flex-shrink: 0;"
                >
                  ${t('connection.join')}
                </button>
              </div>
            `).join('')}
          </div>
        ` : `
          <div style="padding: 8px 12px; border: 1px dashed rgba(255, 255, 255, 0.12); border-radius: var(--radius-md); color: var(--text-muted); font-size: 12px;">
            ${t('connection.scanHint', { button: t('connection.scan') })}
          </div>
        `}
      </div>
    `;
  }

  private renderDiscoveredServersSection(): void {
    const section = this.container.querySelector('#lan-discovery-section') as HTMLElement | null;
    if (!section) return;
    section.innerHTML = this.getDiscoveredServersSectionHtml();
    this.attachDiscoveredServerEvents();
  }

  private attachDiscoveredServerEvents(): void {
    const joinHostInput = document.getElementById('join-host') as HTMLInputElement | null;
    const joinPortInput = document.getElementById('join-port') as HTMLInputElement | null;
    const formJoin = document.getElementById('form-join') as HTMLFormElement | null;

    // Scan button — starts discovery for 5s then stops
    const scanBtn = this.container.querySelector('#btn-scan-lan') as HTMLButtonElement | null;
    scanBtn?.addEventListener('click', async () => {
      scanBtn.disabled = true;
      scanBtn.innerHTML = `<span class="material-symbols-outlined md-14" style="margin-right: 3px;">radar</span> ${t('connection.scanning')}`;
      this.discoveredServers.clear();
      this.renderDiscoveredServersSection();
      await window.api?.startLanDiscovery?.();
      setTimeout(async () => {
        await window.api?.stopLanDiscovery?.();
        const btn2 = this.container.querySelector('#btn-scan-lan') as HTMLButtonElement | null;
        if (btn2) {
          btn2.disabled = false;
          btn2.innerHTML = `<span class="material-symbols-outlined md-14" style="margin-right: 3px;">radar</span> ${t('connection.scan')}`;
        }
      }, 5000);
    });

    const buttons = this.container.querySelectorAll('.btn-join-discovered-server');
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const host = button.getAttribute('data-host');
        const port = button.getAttribute('data-port');
        if (!host || !port || !joinHostInput || !joinPortInput || !formJoin) return;

        joinHostInput.value = host;
        joinPortInput.value = port;
        this.selectedSavedHost = host;
        this.selectedSavedPort = parseInt(port, 10);
        formJoin.requestSubmit();
      });
    });
  }

  private async syncLanDiscoveryForActiveTab(): Promise<void> {
    // Discovery is manual now — only stop when leaving join tab
    if (this.activeTab !== 'join') {
      this.discoveredServers.clear();
      this.renderDiscoveredServersSection();
      await window.api?.stopLanDiscovery?.();
    }
  }

  private getDiscoveredServerKey(host: string, port: number): string {
    return `${host}:${port}`;
  }

  private async submitJoinForm(): Promise<void> {
    this.hideError();

    const nickname = (document.getElementById('join-nickname') as HTMLInputElement).value.trim();
    const host = (document.getElementById('join-host') as HTMLInputElement).value.trim();
    const port = parseInt((document.getElementById('join-port') as HTMLInputElement).value, 10);
    const password = (document.getElementById('join-password') as HTMLInputElement).value;

    connectionStore.saveUserProfile(nickname, this.selectedAvatarBase64);

    const btn = document.getElementById('btn-submit-join') as HTMLButtonElement;
    btn.disabled = true;
    btn.innerText = 'Conectando...';

    try {
      const identity = connectionStore.hasIdentity && connectionStore.clientId && connectionStore.publicKey
        ? { clientId: connectionStore.clientId, publicKey: connectionStore.publicKey }
        : await window.api.getIdentity();
      connectionStore.setIdentity(identity);

      const res = await networkClient.connect(host, port, identity, nickname, password);

      if (this.selectedAvatarBase64) {
        try {
          await networkClient.sendRequest(MessageType.USER_UPDATE_AVATAR, {
            avatarBase64: this.selectedAvatarBase64,
            mimeType: 'image/png',
          });
        } catch {}
      }

      connectionStore.addSavedServer({
        host,
        port,
        name: res.server.name,
        password: password || undefined,
        lastConnected: Date.now(),
      });

      await window.api?.stopLanDiscovery?.();
      await window.api?.maximizeWindow?.();
    } catch (err: any) {
      this.showError(err.message || t('connection.connectError'));
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<span class="material-symbols-outlined md-18" style="margin-right: 6px;">login</span> ${t('connection.tabJoin')}`;
    }
  }

  private attachEvents(): void {
    const tabJoin = document.getElementById('tab-join');
    const tabHost = document.getElementById('tab-host');
    const formJoin = document.getElementById('form-join') as HTMLFormElement;
    const formHost = document.getElementById('form-host') as HTMLFormElement;
    const btnSelectAvatar = document.getElementById('btn-select-avatar');
    const joinNickInput = document.getElementById('join-nickname') as HTMLInputElement;
    const hostNickInput = document.getElementById('host-nickname') as HTMLInputElement;
    const joinHostInput = document.getElementById('join-host') as HTMLInputElement;
    const joinPortInput = document.getElementById('join-port') as HTMLInputElement;
    const joinPassInput = document.getElementById('join-password') as HTMLInputElement;
    const startCreatedButtons = this.container.querySelectorAll('.btn-start-created-server');
    const stopCreatedButtons = this.container.querySelectorAll('.btn-stop-created-server');
    const removeCreatedButtons = this.container.querySelectorAll('.btn-remove-created-server');
    const importIdentityButton = document.getElementById('btn-import-existing-identity');

    // Sync and save nickname as user types
    const handleNickChange = (val: string) => {
      if (joinNickInput && joinNickInput.value !== val) joinNickInput.value = val;
      if (hostNickInput && hostNickInput.value !== val) hostNickInput.value = val;
      connectionStore.saveUserProfile(val, this.selectedAvatarBase64);
    };

    joinNickInput?.addEventListener('input', (e) => handleNickChange((e.target as HTMLInputElement).value));
    hostNickInput?.addEventListener('input', (e) => handleNickChange((e.target as HTMLInputElement).value));

    document.getElementById('btn-open-settings')?.addEventListener('click', (e) => {
      withButtonLoading(e.currentTarget as HTMLElement, () => settingsModal.open());
    });

    importIdentityButton?.addEventListener('click', async () => {
      const identity = await showIdentityImportDialog();
      if (!identity) return;
      connectionStore.setIdentity(identity);
      this.render();
      await showAlert({
        title: t('identity.importTitle'),
        message: t('identity.importSuccess'),
        variant: 'success',
      });
    });

    this.loadServerPreviews();
    this.attachDiscoveredServerEvents();
    void this.syncLanDiscoveryForActiveTab();

    // Toggle create server form visibility
    document.getElementById('btn-show-create-form')?.addEventListener('click', () => {
      const section = document.getElementById('host-create-form-section');
      const toggleBtn = document.getElementById('btn-show-create-form');
      if (section && toggleBtn) {
        const visible = section.style.display !== 'none';
        section.style.display = visible ? 'none' : 'block';
        toggleBtn.innerHTML = visible
          ? `<span class="material-symbols-outlined md-18" style="margin-right: 6px;">add_circle</span> ${t('connection.createServer')}`
          : `<span class="material-symbols-outlined md-18" style="margin-right: 6px;">close</span> ${t('common.cancel')}`;
      }
    });

    startCreatedButtons.forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        this.hideError();

        const serverId = btn.getAttribute('data-created-server-id');
        const server = connectionStore.createdServers.find((item) => item.id === serverId);
        const nickname = this.getHostNicknameValue();
        if (!server) return;

        if (nickname.length < 2) {
          this.showError(t('connection.hostNicknameRequired'));
          hostNickInput?.focus();
          return;
        }

        const button = btn as HTMLButtonElement;
        const originalHtml = button.innerHTML;
        button.disabled = true;
        button.textContent = 'Iniciando...';

        try {
          await this.startHostedServer(server, nickname);
          await window.api?.stopLanDiscovery?.();
        } catch (err: any) {
          this.render();
          this.showError(err.message || t('connection.startSavedServerError'));
          return;
        } finally {
          if (button.isConnected) {
            button.disabled = false;
            button.innerHTML = originalHtml;
          }
        }
      });
    });

    stopCreatedButtons.forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        this.hideError();

        const button = btn as HTMLButtonElement;
        const originalHtml = button.innerHTML;
        button.disabled = true;
        button.textContent = 'Parando...';

        try {
          await this.stopHostedServer(btn.getAttribute('data-created-server-id') || undefined);
          this.render();
        } catch (err: any) {
          this.showError(err.message || t('connection.stopServerError'));
          if (button.isConnected) {
            button.disabled = false;
            button.innerHTML = originalHtml;
          }
        }
      });
    });

    removeCreatedButtons.forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.hideError();

        const serverId = btn.getAttribute('data-created-server-id');
        const server = connectionStore.createdServers.find((item) => item.id === serverId);
        if (!server) return;

        try {
          await this.removeCreatedServer(server);
        } catch (err: any) {
          this.showError(err.message || t('connection.deleteServerError'));
        }
      });
    });

    // Handle clicking a saved server card
    const savedServerItems = this.container.querySelectorAll('.saved-server-item');
    savedServerItems.forEach((item) => {
      item.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.btn-delete-saved-srv')) return;

        const host = item.getAttribute('data-host');
        const port = parseInt(item.getAttribute('data-port') || '3000', 10);
        const pass = item.getAttribute('data-password') || '';

        if (host) {
          this.selectedSavedHost = host;
          this.selectedSavedPort = port;
          if (joinHostInput) joinHostInput.value = host;
          if (joinPortInput) joinPortInput.value = port.toString();
          if (joinPassInput && pass) joinPassInput.value = pass;

          savedServerItems.forEach((el) => el.classList.remove('selected'));
          item.classList.add('selected');
        }
      });
    });

    // Handle delete saved server button
    const deleteButtons = this.container.querySelectorAll('.btn-delete-saved-srv');
    deleteButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const host = btn.getAttribute('data-host');
        const port = parseInt(btn.getAttribute('data-port') || '3000', 10);
        if (host) {
          connectionStore.removeSavedServer(host, port);
          if (this.selectedSavedHost === host && this.selectedSavedPort === port) {
            this.selectedSavedHost = null;
            this.selectedSavedPort = null;
          }
          this.render();
        }
      });
    });

    tabJoin?.addEventListener('click', () => {
      this.activeTab = 'join';
      tabJoin.classList.add('active');
      tabHost?.classList.remove('active');
      formJoin.style.display = 'block';
      formHost.style.display = 'none';
      this.hideError();
      void this.syncLanDiscoveryForActiveTab();
    });

    tabHost?.addEventListener('click', () => {
      this.activeTab = 'host';
      tabHost.classList.add('active');
      tabJoin?.classList.remove('active');
      formHost.style.display = 'block';
      formJoin.style.display = 'none';
      this.hideError();
      void this.syncLanDiscoveryForActiveTab();
    });

    btnSelectAvatar?.addEventListener('click', async (e) => {
      e.preventDefault();
      if (window.api?.selectImageDialog) {
        const file = await window.api.selectImageDialog();
        if (file) {
          this.selectedAvatarBase64 = file.base64;
          const img = document.getElementById('avatar-preview') as HTMLImageElement;
          if (img) img.src = file.base64;
          const currentNick = joinNickInput?.value || hostNickInput?.value || connectionStore.savedNickname;
          connectionStore.saveUserProfile(currentNick, this.selectedAvatarBase64);
        }
      }
    });

    formJoin?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.submitJoinForm();
    });

    formHost?.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.hideError();

      const nickname = (document.getElementById('host-nickname') as HTMLInputElement).value.trim();
      const serverName = (document.getElementById('host-name') as HTMLInputElement).value.trim();
      const port = parseInt((document.getElementById('host-port') as HTMLInputElement).value, 10);
      const password = (document.getElementById('host-password') as HTMLInputElement).value;
      const initialText = (document.getElementById('host-text-channel') as HTMLInputElement).value.trim();
      const initialVoice = (document.getElementById('host-voice-channel') as HTMLInputElement).value.trim();

      connectionStore.saveUserProfile(nickname, this.selectedAvatarBase64);

      const btn = document.getElementById('btn-submit-host') as HTMLButtonElement;
      btn.disabled = true;
      btn.innerText = t('connection.startingServer');

      try {
        const now = Date.now();
        const existingServer = connectionStore.createdServers.find((server) =>
          server.name === serverName &&
          server.port === port &&
          (server.password || '') === password &&
          server.textChannel === initialText &&
          server.voiceChannel === initialVoice
        );
        const createdServer: CreatedServer = {
          id: existingServer?.id || this.createCreatedServerId(),
          name: serverName,
          port,
          password: password || undefined,
          textChannel: initialText,
          voiceChannel: initialVoice,
          createdAt: existingServer?.createdAt || now,
          lastStarted: now,
        };

        await this.startHostedServer(createdServer, nickname);
        await window.api?.stopLanDiscovery?.();
      } catch (err: any) {
        this.render();
        this.showError(err.message || t('connection.createServerError'));
      } finally {
        if (btn.isConnected) {
          btn.disabled = false;
          btn.innerHTML = `<span class="material-symbols-outlined md-18" style="margin-right: 6px;">add_circle</span> ${t('connection.createServerButton')}`;
        }
      }
    });
  }

  private showError(msg: string): void {
    const el = document.getElementById('error-banner');
    if (el) {
      el.innerText = msg;
      el.style.display = 'block';
    }
  }

  private hideError(): void {
    const el = document.getElementById('error-banner');
    if (el) {
      el.style.display = 'none';
      el.innerText = '';
    }
  }
}
