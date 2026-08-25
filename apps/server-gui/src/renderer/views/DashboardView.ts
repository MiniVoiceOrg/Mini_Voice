class DashboardView {
  constructor(private container: HTMLElement) {}

  public render(
    status: GuiStatus,
    actions: {
      onStartStop: () => Promise<void>;
      onOpenSettings: () => void;
      busy: boolean;
    }
  ): void {
    this.container.innerHTML = `
      <div class="content-header">
        <div>
          <h2>Dashboard</h2>
          <div class="content-subtitle">Inicie, acompanhe e monitore o servidor Monky hospedado nesta máquina.</div>
        </div>
        <div class="button-row">
          <button class="btn subtle" id="dashboard-settings-button">Configurações</button>
          <button class="btn ${status.running ? 'danger' : 'primary'}" id="dashboard-toggle-button" ${actions.busy ? 'disabled' : ''}>
            ${actions.busy ? 'Processando...' : status.running ? 'Parar servidor' : 'Iniciar servidor'}
          </button>
        </div>
      </div>

      <div class="grid-cards">
        ${this.renderCard('Status', status.running ? 'Running' : 'Stopped', status.running ? 'Servidor aceitando conexões.' : 'Servidor aguardando inicialização.')}
        ${this.renderCard('Porta', String(status.port), 'Porta atual configurada no host.')}
        ${this.renderCard('Uptime', formatDuration(status.uptimeMs), status.startedAt ? `Iniciado às ${formatDateTime(status.startedAt)}` : 'Ainda não iniciado nesta sessão.')}
        ${this.renderCard('Usuários conectados', String(status.connectedUsers), `${status.connectedUsers}/${status.maxUsers} vagas em uso`)}
        ${this.renderCard('Uso em disco', formatBytes(status.diskUsageBytes), status.dataDir)}
        ${this.renderCard('Membros totais', String(status.stats.members), `${status.stats.channels} canais • ${status.stats.messages} mensagens`)}
      </div>

      <div class="panel stack">
        <div class="panel-row">
          <h3 class="panel-title">Resumo do servidor</h3>
          <span class="chip ${status.running ? 'admin' : ''}">${status.running ? 'Ativo' : 'Inativo'}</span>
        </div>
        <div class="summary-list">
          <div class="summary-item"><span>Nome do servidor</span><strong>${escapeHtml(status.serverName)}</strong></div>
          <div class="summary-item"><span>Somboard</span><strong>${status.allowSoundboard ? 'Habilitado' : 'Desabilitado'}</strong></div>
          <div class="summary-item"><span>Diretório de dados</span><strong>${escapeHtml(status.dataDir)}</strong></div>
          <div class="summary-item"><span>Mensagens armazenadas</span><strong>${status.stats.messages}</strong></div>
        </div>
      </div>
    `;

    getElement<HTMLButtonElement>('dashboard-toggle-button')?.addEventListener('click', () => {
      void actions.onStartStop();
    });

    getElement<HTMLButtonElement>('dashboard-settings-button')?.addEventListener('click', () => {
      actions.onOpenSettings();
    });
  }

  private renderCard(label: string, value: string, helper: string): string {
    return `
      <div class="stat-card">
        <div class="stat-label">${escapeHtml(label)}</div>
        <div class="stat-value">${escapeHtml(value)}</div>
        <div class="stat-helper">${escapeHtml(helper)}</div>
      </div>
    `;
  }
}
