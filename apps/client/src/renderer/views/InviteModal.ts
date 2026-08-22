import { serverStore } from '../stores/serverStore';
import { t } from '../i18n';

export class InviteModal {
  private modalEl: HTMLElement | null = null;
  private publicIp: string = '';

  public async open(): Promise<void> {
    this.close();

    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-backdrop';
    this.modalEl.innerHTML = `
      <div class="modal-card" style="max-width: 480px;">
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

        <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 14px; display: flex; flex-direction: column; gap: 10px;">
          <div style="display: flex; justify-content: space-between; font-size: 13px;">
            <span style="color: var(--text-muted);">${t('invite.serverLabel')}</span>
            <span style="font-weight: 600;">${serverStore.serverDetails?.name || 'Mini Voice'}</span>
          </div>

          <div style="display: flex; justify-content: space-between; font-size: 13px;">
            <span style="color: var(--text-muted);">${t('invite.publicIpLabel')}</span>
            <span id="invite-public-ip" style="font-family: var(--font-mono); font-weight: 600; color: var(--accent-primary);">${t('invite.loadingIp')}</span>
          </div>

          <div style="display: flex; justify-content: space-between; font-size: 13px;">
            <span style="color: var(--text-muted);">${t('invite.portLabel')}</span>
            <span id="invite-port" style="font-family: var(--font-mono); font-weight: 600;">3000</span>
          </div>
        </div>

        <div style="background: rgba(88, 101, 242, 0.1); border: 1px solid rgba(88, 101, 242, 0.3); border-radius: var(--radius-md); padding: 10px 12px; font-size: 11px; color: var(--text-secondary); line-height: 1.4; display: flex; gap: 8px; align-items: flex-start;">
          <span class="material-symbols-outlined md-16" style="color: var(--accent-primary); flex-shrink: 0;">info</span>
          <div>
            ${t('invite.tip')}
          </div>
        </div>

        <div id="copy-success-msg" style="display: none; font-size: 12px; color: var(--success); text-align: center; font-weight: 500;">
          <span class="material-symbols-outlined md-14" style="vertical-align: middle; margin-right: 4px;">check_circle</span>
          ${t('invite.copied')}
        </div>

        <div class="modal-footer">
          <button id="btn-copy-invite" class="btn btn-primary" style="width: 100%;">
            <span class="material-symbols-outlined md-18" style="margin-right: 6px;">content_copy</span>
            ${t('invite.copyButton')}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(this.modalEl);
    this.attachEvents();
    this.fetchPublicIp();
  }

  private async fetchPublicIp(): Promise<void> {
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      const data = await res.json();
      this.publicIp = data.ip || '127.0.0.1';
    } catch (e) {
      this.publicIp = t('invite.ipUnavailable');
    }

    const ipEl = document.getElementById('invite-public-ip');
    if (ipEl) {
      ipEl.textContent = this.publicIp;
    }
  }

  private attachEvents(): void {
    if (!this.modalEl) return;

    const btnClose = this.modalEl.querySelector('#modal-close');
    const btnCopy = this.modalEl.querySelector('#btn-copy-invite');
    const copyMsg = this.modalEl.querySelector('#copy-success-msg') as HTMLElement;

    btnClose?.addEventListener('click', () => this.close());

    btnCopy?.addEventListener('click', async () => {
      const textToCopy = t('invite.clipboardText', {
        server: serverStore.serverDetails?.name || 'Mini Voice',
        host: this.publicIp,
        port: 3000,
        tab: t('connection.tabJoin'),
      });

      try {
        await navigator.clipboard.writeText(textToCopy);
        if (copyMsg) {
          copyMsg.style.display = 'block';
          setTimeout(() => {
            if (copyMsg) copyMsg.style.display = 'none';
          }, 3000);
        }
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
