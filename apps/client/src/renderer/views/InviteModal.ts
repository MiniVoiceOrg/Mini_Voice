import { MessageType, ServerInviteInfoPayload, ServerNetworkInterface } from '@monky/shared';
import { networkClient } from '../core/NetworkClient';
import { serverStore } from '../stores/serverStore';
import { connectionStore } from '../stores/connectionStore';
import { escapeHtml } from '../utils/html';
import { enableBackdropClose } from '../utils/modal';
import { t } from '../i18n';

export class InviteModal {
  private modalEl: HTMLElement | null = null;
  private selectedIp: string = '';
  private selectedPort: number = 3000;
  private serverName: string = 'Monky';
  private networkInterfaces: ServerNetworkInterface[] = [];
  private isLoading = true;

  public async open(): Promise<void> {
    this.close();

    this.serverName = serverStore.serverDetails?.name || 'Monky';
    this.selectedPort = this.getFallbackPort();
    this.selectedIp = this.getFallbackHost();
    this.isLoading = true;
    this.networkInterfaces = [];

    const currentUrl = networkClient.getCurrentServerUrl();
    let defaultPassword = '';
    if (currentUrl) {
      try {
        const parsed = new URL(currentUrl);
        const host = parsed.hostname;
        const port = parsed.port ? parseInt(parsed.port, 10) : 3000;
        const found = connectionStore.savedServers.find((s) => s.host === host && s.port === port);
        if (found?.password) defaultPassword = found.password;
      } catch {}
    }

    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-backdrop';
    this.modalEl.innerHTML = `
      <div class="modal-card" style="max-width: 520px;">
        <div class="modal-header">
          <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
            <span class="material-symbols-outlined" style="color: var(--accent-primary);">person_add</span>
            <span>${t('invite.title')}</span>
          </div>
          <button id="modal-close" class="modal-close-btn">&times;</button>
        </div>

        <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.5;">
          ${t('invite.intro', { tab: t('connection.tabJoin') })}
        </div>

        <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 16px; display: flex; flex-direction: column; gap: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13px;">
            <span style="color: var(--text-muted); font-weight: 500;">${t('invite.serverLabel')}</span>
            <span style="font-weight: 700; color: var(--text-primary);">${escapeHtml(this.serverName)}</span>
          </div>

          <div class="form-group" style="margin-bottom: 0;">
            <label style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 12px;">
              <span>${t('invite.ipLabel')}</span>
              <span id="invite-loading-tag" style="font-size: 11px; color: var(--accent-primary); display: flex; align-items: center; gap: 4px;">
                <span class="material-symbols-outlined md-14" style="animation: spin 1s linear infinite;">autorenew</span>
                ${t('invite.fetchingIps')}
              </span>
            </label>
            <select id="select-invite-ip" style="width: 100%; font-size: 13px; padding: 8px 10px;">
              <option value="${this.selectedIp}">${t('invite.loadingIps')}</option>
            </select>
          </div>

          <div id="custom-ip-container" style="display: none; margin-top: -4px;">
            <input id="input-custom-ip" type="text" placeholder="${t('invite.customIpPlaceholder')}" style="width: 100%; font-size: 12px; padding: 6px 10px;">
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13px; border-top: 1px solid var(--border-color); padding-top: 10px; margin-top: 2px;">
            <span style="color: var(--text-muted); font-weight: 500;">${t('invite.portLabel')}</span>
            <span id="invite-port" style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-primary); font-size: 14px;">${this.selectedPort}</span>
          </div>

          <!-- Password Option -->
          <div style="border-top: 1px solid var(--border-color); padding-top: 10px; margin-top: 2px; display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
              <label for="chk-invite-password" style="font-size: 12px; font-weight: 500; color: var(--text-primary); cursor: pointer; user-select: none;">${t('invite.includePassword')}</label>
              <label class="toggle-switch" aria-label="${t('invite.includePassword')}">
                <input id="chk-invite-password" type="checkbox" ${defaultPassword ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div id="invite-password-container" style="${defaultPassword ? 'display: block;' : 'display: none;'}">
              <input id="input-invite-password" type="text" value="${escapeHtml(defaultPassword)}" placeholder="${t('invite.passwordPlaceholder')}" style="width: 100%; font-size: 12px; padding: 6px 10px;">
            </div>
          </div>
        </div>

        <!-- Explanatory Notice -->
        <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 10px 12px; font-size: 11px; color: var(--text-muted); line-height: 1.4;">
          ${t('invite.notice')}
        </div>

        <!-- Dynamic Context Tip Box -->
        <div id="invite-tip-box" style="background: rgba(88, 101, 242, 0.1); border: 1px solid rgba(88, 101, 242, 0.3); border-radius: var(--radius-md); padding: 10px 12px; font-size: 11px; color: var(--text-secondary); line-height: 1.4; display: flex; gap: 8px; align-items: flex-start;">
          <span class="material-symbols-outlined md-16" style="color: var(--accent-primary); flex-shrink: 0; margin-top: 1px;">info</span>
          <div id="invite-tip-text">
            ${t('invite.tip')}
          </div>
        </div>

        <div id="copy-success-msg" style="display: none; font-size: 12px; color: var(--success); text-align: center; font-weight: 500;">
          <span class="material-symbols-outlined md-14" style="vertical-align: middle; margin-right: 4px;">check_circle</span>
          ${t('invite.copied')}
        </div>

        <div class="modal-footer">
          <button id="btn-copy-invite" class="btn btn-primary" style="width: 100%; font-size: 13px; padding: 10px 16px; display: flex; align-items: center; justify-content: center; gap: 8px;">
            <span class="material-symbols-outlined md-18">content_copy</span>
            <span>${t('invite.copyButton')}</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(this.modalEl);
    this.attachEvents();
    await this.fetchServerInviteInfo();
  }

  private getFallbackHost(): string {
    const url = networkClient.getCurrentServerUrl();
    if (url) {
      try {
        const parsed = new URL(url);
        return parsed.hostname || '127.0.0.1';
      } catch {}
    }
    return '127.0.0.1';
  }

  private getFallbackPort(): number {
    const url = networkClient.getCurrentServerUrl();
    if (url) {
      try {
        const parsed = new URL(url);
        if (parsed.port) return parseInt(parsed.port, 10);
      } catch {}
    }
    return 3000;
  }

  private async fetchServerInviteInfo(): Promise<void> {
    try {
      // 1. Try WebSocket request
      let info: ServerInviteInfoPayload | null = null;
      try {
        info = await networkClient.sendRequest<ServerInviteInfoPayload>(
          MessageType.SERVER_GET_INVITE_INFO,
          {},
          undefined,
          4000
        );
      } catch {
        // 2. Fallback to HTTP endpoint
        const httpBase = networkClient.getHttpBaseUrl();
        if (httpBase) {
          const res = await fetch(`${httpBase}/invite-info`);
          if (res.ok) {
            info = await res.json();
          }
        }
      }

      if (info && info.networkInterfaces && info.networkInterfaces.length > 0) {
        this.networkInterfaces = info.networkInterfaces;
        if (info.port) this.selectedPort = info.port;
        if (info.serverName) this.serverName = info.serverName;
        this.renderInterfaceOptions();
        return;
      }
    } catch (e) {
      console.warn('[InviteModal] Could not fetch server network interfaces, falling back to local detection', e);
    }

    // Fallback: build default options with connected host
    const fallbackHost = this.getFallbackHost();
    this.networkInterfaces = [
      {
        name: t('invite.connectedServer'),
        address: fallbackHost,
        family: 'IPv4',
        type: fallbackHost === '127.0.0.1' || fallbackHost === 'localhost' ? 'loopback' : 'lan',
        description: t('invite.connectedIpDesc', { host: fallbackHost }),
      },
    ];
    this.renderInterfaceOptions();
  }

  private renderInterfaceOptions(): void {
    if (!this.modalEl) return;

    const selectEl = this.modalEl.querySelector('#select-invite-ip') as HTMLSelectElement | null;
    const portEl = this.modalEl.querySelector('#invite-port') as HTMLElement | null;
    const loadingTag = this.modalEl.querySelector('#invite-loading-tag') as HTMLElement | null;

    if (loadingTag) loadingTag.style.display = 'none';
    if (portEl) portEl.textContent = String(this.selectedPort);

    if (!selectEl) return;

    selectEl.innerHTML = '';

    // Group interfaces by type for clear selection
    const getIconForType = (type: string) => {
      switch (type) {
        case 'public': return '🌐 ';
        case 'vpn': return '🔒 ';
        case 'lan': return '🏠 ';
        default: return '💻 ';
      }
    };

    let firstIp = '';

    for (const iface of this.networkInterfaces) {
      if (!firstIp) firstIp = iface.address;
      const opt = document.createElement('option');
      opt.value = iface.address;
      opt.setAttribute('data-type', iface.type);
      opt.setAttribute('data-desc', iface.description);
      opt.textContent = `${getIconForType(iface.type)} ${iface.address} — ${iface.description}`;
      selectEl.appendChild(opt);
    }

    // Add Custom IP option
    const optCustom = document.createElement('option');
    optCustom.value = '__custom__';
    optCustom.setAttribute('data-type', 'custom');
    optCustom.textContent = `✏️ ${t('invite.customOption')}`;
    selectEl.appendChild(optCustom);

    this.selectedIp = firstIp || this.getFallbackHost();
    selectEl.value = this.selectedIp;
    this.updateTip(this.selectedIp);
  }

  private updateTip(selectedAddress: string): void {
    if (!this.modalEl) return;

    const tipText = this.modalEl.querySelector('#invite-tip-text') as HTMLElement | null;
    if (!tipText) return;

    const iface = this.networkInterfaces.find((i) => i.address === selectedAddress);
    const type = iface ? iface.type : 'custom';

    switch (type) {
      case 'public':
        tipText.innerHTML = t('invite.tipPublic', { port: this.selectedPort });
        break;
      case 'vpn':
        tipText.innerHTML = t('invite.tipVpn');
        break;
      case 'lan':
        tipText.innerHTML = t('invite.tipLan');
        break;
      case 'loopback':
        tipText.innerHTML = t('invite.tipLoopback');
        break;
      default:
        tipText.innerHTML = t('invite.tipCustom', { port: this.selectedPort });
        break;
    }
  }

  private attachEvents(): void {
    if (!this.modalEl) return;

    const btnClose = this.modalEl.querySelector('#modal-close');
    const btnCopy = this.modalEl.querySelector('#btn-copy-invite');
    const selectIp = this.modalEl.querySelector('#select-invite-ip') as HTMLSelectElement | null;
    const customContainer = this.modalEl.querySelector('#custom-ip-container') as HTMLElement | null;
    const inputCustomIp = this.modalEl.querySelector('#input-custom-ip') as HTMLInputElement | null;
    const chkPassword = this.modalEl.querySelector('#chk-invite-password') as HTMLInputElement | null;
    const passwordContainer = this.modalEl.querySelector('#invite-password-container') as HTMLElement | null;
    const inputPassword = this.modalEl.querySelector('#input-invite-password') as HTMLInputElement | null;
    const copyMsg = this.modalEl.querySelector('#copy-success-msg') as HTMLElement | null;

    btnClose?.addEventListener('click', () => this.close());
    enableBackdropClose(this.modalEl, () => this.close());

    chkPassword?.addEventListener('change', () => {
      if (passwordContainer) {
        passwordContainer.style.display = chkPassword.checked ? 'block' : 'none';
        if (chkPassword.checked) inputPassword?.focus();
      }
    });

    selectIp?.addEventListener('change', () => {
      if (selectIp.value === '__custom__') {
        if (customContainer) customContainer.style.display = 'block';
        inputCustomIp?.focus();
        this.selectedIp = inputCustomIp?.value.trim() || '';
      } else {
        if (customContainer) customContainer.style.display = 'none';
        this.selectedIp = selectIp.value;
      }
      this.updateTip(this.selectedIp);
    });

    inputCustomIp?.addEventListener('input', () => {
      this.selectedIp = inputCustomIp.value.trim();
      this.updateTip(this.selectedIp);
    });

    const triggerCopyFeedback = (text: string) => {
      if (copyMsg) {
        copyMsg.innerHTML = `<span class="material-symbols-outlined md-14" style="vertical-align: middle; margin-right: 4px;">check_circle</span> ${text}`;
        copyMsg.style.display = 'block';
        setTimeout(() => {
          if (copyMsg) copyMsg.style.display = 'none';
        }, 3000);
      }
    };

    btnCopy?.addEventListener('click', async () => {
      const host = this.selectedIp || this.getFallbackHost();
      const includePass = chkPassword?.checked;
      const passValue = inputPassword?.value.trim() || '';
      const passwordLine = includePass && passValue ? t('invite.clipboardPassword', { password: passValue }) : '';

      const textToCopy = t('invite.clipboardText', {
        server: this.serverName,
        host,
        port: this.selectedPort,
        passwordLine,
        tab: t('connection.tabJoin'),
      });

      try {
        await navigator.clipboard.writeText(textToCopy);
        triggerCopyFeedback(t('invite.copied'));
      } catch (err) {
        console.warn('Could not copy to clipboard', err);
      }
    });
  }

  public close(): void {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }
}

export const inviteModal = new InviteModal();
