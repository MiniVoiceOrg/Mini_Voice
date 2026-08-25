class SettingsView {
  private showPassword = false;

  constructor(private container: HTMLElement) {}

  public render(
    config: GuiConfig,
    status: GuiStatus,
    actions: {
      onSave: (input: SaveConfigInput) => Promise<void>;
      onBrowse: () => Promise<void>;
      onCreateChannel: (type: ChannelType) => Promise<void>;
      onRenameChannel: (channel: GuiChannel) => Promise<void>;
      onDeleteChannel: (channel: GuiChannel) => Promise<void>;
      onTogglePasswordVisibility: () => void;
      busy: boolean;
    }
  ): void {
    this.container.innerHTML = `
      <div class="content-header">
        <div>
          <h2>Configurações</h2>
          <div class="content-subtitle">Ajuste dados do host, limites e canais do servidor.</div>
        </div>
        <button class="btn primary" id="settings-save-button" ${actions.busy ? 'disabled' : ''}>${actions.busy ? 'Salvando...' : 'Salvar alterações'}</button>
      </div>

      <div class="panel stack">
        <h3 class="panel-title">Geral</h3>
        <div class="field-grid">
          <div class="field">
            <label for="settings-server-name">Nome do servidor</label>
            <input id="settings-server-name" class="input" value="${escapeHtml(config.serverName)}" />
          </div>
          <div class="field">
            <label for="settings-port">Porta</label>
            <input id="settings-port" class="input" type="number" min="1" max="65535" value="${config.port}" />
          </div>
          <div class="field">
            <label for="settings-max-users">Máximo de usuários</label>
            <input id="settings-max-users" class="input" type="number" min="1" max="500" value="${config.maxUsers}" />
          </div>
          <div class="field">
            <label for="settings-soundboard">Soundboard</label>
            <label class="toggle">
              <input id="settings-soundboard" type="checkbox" ${config.allowSoundboard ? 'checked' : ''} />
              <span>Permitir uso no servidor</span>
            </label>
          </div>
        </div>

        <div class="field">
          <label for="settings-data-dir">Diretório de dados</label>
          <div class="password-row">
            <input id="settings-data-dir" class="input" value="${escapeHtml(config.dataDir)}" />
            <button class="btn" id="settings-browse-button">Selecionar</button>
          </div>
          <div class="field-helper">${status.running ? 'Troque o diretório somente com o servidor parado.' : 'Arquivos do banco, anexos e avatares ficam aqui.'}</div>
        </div>

        <div class="field">
          <label for="settings-password">Senha</label>
          <div class="password-row">
            <input id="settings-password" class="input" type="${this.showPassword ? 'text' : 'password'}" placeholder="${config.hasPassword ? 'Digite nova senha para substituir a atual' : 'Sem senha'}" />
            <button class="btn" id="settings-toggle-password">${this.showPassword ? 'Ocultar' : 'Mostrar'}</button>
            <button class="btn subtle" id="settings-clear-password">Remover</button>
          </div>
          <div class="field-helper">${config.hasPassword ? 'Deixe em branco para manter a senha atual.' : 'A senha será aplicada ao salvar.'}</div>
        </div>
      </div>

      <div class="panel stack">
        <div class="panel-row">
          <h3 class="panel-title">Canais</h3>
          <div class="button-row">
            <button class="btn" id="settings-create-text">Novo canal de texto</button>
            <button class="btn" id="settings-create-voice">Novo canal de voz</button>
          </div>
        </div>
        <div class="channel-list">
          ${config.channels.length === 0 ? '<div class="empty-state">Nenhum canal configurado ainda.</div>' : config.channels.map((channel) => this.renderChannel(channel)).join('')}
        </div>
      </div>
    `;

    getElement<HTMLButtonElement>('settings-save-button')?.addEventListener('click', () => {
      const passwordInput = getElement<HTMLInputElement>('settings-password');
      void actions.onSave({
        serverName: getElement<HTMLInputElement>('settings-server-name')?.value ?? config.serverName,
        port: Number(getElement<HTMLInputElement>('settings-port')?.value ?? config.port),
        maxUsers: Number(getElement<HTMLInputElement>('settings-max-users')?.value ?? config.maxUsers),
        dataDir: getElement<HTMLInputElement>('settings-data-dir')?.value ?? config.dataDir,
        allowSoundboard: Boolean(getElement<HTMLInputElement>('settings-soundboard')?.checked),
        password: passwordInput?.value?.trim() || undefined,
        clearPassword: false,
      });
    });

    getElement<HTMLButtonElement>('settings-browse-button')?.addEventListener('click', () => {
      void actions.onBrowse();
    });

    getElement<HTMLButtonElement>('settings-toggle-password')?.addEventListener('click', () => {
      actions.onTogglePasswordVisibility();
    });

    getElement<HTMLButtonElement>('settings-clear-password')?.addEventListener('click', () => {
      void actions.onSave({
        serverName: getElement<HTMLInputElement>('settings-server-name')?.value ?? config.serverName,
        port: Number(getElement<HTMLInputElement>('settings-port')?.value ?? config.port),
        maxUsers: Number(getElement<HTMLInputElement>('settings-max-users')?.value ?? config.maxUsers),
        dataDir: getElement<HTMLInputElement>('settings-data-dir')?.value ?? config.dataDir,
        allowSoundboard: Boolean(getElement<HTMLInputElement>('settings-soundboard')?.checked),
        clearPassword: true,
      });
    });

    getElement<HTMLButtonElement>('settings-create-text')?.addEventListener('click', () => {
      void actions.onCreateChannel('TEXT');
    });

    getElement<HTMLButtonElement>('settings-create-voice')?.addEventListener('click', () => {
      void actions.onCreateChannel('VOICE');
    });

    for (const channel of config.channels) {
      getElement<HTMLButtonElement>(`channel-rename-${channel.id}`)?.addEventListener('click', () => {
        void actions.onRenameChannel(channel);
      });
      getElement<HTMLButtonElement>(`channel-delete-${channel.id}`)?.addEventListener('click', () => {
        void actions.onDeleteChannel(channel);
      });
    }
  }

  public setPasswordVisibility(visible: boolean): void {
    this.showPassword = visible;
  }

  private renderChannel(channel: GuiChannel): string {
    return `
      <div class="channel-card">
        <div class="channel-main">
          <div class="channel-title">
            <span class="material-symbols-outlined">${channel.type === 'VOICE' ? 'headset_mic' : 'chat'}</span>
            <span>${escapeHtml(channel.name)}</span>
          </div>
          <div class="channel-meta">
            <span>${channel.type === 'VOICE' ? 'Canal de voz' : 'Canal de texto'}</span>
            <span>Posição ${channel.position + 1}</span>
            <span>${channel.type === 'VOICE' ? `${channel.maxParticipants} participantes` : 'Mensagens e anexos'}</span>
          </div>
        </div>
        <div class="button-row">
          <button class="btn" id="channel-rename-${channel.id}">Renomear</button>
          <button class="btn danger" id="channel-delete-${channel.id}">Excluir</button>
        </div>
      </div>
    `;
  }
}
