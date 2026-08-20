import { serverStore } from '../stores/serverStore';

export class InviteModal {
  private modalEl: HTMLElement | null = null;
  private publicIp: string = 'Consultando...';

  public async open(): Promise<void> {
    this.close();

    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-backdrop';
    this.modalEl.innerHTML = `
      <div class="modal-card" style="max-width: 480px;">
        <div class="modal-header">
          <div class="modal-title">🔗 Convidar Amigos</div>
          <button id="modal-close" class="modal-close-btn">&times;</button>
        </div>

        <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.5;">
          Compartilhe os dados abaixo com seus amigos para eles entrarem no seu servidor pela aba <b>"Entrar no Servidor"</b>:
        </div>

        <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 14px; display: flex; flex-direction: column; gap: 10px;">
          <div style="display: flex; justify-content: space-between; font-size: 13px;">
            <span style="color: var(--text-muted);">Servidor:</span>
            <span style="font-weight: 600;">${serverStore.serverDetails?.name || 'Mini Voice'}</span>
          </div>

          <div style="display: flex; justify-content: space-between; font-size: 13px;">
            <span style="color: var(--text-muted);">Seu IP Público:</span>
            <span id="invite-public-ip" style="font-family: var(--font-mono); font-weight: 600; color: var(--accent-primary);">Carregando IP...</span>
          </div>

          <div style="display: flex; justify-content: space-between; font-size: 13px;">
            <span style="color: var(--text-muted);">Porta Padrão:</span>
            <span id="invite-port" style="font-family: var(--font-mono); font-weight: 600;">3000</span>
          </div>
        </div>

        <div style="font-size: 11px; color: var(--text-muted); line-height: 1.4;">
          💡 <b>Dica:</b> Para amigos em outra internet conectarem direto pelo seu IP público, a porta deve estar liberada no seu roteador (Port Forwarding). Se você usa Radmin VPN ou Hamachi, use o IP da VPN!
        </div>

        <div id="copy-success-msg" style="display: none; font-size: 12px; color: var(--success); text-align: center; font-weight: 500;">
          ✔ Dados de conexão copiados para a área de transferência!
        </div>

        <div class="modal-footer">
          <button id="btn-copy-invite" class="btn btn-primary" style="width: 100%;">
            📋 Copiar Dados de Conexão
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
      this.publicIp = 'Verifique em meuip.com.br';
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
      const textToCopy = `🎙️ Convite para o Mini Voice!
Servidor: ${serverStore.serverDetails?.name || 'Mini Voice'}
IP / Host: ${this.publicIp}
Porta: 3000

Baixe o app e cole esses dados na aba "Entrar no Servidor"!`;

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
