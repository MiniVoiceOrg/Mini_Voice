import { appEvents } from '../core/EventBus';
import { escapeHtml } from '../utils/html';
import { MessageType } from '@mini-voice/shared';
import { connectionStore } from '../stores/connectionStore';
import { networkClient } from '../core/NetworkClient';
import { getAvatarUrl } from '../utils/avatar';
import { settingsModal } from './SettingsModal';
import { withButtonLoading } from '../utils/buttonLoading';
import logoUrl from '../assets/Logo.png';

export class ConnectionView {
  private container: HTMLElement;
  private activeTab: 'join' | 'host' = 'join';
  private selectedAvatarBase64: string = '';
  private selectedSavedHost: string | null = null;
  private selectedSavedPort: number | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    connectionStore.loadUserProfile();
    connectionStore.loadSavedServers();
    this.selectedAvatarBase64 = connectionStore.savedAvatarBase64 || '';
  }

  public render(): void {
    const savedNick = connectionStore.savedNickname || '';
    const savedServers = connectionStore.savedServers || [];

    this.container.innerHTML = `
      <div class="connection-layout">
        <div class="connection-card">
          
          <button id="btn-open-settings" class="btn btn-secondary" title="Configurações" style="position: absolute; top: 12px; right: 12px; padding: 6px 8px; z-index: 2;">
            <span class="material-symbols-outlined md-18">settings</span>
          </button>

          <div class="brand-header" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; margin-bottom: 16px;">
            <img src="${logoUrl}" alt="Mini Voice Logo" style="width: 200px; max-width: 70%; height: auto; max-height: 80px; object-fit: contain; filter: drop-shadow(0 4px 16px rgba(88, 101, 242, 0.4));">
            <div class="brand-logo" style="display: flex; align-items: center; justify-content: center; gap: 8px;">
              <span style="font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">Mini Voice</span>
              <span class="brand-badge" style="font-size: 11px; padding: 2px 8px;">P2P</span>
            </div>
            <div class="brand-tagline" style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">Comunicação direta, rápida e privada entre amigos</div>
          </div>

          <div class="nav-tabs" style="margin-bottom: 14px;">
            <button id="tab-join" class="tab-button ${this.activeTab === 'join' ? 'active' : ''}">Entrar no Servidor</button>
            <button id="tab-host" class="tab-button ${this.activeTab === 'host' ? 'active' : ''}">Criar Servidor</button>
          </div>

          <div id="error-banner" class="error-banner"></div>

          <!-- Avatar Picker -->
          <div class="avatar-picker" style="margin-bottom: 14px; gap: 12px;">
            <img id="avatar-preview" class="avatar-preview-img" style="width: 46px; height: 46px;" src="${getAvatarUrl(this.selectedAvatarBase64)}">
            <div>
              <button id="btn-select-avatar" class="btn btn-secondary" style="padding: 5px 10px; font-size: 11px;">
                <span class="material-symbols-outlined md-14" style="margin-right: 4px;">photo_camera</span>
                Escolher Foto de Perfil
              </button>
              <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">PNG, JPG ou WebP (Salvo no PC)</div>
            </div>
          </div>

          <!-- Tab 1: Join Server -->
          <form id="form-join" style="display: ${this.activeTab === 'join' ? 'block' : 'none'};">
            ${savedServers.length > 0 ? `
              <div class="saved-servers-container">
                <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
                  <span style="display: flex; align-items: center; gap: 4px;">
                    <span class="material-symbols-outlined md-14" style="color: var(--accent-primary);">bookmark</span>
                    Servidores Salvos (${savedServers.length})
                  </span>
                  <span style="font-size: 10px; font-weight: normal; color: var(--text-muted);">Clique para selecionar</span>
                </div>
                <div class="saved-servers-list">
                  ${savedServers.map((s) => {
                    const isSelected = this.selectedSavedHost === s.host && this.selectedSavedPort === s.port;
                    return `
                      <div class="saved-server-item ${isSelected ? 'selected' : ''}" data-host="${escapeHtml(s.host)}" data-port="${s.port}" data-password="${escapeHtml(s.password || '')}">
                        <div style="display: flex; flex-direction: column; overflow: hidden; pointer-events: none;">
                          <span style="font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px;">
                            <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">dns</span>
                            ${escapeHtml(s.name || 'Servidor')}
                          </span>
                          <span style="font-size: 11px; color: var(--text-muted); margin-left: 22px;">${escapeHtml(s.host)}:${s.port}</span>
                          <div class="saved-server-preview" data-host="${escapeHtml(s.host)}" data-port="${s.port}" style="margin-left: 22px; margin-top: 4px;"></div>
                        </div>
                        <div style="display: flex; gap: 6px; align-items: center;">
                          <button type="button" class="btn btn-secondary btn-select-saved" data-host="${escapeHtml(s.host)}" data-port="${s.port}" data-password="${escapeHtml(s.password || '')}" style="padding: 2px 8px; font-size: 11px; height: 24px;">
                            ${isSelected ? '✓ Selecionado' : 'Usar'}
                          </button>
                          <button type="button" class="btn-delete-saved-srv" data-host="${escapeHtml(s.host)}" data-port="${s.port}" title="Remover dos salvos">
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
              <label>Seu Nickname</label>
              <input id="join-nickname" type="text" placeholder="Ex: Murilo" value="${escapeHtml(savedNick)}" required minlength="2" maxlength="32">
            </div>

            <div class="form-row">
              <div class="form-group" style="flex: 2;">
                <label>IP / Host do Servidor</label>
                <input id="join-host" type="text" placeholder="127.0.0.1 ou IP público" value="${this.selectedSavedHost || '127.0.0.1'}" required>
              </div>
              <div class="form-group small-col">
                <label>Porta</label>
                <input id="join-port" type="number" placeholder="3000" value="${this.selectedSavedPort || 3000}" required min="1024" max="65535">
              </div>
            </div>

            <div class="form-group">
              <label>Senha do Servidor (opcional)</label>
              <input id="join-password" type="password" placeholder="••••••••">
            </div>

            <button type="submit" id="btn-submit-join" class="btn btn-primary" style="width: 100%; margin-top: 8px;">
              <span class="material-symbols-outlined md-18" style="margin-right: 6px;">login</span>
              Entrar no Servidor
            </button>
          </form>

          <!-- Tab 2: Host Server -->
          <form id="form-host" style="display: ${this.activeTab === 'host' ? 'block' : 'none'};">
            <div style="background: rgba(88, 101, 242, 0.1); border: 1px solid rgba(88, 101, 242, 0.3); border-radius: var(--radius-md); padding: 10px 12px; font-size: 12px; color: var(--text-secondary); margin-bottom: 14px; line-height: 1.4; display: flex; gap: 8px; align-items: flex-start;">
              <span class="material-symbols-outlined md-18" style="color: var(--accent-primary); flex-shrink: 0; margin-top: 1px;">info</span>
              <div>
                <b>Como funciona:</b> Ao criar o servidor, ele roda na sua própria máquina e escuta em todas as suas interfaces de rede na porta escolhida. Seus amigos usam o seu IP (público ou de VPN) para entrar!
              </div>
            </div>

            <div class="form-group">
              <label>Seu Nickname (Anfitrião)</label>
              <input id="host-nickname" type="text" placeholder="Ex: Murilo" value="${escapeHtml(savedNick)}" required minlength="2" maxlength="32">
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
                <label>Canal de Texto</label>
                <input id="host-text-channel" type="text" value="geral" required>
              </div>
              <div class="form-group">
                <label>Canal de Voz</label>
                <input id="host-voice-channel" type="text" value="Geral" required>
              </div>
            </div>

            <button type="submit" id="btn-submit-host" class="btn btn-primary" style="width: 100%; margin-top: 8px;">
              <span class="material-symbols-outlined md-18" style="margin-right: 6px;">add_circle</span>
              Criar e Iniciar Servidor
            </button>
          </form>

        </div>
      </div>
    `;

    this.attachEvents();
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
        if (!res.ok) continue;
        const info = await res.json();
        this.renderServerPreview(node, host, port, info);
      } catch {
        // Server offline/unreachable — leave the preview empty silently.
      }
    }
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
        const title = escapeHtml(u.nickname || 'Usuário');
        return `<img class="preview-avatar" src="${raw}" title="${title}" onerror="this.src='${getAvatarUrl(null)}'">`;
      })
      .join('');

    node.innerHTML = `
      <div class="server-preview-row">
        <div class="preview-avatars">${avatars}</div>
        <span class="preview-count">${count}${max ? `/${max}` : ''} online</span>
      </div>
    `;
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

    this.loadServerPreviews();

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
            await networkClient.sendRequest(MessageType.USER_UPDATE_AVATAR, {
              avatarBase64: this.selectedAvatarBase64,
              mimeType: 'image/png',
            });
          } catch (err) {}
        }

        connectionStore.addSavedServer({
          host,
          port,
          name: res.server.name,
          password: password || undefined,
          lastConnected: Date.now(),
        });
      } catch (err: any) {
        this.showError(err.message || 'Não foi possível conectar ao servidor. Verifique o IP, porta e senha.');
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<span class="material-symbols-outlined md-18" style="margin-right: 6px;">login</span> Entrar no Servidor`;
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
            await networkClient.sendRequest(MessageType.USER_UPDATE_AVATAR, {
              avatarBase64: this.selectedAvatarBase64,
              mimeType: 'image/png',
            });
          } catch (err) {}
        }

        connectionStore.addSavedServer({
          host: '127.0.0.1',
          port,
          name: serverName,
          password: password || undefined,
          lastConnected: Date.now(),
        });
      } catch (err: any) {
        this.showError(err.message || 'Erro ao criar e conectar ao servidor local.');
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<span class="material-symbols-outlined md-18" style="margin-right: 6px;">add_circle</span> Criar e Iniciar Servidor`;
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
