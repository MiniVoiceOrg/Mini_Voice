class LogsView {
  private levelFilter: LogLevel | 'ALL' = 'ALL';
  private autoScroll = true;

  constructor(private container: HTMLElement) {}

  public render(
    logs: GuiLogEntry[],
    actions: {
      onClear: () => Promise<void>;
    }
  ): void {
    const filtered = this.levelFilter === 'ALL' ? logs : logs.filter((entry) => entry.level === this.levelFilter);

    this.container.innerHTML = `
      <div class="content-header">
        <div>
          <h2>Logs</h2>
          <div class="content-subtitle">Acompanhe eventos do servidor em tempo real.</div>
        </div>
      </div>

      <div class="panel stack">
        <div class="log-toolbar">
          <select id="logs-filter" class="select" style="max-width: 180px;">
            <option value="ALL" ${this.levelFilter === 'ALL' ? 'selected' : ''}>Todos os níveis</option>
            <option value="INFO" ${this.levelFilter === 'INFO' ? 'selected' : ''}>INFO</option>
            <option value="WARN" ${this.levelFilter === 'WARN' ? 'selected' : ''}>WARN</option>
            <option value="ERROR" ${this.levelFilter === 'ERROR' ? 'selected' : ''}>ERROR</option>
          </select>
          <label class="toggle">
            <input id="logs-autoscroll" type="checkbox" ${this.autoScroll ? 'checked' : ''} />
            <span>Auto-scroll</span>
          </label>
          <button class="btn subtle" id="logs-clear-button">Limpar</button>
        </div>

        <div class="logs-list" id="logs-list">
          ${filtered.length === 0 ? '<div class="empty-state">Nenhum log disponível.</div>' : filtered.map((entry) => this.renderLog(entry)).join('')}
        </div>
      </div>
    `;

    getElement<HTMLSelectElement>('logs-filter')?.addEventListener('change', (event) => {
      this.levelFilter = (event.target as HTMLSelectElement).value as LogLevel | 'ALL';
      this.render(logs, actions);
    });

    getElement<HTMLInputElement>('logs-autoscroll')?.addEventListener('change', (event) => {
      this.autoScroll = Boolean((event.target as HTMLInputElement).checked);
    });

    getElement<HTMLButtonElement>('logs-clear-button')?.addEventListener('click', () => {
      void actions.onClear();
    });

    const list = getElement<HTMLDivElement>('logs-list');
    if (list && this.autoScroll) {
      list.scrollTop = list.scrollHeight;
    }
  }

  private renderLog(entry: GuiLogEntry): string {
    return `
      <div class="log-row ${entry.level.toLowerCase()}">
        <div class="log-meta">
          <span>${escapeHtml(entry.level)}</span>
          <span>${escapeHtml(entry.category)}</span>
          <span>${escapeHtml(formatDateTime(entry.timestamp))}</span>
        </div>
        <div>${escapeHtml(entry.message)}</div>
      </div>
    `;
  }
}
