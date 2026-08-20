import { appEvents } from '../core/EventBus';
import { connectionStore } from '../stores/connectionStore';
import { networkClient } from '../core/NetworkClient';
import { getAvatarUrl } from '../utils/avatar';

export class ConnectionView {
  private container: HTMLElement;
  private activeTab: 'join' | 'host' = 'join';
  private selectedAvatarBase64: string = '';

  constructor(container: HTMLElement) {
    this.container = container;
    connectionStore.loadUserProfile();
    this.selectedAvatarBase64 = connectionStore.savedAvatarBase64 || '';
  }

  public render(): void {
    const savedNick = connectionStore.savedNickname || '';

    this.container.innerHTML = `
      <div class="connection-layout">
        <div class="connection-card">
          
          <div class="brand-header">
            <div class="brand-logo">
              <span>🎙️ Mini Voice</span>
              <span class="brand-badge">P2P</span>
            </div>
            <div class="brand-tagline">Comunicação direta, rápida e privada entre amigos</div>
          </div>

          <div class="nav-tabs">
            <button id="tab-join" class="tab-button ${this.activeTab === 'join' ? 'active' : ''}">Entrar no Servidor</button>
            <button id="tab-host" class="tab-button ${this.activeTab === 'host' ? 'active' : ''}">Criar Servidor</button>
          </div>

          <div id="error-banner" class="error-banner"></div>

          <!-- Avatar Picker -->
          <div class="avatar-picker">
            <img id="avatar-preview" class="avatar-preview-img" src="${getAvatarUrl(this.selectedAvatarBase64)}">
            <div>
              <button id="btn-select-avatar" class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;">Escolher Foto de Perfil</button>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">PNG, JPG ou WebP (Salvo no PC)</div>
            </div>
          </div>

          <!-- Tab 1: Join Server -->
          <form id="form-join" style="display: ${this.activeTab === 'join' ? 'block' : 'none'};">
            <div class="form-group">
              <label>Seu Nickname</label>
              <input id="join-nickname" type="text" placeholder="Ex: Murilo" value="${this.escapeHtml(savedNick)}" required minlength="2" maxlength="32">
            </div>

            <div class="form-row">
              <div class="form-group" style="flex: 2;">
                <label>IP / Host do Servidor</label>
                <input id="join-host" type="text" placeholder="127.0.0.1 ou IP público" value="127.0.0.1" required>
              </div>
              <div class="form-group small-col">
                <label>Porta</label>
                <input id="join-port" type="number" placeholder="3000" value="3000" required min="1024" max="65535">
              </div>
            </div>

            <div class="form-group">
              <label>Senha do Servidor (opcional)</label>
              <input id="join-password" type="password" placeholder="••••••••">
            </div>

            <button type="submit" id="btn-submit-join" class="btn btn-primary" style="width: 100%; margin-top: 8px;">
              Entrar no Servidor
            </button>
          </form>

          <!-- Tab 2: Host Server -->
          <form id="form-host" style="display: ${this.activeTab === 'host' ? 'block' : 'none'};">
            <div style="background: rgba(88, 101, 242, 0.1); border: 1px solid rgba(88, 101, 242, 0.3); border-radius: var(--radius-md); padding: 10px 12px; font-size: 12px; color: var(--text-secondary); margin-bottom: 14px; line-height: 1.4;">
              💡 <b>Como funciona:</b> Ao criar o servidor, ele roda na sua própria máquina e escuta em todas as suas interfaces de rede na porta escolhida. Seus amigos usam o seu IP (público ou de VPN) para entrar!
            </div>

            <div class="form-group">
              <label>Seu Nickname (Anfitrião)</label>
              <input id="host-nickname" type="text" placeholder="Ex: Murilo" value="${this.escapeHtml(savedNick)}" required minlength="2" maxlength="32">
            </div>

            <div class="form-group">
              <label>Nome do Servidor</label>
              <input id="host-name" type="text" placeholder="Ex: QG dos Amigos" value="Servidor dos Amigos" required minlength="2" maxlength="50">
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>Porta Local</label>
                <input id="host-port" type="number" value="3000" required min="1024" max="65535">
              </div>
              <div class="form-group">
                <label>Senha de Acesso</label>
                <input id="host-password" type="password" placeholder="Opcional">
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>Primeiro Canal de Texto</label>
                <input id="host-text-channel" type="text" value="geral" required>
              </div>
              <div class="form-group">
                <label>Primeiro Canal de Voz</label>
                <input id="host-voice-channel" type="text" value="Geral" required>
              </div>
            </div>

            <button type="submit" id="btn-submit-host" class="btn btn-primary" style="width: 100%; margin-top: 8px;">
              Criar e Iniciar Servidor
            </button>
          </form>

        </div>
      </div>
    `;

    this.attachEvents();
  }

  private attachEvents(): void {
    const tabJoin = document.getElementById('tab-join');
    const tabHost = document.getElementById('tab-host');
    const formJoin = document.getElementById('form-join') as HTMLFormElement;
    const formHost = document.getElementById('form-host') as HTMLFormElement;
    const btnSelectAvatar = document.getElementById('btn-select-avatar');
    const joinNickInput = document.getElementById('join-nickname') as HTMLInputElement;
    const hostNickInput = document.getElementById('host-nickname') as HTMLInputElement;

    // Sync and save nickname as user types
    const handleNickChange = (val: string) => {
      if (joinNickInput && joinNickInput.value !== val) joinNickInput.value = val;
      if (hostNickInput && hostNickInput.value !== val) hostNickInput.value = val;
      connectionStore.saveUserProfile(val, this.selectedAvatarBase64);
    };

    joinNickInput?.addEventListener('input', (e) => handleNickChange((e.target as HTMLInputElement).value));
    hostNickInput?.addEventListener('input', (e) => handleNickChange((e.target as HTMLInputElement).value));

    tabJoin?.addEventListener('click', () => {
      this.activeTab = 'join';
      tabJoin.classList.add('active');
      tabHost?.classList.remove('active');
      formJoin.style.display = 'block';
      formHost.style.display = 'none';
      this.hideError();
    });

    tabHost?.addEventListener('click', () => {
      this.activeTab = 'host';
      tabHost.classList.add('active');
      tabJoin?.classList.remove('active');
      formHost.style.display = 'block';
      formJoin.style.display = 'none';
      this.hideError();
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
        let clientId = connectionStore.clientId;
        if (!clientId && window.api?.getClientId) {
          clientId = await window.api.getClientId();
          connectionStore.clientId = clientId;
        }

        const res = await networkClient.connect(host, port, clientId, nickname, password);

        // If user picked an avatar, update it right after join
        if (this.selectedAvatarBase64) {
          try {
            await networkClient.sendRequest('USER_UPDATE_AVATAR' as any, {
              avatarBase64: this.selectedAvatarBase64,
              mimeType: 'image/png',
            });
          } catch (err) {}
        }

        connectionStore.addSavedServer({
          host,
          port,
          name: res.server.name,
          lastConnected: Date.now(),
        });
      } catch (err: any) {
        this.showError(err.message || 'Não foi possível conectar ao servidor. Verifique o IP, porta e senha.');
      } finally {
        btn.disabled = false;
        btn.innerText = 'Entrar no Servidor';
      }
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
      btn.innerText = 'Iniciando servidor local...';

      try {
        if (window.api?.hostServerStart) {
          const hostRes = await window.api.hostServerStart({
            port,
            serverName,
            password,
            initialTextChannel: initialText,
            initialVoiceChannel: initialVoice,
          });

          if (!hostRes.success) {
            throw new Error(hostRes.error || 'Falha ao iniciar servidor local');
          }
        }

        // Connect client to the newly hosted local server
        let clientId = connectionStore.clientId;
        if (!clientId && window.api?.getClientId) {
          clientId = await window.api.getClientId();
          connectionStore.clientId = clientId;
        }

        const res = await networkClient.connect('127.0.0.1', port, clientId, nickname, password);

        // Upload avatar if chosen
        if (this.selectedAvatarBase64) {
          try {
            await networkClient.sendRequest('USER_UPDATE_AVATAR' as any, {
              avatarBase64: this.selectedAvatarBase64,
              mimeType: 'image/png',
            });
          } catch (err) {}
        }

        connectionStore.addSavedServer({
          host: '127.0.0.1',
          port,
          name: serverName,
          lastConnected: Date.now(),
        });
      } catch (err: any) {
        this.showError(err.message || 'Erro ao criar e conectar ao servidor local.');
      } finally {
        btn.disabled = false;
        btn.innerText = 'Criar e Iniciar Servidor';
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

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
