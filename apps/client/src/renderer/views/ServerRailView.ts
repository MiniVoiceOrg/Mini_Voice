import { escapeHtml } from '../utils/html';
import { appEvents } from '../core/EventBus';
import { networkClient } from '../core/NetworkClient';
import { serverStore } from '../stores/serverStore';
import { connectionStore, SavedServer } from '../stores/connectionStore';
import { audioProcessor } from '../core/AudioProcessor';
import { webRtcManager } from '../core/WebRtcManager';
import { showConfirm } from './Dialog';
import { checkServerOnline } from '../utils/serverStatus';
import { soundEffects } from '../core/SoundEffects';
import { getAvatarUrl } from '../utils/avatar';
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
      const iconUrl = isCurrent && serverStore.serverDetails?.iconUrl ? serverStore.serverDetails.iconUrl : (srv as any).iconUrl;
      return `
        <div class="server-rail-item ${isCurrent ? 'active' : ''}">
          <span class="server-rail-pill" aria-hidden="true"></span>
          <button class="server-rail-avatar ${isCurrent ? 'active' : ''}" data-host="${escapeHtml(srv.host)}" data-port="${srv.port}" title="${escapeHtml(srv.name || `${srv.host}:${srv.port}`)}" style="overflow: hidden; padding: 0;">
            ${iconUrl ? `<img src="${getAvatarUrl(iconUrl)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: inherit;">` : `<span>${escapeHtml(initial)}</span>`}
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
        const online = await checkServerOnline(host, port);
        dot.setAttribute('data-status', online ? 'online' : 'offline');
        const baseTitle = btn.getAttribute('title')?.split(' • ')[0] || '';
        btn.title = `${baseTitle} • ${online ? t('main.statusOnline') : t('main.statusOffline')}`;
      })
    );
  }

  private async connectToSavedServer(server: SavedServer): Promise<void> {
    const targetUrl = `ws://${server.host.trim().replace(/^wss?:\/\//, '')}:${server.port}`;
    if (targetUrl === networkClient.getCurrentServerUrl()) return;

    const confirmed = await showConfirm({
      title: t('main.switchServerTitle'),
      message: t('main.switchServerMessage', { name: server.name || server.host }),
      confirmLabel: t('main.connect'),
      variant: 'warning',
    });
    if (!confirmed) return;

    audioProcessor.stopMicrophone();
    webRtcManager.closeAllPeers();
    networkClient.disconnect();

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
}

export const serverRailView = new ServerRailView();
