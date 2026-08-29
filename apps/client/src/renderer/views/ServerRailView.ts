import { escapeHtml } from '../utils/html';
import { appEvents } from '../core/EventBus';
import { networkClient } from '../core/NetworkClient';
import { sessionManager, sessionKeyFor } from '../core/SessionManager';
import { openServerSession, showServerSession } from '../core/serverConnection';
import { voiceStore } from '../stores/voiceStore';
import { connectionStore, SavedServer, CreatedServer } from '../stores/connectionStore';
import { audioProcessor } from '../core/AudioProcessor';
import { webRtcManager } from '../core/WebRtcManager';
import { showConfirm, showAlert } from './Dialog';
import { checkServerOnline, fetchServerPreview } from '../utils/serverStatus';
import {
  captureHostedServerLeaveState,
  confirmStopHostedServer,
  promptShutdownAfterLeave,
} from '../utils/hostedServer';
import { soundEffects } from '../core/SoundEffects';
import { toAbsoluteServerIconUrl } from '../utils/avatar';
import { t } from '../i18n';

export class ServerRailView {
  /**
   * Server the user is currently connecting to, as `host:port`. Kept on the view
   * (instead of poked straight into the DOM) because `render()` runs again on
   * network events and would wipe any attribute set by hand (#332).
   */
  private connectingKey: string | null = null;

  private static keyOf(host: string, port: number): string {
    return `${host.trim().replace(/^wss?:\/\//, '')}:${port}`;
  }

  public render(): void {
    const railEl = document.getElementById('server-rail');
    if (!railEl) return;

    // The active key (not the proxied client) is what identifies the server on
    // screen: during a background event the proxy points elsewhere (#400).
    const currentUrl = sessionManager.getActiveKey();
    const saved = connectionStore.savedServers || [];
    const busy = this.connectingKey !== null;

    const serverButtons = saved.map((srv) => {
      const url = `ws://${srv.host.trim().replace(/^wss?:\/\//, '')}:${srv.port}`;
      const isCurrent = url === currentUrl;
      const isConnecting = this.connectingKey === ServerRailView.keyOf(srv.host, srv.port);
      // Servers kept connected while the user looks elsewhere (#400): they may
      // be hosting the call or have collected messages meanwhile. A session that
      // is merely retrying does not count as online.
      const live = sessionManager.get(url);
      const background = !isCurrent && live?.client.getStatus() === 'CONNECTED' ? live : undefined;
      const hasCall = voiceStore.voiceSessionKey === url;
      const hasUnread = !!background?.chatStore.hasAnyUnread();
      const initial = (srv.name || srv.host || '?').trim().charAt(0).toUpperCase();
      // Read from the session that owns this row, never from the proxied store:
      // a render triggered inside a background event would otherwise paint that
      // server's icon on whichever row is current (#400). Relative paths are
      // resolved against that same session's host, never the visible one (#312).
      const liveIcon = live?.serverStore.serverDetails?.iconUrl;
      const liveBase = live?.client.getHttpBaseUrl();
      const resolvedLiveIcon = liveIcon?.startsWith('/') ? (liveBase ? `${liveBase}${liveIcon}` : null) : liveIcon;
      const iconUrl = resolvedLiveIcon || srv.iconUrl;
      const label = srv.name || `${srv.host}:${srv.port}`;
      const title = isConnecting
        ? t('main.connectingTo', { name: label })
        : hasCall && !isCurrent
          ? t('main.serverHostingCall', { name: label })
          : label;
      const badge = hasCall
        ? `<span class="server-rail-badge" data-kind="call" title="${escapeHtml(t('main.callHereTooltip'))}"><span class="material-symbols-outlined md-14">graphic_eq</span></span>`
        : hasUnread
          ? `<span class="server-rail-badge" data-kind="unread" title="${escapeHtml(t('main.unreadHereTooltip'))}"></span>`
          : '';
      return `
        <div class="server-rail-item ${isCurrent ? 'active' : ''}">
          <span class="server-rail-pill" aria-hidden="true"></span>
          <button class="server-rail-avatar ${isCurrent ? 'active' : ''}" data-host="${escapeHtml(srv.host)}" data-port="${srv.port}" title="${escapeHtml(title)}" ${isConnecting ? 'data-loading="1" aria-busy="true"' : ''} ${busy ? 'disabled' : ''} style="padding: 0;">
            ${iconUrl ? `<img src="${escapeHtml(iconUrl)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: inherit; display: block;">` : `<span>${escapeHtml(initial)}</span>`}
            <span class="server-rail-status-dot" data-status="${isCurrent || background ? 'online' : 'checking'}"></span>
            ${badge}
          </button>
        </div>
      `;
    }).join('');

    railEl.innerHTML = `
      <button class="server-rail-home" id="server-rail-home" title="${t('main.homeTitle')}" ${busy ? 'disabled' : ''}>
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
      // Captured before the socket closes: afterwards there is no way to tell
      // whether this user was hosting the server they just left (#334).
      const leaveState = await captureHostedServerLeaveState();
      soundEffects.play('leave_voice');
      audioProcessor.stopMicrophone();
      webRtcManager.closeAllPeers();
      // Going home means leaving everything, including servers kept alive in
      // the background for an ongoing call (#400).
      sessionManager.removeAll();
      if (leaveState) await promptShutdownAfterLeave(leaveState);
    });

    railEl.querySelectorAll('.server-rail-avatar').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.connectingKey) return;
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
        // Leave the button being connected to alone: its dot is hidden behind the
        // spinner and rewriting the title would clobber the progress text (#332).
        if (btn.getAttribute('aria-busy') === 'true') return;
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

  /** Flags the rail as busy and repaints it, so the click has a visible effect (#332). */
  private setConnecting(key: string | null): void {
    if (this.connectingKey === key) return;
    this.connectingKey = key;
    this.render();
  }

  private async connectToSavedServer(server: SavedServer): Promise<void> {
    const targetUrl = sessionKeyFor(server.host, server.port);
    if (targetUrl === sessionManager.getActiveKey()) return;
    if (this.connectingKey) return;

    // Already connected in the background: switching back is just repointing
    // the views at the state that was kept alive (#400). No probe, no
    // confirmation, no reconnection.
    if (showServerSession(targetUrl)) return;

    // Everything below is async and used to happen with no feedback at all: the
    // online probe alone can hang for 2.5s before the confirmation even shows up
    // (#332). Hold the busy state for the whole attempt and always clear it.
    this.setConnecting(ServerRailView.keyOf(server.host, server.port));
    try {
      await this.runConnectToSavedServer(server);
    } finally {
      this.setConnecting(null);
    }
  }

  private async runConnectToSavedServer(server: SavedServer): Promise<void> {
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

    // Connecting to another server no longer costs anything: the current one
    // stays connected in the background (#400). Only the destructive path —
    // booting one of our own servers, which may stop the one we are on — still
    // asks for confirmation.
    if (!online && mine) {
      const confirmed = await showConfirm({
        title: t('main.serverOfflineStartTitle'),
        message: t('main.serverOfflineStartMessage', { name: label }),
        confirmLabel: t('main.serverOfflineStartConfirm'),
        variant: 'warning',
      });
      if (!confirmed) return;

      // Booting one of our own servers may stop the very server we are talking
      // to, and a socket that dies while `manualDisconnect` is false schedules
      // an endless reconnect to a server that is never coming back (#312). This
      // is the one path that still has to close the current session up front.
      audioProcessor.stopMicrophone();
      webRtcManager.closeAllPeers();
      sessionManager.removeAll();

      const started = await this.startOwnServer(mine);
      if (!started) return;
    }

    try {
      const identity = connectionStore.hasIdentity && connectionStore.clientId && connectionStore.publicKey
        ? { clientId: connectionStore.clientId, publicKey: connectionStore.publicKey }
        : await window.api.getIdentity();
      connectionStore.setIdentity(identity);
      const nickname = connectionStore.savedNickname || t('connection.unknownUser');
      const res = await openServerSession(server.host, server.port, identity, nickname, server.password);
      connectionStore.addSavedServer({
        host: server.host,
        port: server.port,
        name: res.server.name,
        password: server.password,
        lastConnected: Date.now(),
      });
    } catch (err: any) {
      // The failed session was already dropped and the previous server restored
      // by `openServerSession`. Emitting a global disconnect here would tear
      // down that still-healthy server and dump the user on the home screen
      // (#400) — showing the error is enough.
      await showAlert({
        title: t('main.serverOfflineTitle'),
        message: err?.message || t('main.serverOfflineMessage', { name: server.name || server.host }),
      });
    }
  }

  /** Boots one of the user's own servers so they can hop straight into it (#312). */
  private async startOwnServer(created: CreatedServer): Promise<boolean> {
    if (!window.api?.hostServerStart) return false;

    try {
      const status = await window.api.hostServerStatus?.();
      if (status?.isRunning) {
        // Somebody else may be on the server that is about to be replaced (#334).
        if (!(await confirmStopHostedServer())) return false;
        await window.api.hostServerStop?.();
      }

      const res = await window.api.hostServerStart({
        port: created.port,
        serverName: created.name,
        password: created.password,
        initialTextChannel: created.textChannel,
        initialVoiceChannel: created.voiceChannel,
        serverId: created.id,
        maxUsers: created.maxUsers,
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
