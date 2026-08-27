import { escapeHtml } from '../utils/html';
import { appEvents } from '../core/EventBus';
import { networkClient } from '../core/NetworkClient';
import { serverStore } from '../stores/serverStore';
import { connectionStore, SavedServer, CreatedServer } from '../stores/connectionStore';
import { audioProcessor } from '../core/AudioProcessor';
import { webRtcManager } from '../core/WebRtcManager';
import { showConfirm, showAlert } from './Dialog';
import { checkServerOnline, fetchServerPreview } from '../utils/serverStatus';
import { soundEffects } from '../core/SoundEffects';
import { getAvatarUrl, toAbsoluteServerIconUrl } from '../utils/avatar';
import { t } from '../i18n';

export class ServerRailView {
  public render(): void {
    const railEl = document.getElementById('server-rail');
    if (!railEl) return;

    const currentUrl = networkClient.getCurrentServerUrl();
    const saved = connectionStore.savedServers || [];

    const serverButtons = saved.map((srv) => {
      const url = `ws://${srv.host.trim().replace(/^wss?:\/\//, '')}:${srv.port}`;
      const isCurrent = url === currentUrl;
      const initial = (srv.name || srv.host || '?').trim().charAt(0).toUpperCase();
      const iconUrl = isCurrent && serverStore.serverDetails?.iconUrl ? serverStore.serverDetails.iconUrl : srv.iconUrl;
      return `
        <div class="server-rail-item ${isCurrent ? 'active' : ''}">
          <span class="server-rail-pill" aria-hidden="true"></span>
          <button class="server-rail-avatar ${isCurrent ? 'active' : ''}" data-host="${escapeHtml(srv.host)}" data-port="${srv.port}" title="${escapeHtml(srv.name || `${srv.host}:${srv.port}`)}" style="padding: 0;">
            ${iconUrl ? `<img src="${getAvatarUrl(iconUrl)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: inherit; display: block;">` : `<span>${escapeHtml(initial)}</span>`}
            <span class="server-rail-status-dot" data-status="${isCurrent ? 'online' : 'checking'}"></span>
          </button>
        </div>
      `;
    }).join('');

    railEl.innerHTML = `
      <button class="server-rail-home" id="server-rail-home" title="${t('main.homeTitle')}">
        <span class="material-symbols-outlined md-22">home</span>
      </button>
      <div class="server-rail-divider"></div>
      <div class="server-rail-list">
        ${serverButtons}
      </div>
    `;

    railEl.querySelector('#server-rail-home')?.addEventListener('click', async () => {
      const confirmed = await showConfirm({
        title: t('main.backHomeTitle'),
        message: t('main.backHomeMessage'),
        confirmLabel: t('main.backHomeTitle'),
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
        if (target) void this.connectToSavedServer(target);
      });
    });

    void this.refreshServerRailStatuses();
  }

  public async refreshServerRailStatuses(): Promise<void> {
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
        const preview = await fetchServerPreview(host, port);
        const online = preview !== null;
        dot.setAttribute('data-status', online ? 'online' : 'offline');
        const baseTitle = btn.getAttribute('title')?.split(' • ')[0] || '';
        btn.title = `${baseTitle} • ${online ? t('main.statusOnline') : t('main.statusOffline')}`;

        // Pick up the icon of servers the user never connected to (#312). Only
        // persist on change, otherwise the resulting re-render loops forever.
        if (!preview) return;
        const absolute = toAbsoluteServerIconUrl(host, port, preview.iconUrl);
        const saved = (connectionStore.savedServers || []).find(
          (s) => s.host === host && s.port === port
        );
        if (saved && absolute && absolute !== saved.iconUrl) {
          connectionStore.updateSavedServerIcon(host, port, absolute);
        }
      })
    );
  }

  /**
   * Returns the created-server entry backing a saved server, when the user is the
   * one hosting it (created servers always run on this machine).
   */
  private findCreatedServer(server: SavedServer): CreatedServer | null {
    const host = server.host.trim().replace(/^wss?:\/\//, '');
    const isLocal = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    if (!isLocal) return null;
    return (connectionStore.createdServers || []).find((c) => c.port === server.port) || null;
  }

  private async connectToSavedServer(server: SavedServer): Promise<void> {
    const targetUrl = `ws://${server.host.trim().replace(/^wss?:\/\//, '')}:${server.port}`;
    if (targetUrl === networkClient.getCurrentServerUrl()) return;

    // Probe before tearing anything down: the old flow disconnected first, so a
    // failed connection dumped the user back on the home screen (#312).
    const online = await checkServerOnline(server.host, server.port);
    const mine = this.findCreatedServer(server);
    const label = server.name || server.host;

    if (!online && !mine) {
      await showAlert({
        title: t('main.serverOfflineTitle'),
        message: t('main.serverOfflineMessage', { name: label }),
      });
      return;
    }

    const confirmed = await showConfirm({
      title: online ? t('main.switchServerTitle') : t('main.serverOfflineStartTitle'),
      message: online
        ? t('main.switchServerMessage', { name: label })
        : t('main.serverOfflineStartMessage', { name: label }),
      confirmLabel: online ? t('main.connect') : t('main.serverOfflineStartConfirm'),
      variant: 'warning',
    });
    if (!confirmed) return;

    // Tear the session down *before* touching the hosted server: startOwnServer may
    // stop the very server we are connected to, and a socket that dies while
    // `manualDisconnect` is false schedules an endless reconnect to a server that
    // is never coming back (#312).
    audioProcessor.stopMicrophone();
    webRtcManager.closeAllPeers();
    networkClient.disconnect();

    if (!online && mine) {
      const started = await this.startOwnServer(mine);
      if (!started) return;
    }

    try {
      const identity = connectionStore.hasIdentity && connectionStore.clientId && connectionStore.publicKey
        ? { clientId: connectionStore.clientId, publicKey: connectionStore.publicKey }
        : await window.api.getIdentity();
      connectionStore.setIdentity(identity);
      const nickname = connectionStore.savedNickname || t('connection.unknownUser');
      const res = await networkClient.connect(server.host, server.port, identity, nickname, server.password);
      connectionStore.addSavedServer({
        host: server.host,
        port: server.port,
        name: res.server.name,
        password: server.password,
        lastConnected: Date.now(),
      });
    } catch (err: any) {
      appEvents.emit('network.disconnected');
    }
  }

  /** Boots one of the user's own servers so they can hop straight into it (#312). */
  private async startOwnServer(created: CreatedServer): Promise<boolean> {
    if (!window.api?.hostServerStart) return false;

    try {
      const status = await window.api.hostServerStatus?.();
      if (status?.isRunning) {
        await window.api.hostServerStop?.();
      }

      const res = await window.api.hostServerStart({
        port: created.port,
        serverName: created.name,
        password: created.password,
        initialTextChannel: created.textChannel,
        initialVoiceChannel: created.voiceChannel,
      });

      if (!res.success) {
        await showAlert({
          title: t('main.serverStartFailedTitle'),
          message: res.error || t('main.serverStartFailedMessage'),
        });
        return false;
      }

      connectionStore.saveCreatedServer({ ...created, lastStarted: Date.now() });
      return true;
    } catch (err: any) {
      await showAlert({
        title: t('main.serverStartFailedTitle'),
        message: err?.message || t('main.serverStartFailedMessage'),
      });
      return false;
    }
  }
}

export const serverRailView = new ServerRailView();
