type ViewName = 'dashboard' | 'members' | 'settings' | 'logs';
type LogLevel = 'INFO' | 'WARN' | 'ERROR';
type ChannelType = 'TEXT' | 'VOICE';

interface GuiStats {
  members: number;
  channels: number;
  messages: number;
}

interface GuiStatus {
  running: boolean;
  startedAt: number | null;
  uptimeMs: number;
  serverName: string;
  port: number;
  connectedUsers: number;
  dataDir: string;
  diskUsageBytes: number;
  maxUsers: number;
  allowSoundboard: boolean;
  stats: GuiStats;
}

interface GuiChannel {
  id: string;
  serverId: string;
  name: string;
  type: ChannelType;
  position: number;
  createdAt: number;
  maxParticipants: number;
}

interface GuiConfig {
  serverName: string;
  port: number;
  maxUsers: number;
  dataDir: string;
  allowSoundboard: boolean;
  hasPassword: boolean;
  channels: GuiChannel[];
}

interface GuiMember {
  id: string;
  nickname: string;
  clientId: string;
  roles: string[];
  lastSeenAt: number;
  online: boolean;
  isAdmin: boolean;
}

interface GuiLogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  category: string;
  message: string;
}

interface SaveConfigInput {
  serverName: string;
  port: number;
  maxUsers: number;
  dataDir: string;
  allowSoundboard: boolean;
  password?: string;
  clearPassword?: boolean;
}

interface RendererApi {
  getStatus(): Promise<GuiStatus>;
  startServer(): Promise<GuiStatus>;
  stopServer(): Promise<GuiStatus>;
  getMembers(): Promise<GuiMember[]>;
  setMemberAdmin(userId: string, makeAdmin: boolean): Promise<GuiMember[]>;
  kickMember(userId: string): Promise<GuiMember[]>;
  getConfig(): Promise<GuiConfig>;
  setConfig(config: SaveConfigInput): Promise<GuiConfig>;
  createChannel(input: { name: string; type: ChannelType }): Promise<GuiConfig>;
  renameChannel(channelId: string, name: string): Promise<GuiConfig>;
  deleteChannel(channelId: string): Promise<GuiConfig>;
  getLogs(): Promise<GuiLogEntry[]>;
  clearLogs(): Promise<void>;
  pickDataDirectory(): Promise<string | null>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  onLog(callback: (entry: GuiLogEntry) => void): () => void;
}

const rendererApi = (window as unknown as Window & { monkyApi: RendererApi }).monkyApi;

function getElement<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDateTime(timestamp: number): string {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleString('pt-BR');
}

function formatDuration(durationMs: number): string {
  if (!durationMs) return '—';
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function truncateId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

class MonkyServerGuiApp {
  private activeView: ViewName = 'dashboard';
  private dashboardView: DashboardView;
  private membersView: MembersView;
  private settingsView: SettingsView;
  private logsView: LogsView;
  private status: GuiStatus | null = null;
  private members: GuiMember[] = [];
  private config: GuiConfig | null = null;
  private logs: GuiLogEntry[] = [];
  private bannerText = '';
  private bannerKind: 'info' | 'success' | 'error' = 'info';
  private startStopBusy = false;
  private settingsBusy = false;
  private busyMemberId: string | null = null;
  private removeLogListener: (() => void) | null = null;
  private refreshTimer: number | null = null;
  private passwordVisible = false;

  constructor(private root: HTMLElement) {
    this.dashboardView = new DashboardView(root);
    this.membersView = new MembersView(root);
    this.settingsView = new SettingsView(root);
    this.logsView = new LogsView(root);
  }

  public async init(): Promise<void> {
    this.renderShell();
    this.attachShellEvents();
    this.removeLogListener = rendererApi.onLog((entry) => {
      this.logs = [...this.logs, entry].slice(-500);
      if (this.activeView === 'logs') {
        this.renderActiveView();
      }
    });

    await this.refreshAll();
    this.startPolling();
  }

  private startPolling(): void {
    this.refreshTimer = window.setInterval(() => {
      void this.refreshAll(false);
    }, 4000);
  }

  private async refreshAll(showErrors = true): Promise<void> {
    try {
      const [status, members, config, logs] = await Promise.all([
        rendererApi.getStatus(),
        rendererApi.getMembers(),
        rendererApi.getConfig(),
        rendererApi.getLogs(),
      ]);

      this.status = status;
      this.members = members;
      this.config = config;
      this.logs = logs;
      this.renderShell();
      this.renderActiveView();
    } catch (error) {
      if (showErrors) {
        this.setBanner(this.getErrorMessage(error), 'error');
      }
    }
  }

  private renderShell(): void {
    const status = this.status;
    const running = status?.running ?? false;

    this.root.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar">
          <div class="brand">
            <div class="brand-badge">M</div>
            <div class="brand-name">Monky Server</div>
          </div>
          <div class="sidebar-status">
            <span class="status-dot ${running ? 'running' : ''}"></span>
            <span>${running ? 'Running' : 'Stopped'}</span>
          </div>
          <nav class="sidebar-nav">
            ${this.renderNavButton('dashboard', 'dashboard', 'Dashboard')}
            ${this.renderNavButton('members', 'group', 'Members')}
            ${this.renderNavButton('settings', 'settings', 'Settings')}
            ${this.renderNavButton('logs', 'terminal', 'Logs')}
          </nav>
        </aside>
        <main class="main-panel">
          <header class="titlebar">
            <div class="titlebar-meta">
              <h1>${escapeHtml(status?.serverName ?? 'Monky Server')}</h1>
              <p>${running ? `Online • ${status?.connectedUsers ?? 0} usuários conectados` : 'Host pronto para iniciar um servidor'}</p>
            </div>
            <div class="window-controls">
              <button class="window-control" id="window-minimize" title="Minimizar"><span class="material-symbols-outlined">remove</span></button>
              <button class="window-control" id="window-maximize" title="Maximizar"><span class="material-symbols-outlined">crop_square</span></button>
              <button class="window-control close" id="window-close" title="Fechar"><span class="material-symbols-outlined">close</span></button>
            </div>
          </header>
          <section class="content-area">
            <div class="banner ${this.bannerKind === 'error' ? 'error' : this.bannerKind === 'success' ? 'success' : ''}">${escapeHtml(this.bannerText)}</div>
            <div id="content-view"></div>
          </section>
        </main>
      </div>
    `;

    for (const view of ['dashboard', 'members', 'settings', 'logs'] as ViewName[]) {
      getElement<HTMLButtonElement>(`nav-${view}`)?.addEventListener('click', () => {
        this.activeView = view;
        this.renderShell();
        this.renderActiveView();
      });
    }

    getElement<HTMLButtonElement>('window-minimize')?.addEventListener('click', () => {
      void rendererApi.minimizeWindow();
    });
    getElement<HTMLButtonElement>('window-maximize')?.addEventListener('click', () => {
      void rendererApi.toggleMaximizeWindow();
    });
    getElement<HTMLButtonElement>('window-close')?.addEventListener('click', () => {
      void rendererApi.closeWindow();
    });
  }

  private renderActiveView(): void {
    const content = getElement<HTMLDivElement>('content-view');
    if (!content || !this.status || !this.config) {
      return;
    }

    if (this.activeView === 'dashboard') {
      this.dashboardView = new DashboardView(content);
      this.dashboardView.render(this.status, {
        onStartStop: () => this.handleStartStop(),
        onOpenSettings: () => {
          this.activeView = 'settings';
          this.renderShell();
          this.renderActiveView();
        },
        busy: this.startStopBusy,
      });
      return;
    }

    if (this.activeView === 'members') {
      this.membersView = new MembersView(content);
      this.membersView.render(this.members, this.status, {
        onToggleAdmin: (member) => this.handleToggleAdmin(member),
        onKick: (member) => this.handleKick(member),
        busyMemberId: this.busyMemberId,
      });
      return;
    }

    if (this.activeView === 'settings') {
      this.settingsView = new SettingsView(content);
      this.settingsView.setPasswordVisibility(this.passwordVisible);
      this.settingsView.render(this.config, this.status, {
        onSave: (input) => this.handleSaveSettings(input),
        onBrowse: () => this.handleBrowseDataDir(),
        onCreateChannel: (type) => this.handleCreateChannel(type),
        onRenameChannel: (channel) => this.handleRenameChannel(channel),
        onDeleteChannel: (channel) => this.handleDeleteChannel(channel),
        onTogglePasswordVisibility: () => {
          this.passwordVisible = !this.passwordVisible;
          this.renderActiveView();
        },
        busy: this.settingsBusy,
      });
      return;
    }

    this.logsView = new LogsView(content);
    this.logsView.render(this.logs, {
      onClear: () => this.handleClearLogs(),
    });
  }

  private renderNavButton(view: ViewName, icon: string, label: string): string {
    return `
      <button class="nav-button ${this.activeView === view ? 'active' : ''}" id="nav-${view}">
        <span class="material-symbols-outlined">${icon}</span>
        <span>${label}</span>
      </button>
    `;
  }

  private attachShellEvents(): void {
    window.addEventListener('beforeunload', () => {
      if (this.removeLogListener) {
        this.removeLogListener();
      }
      if (this.refreshTimer !== null) {
        window.clearInterval(this.refreshTimer);
      }
    });
  }

  private async handleStartStop(): Promise<void> {
    this.startStopBusy = true;
    this.renderActiveView();
    try {
      this.status = this.status?.running ? await rendererApi.stopServer() : await rendererApi.startServer();
      await this.refreshAll(false);
      this.setBanner(this.status.running ? 'Servidor iniciado com sucesso.' : 'Servidor parado com sucesso.', 'success');
    } catch (error) {
      this.setBanner(this.getErrorMessage(error), 'error');
    } finally {
      this.startStopBusy = false;
      this.renderShell();
      this.renderActiveView();
    }
  }

  private async handleToggleAdmin(member: GuiMember): Promise<void> {
    this.busyMemberId = member.id;
    this.renderActiveView();
    try {
      this.members = await rendererApi.setMemberAdmin(member.id, !member.isAdmin);
      this.setBanner(member.isAdmin ? 'Cargo de admin removido.' : 'Admin atribuído com sucesso.', 'success');
    } catch (error) {
      this.setBanner(this.getErrorMessage(error), 'error');
    } finally {
      this.busyMemberId = null;
      this.renderActiveView();
    }
  }

  private async handleKick(member: GuiMember): Promise<void> {
    if (!confirm(`Expulsar ${member.nickname} do servidor agora?`)) {
      return;
    }
    this.busyMemberId = member.id;
    this.renderActiveView();
    try {
      this.members = await rendererApi.kickMember(member.id);
      await this.refreshAll(false);
      this.setBanner(`${member.nickname} foi desconectado do servidor.`, 'success');
    } catch (error) {
      this.setBanner(this.getErrorMessage(error), 'error');
    } finally {
      this.busyMemberId = null;
      this.renderActiveView();
    }
  }

  private async handleSaveSettings(input: SaveConfigInput): Promise<void> {
    const previousConfig = this.config;
    this.settingsBusy = true;
    this.renderActiveView();
    try {
      this.config = await rendererApi.setConfig(input);
      this.status = await rendererApi.getStatus();
      const restartNeeded = Boolean(previousConfig && (previousConfig.port !== input.port || previousConfig.dataDir !== input.dataDir) && this.status.running);
      this.setBanner(restartNeeded ? 'Configurações salvas. Reinicie o servidor para aplicar porta/diretório.' : 'Configurações salvas com sucesso.', 'success');
      this.renderShell();
      this.renderActiveView();
    } catch (error) {
      this.setBanner(this.getErrorMessage(error), 'error');
    } finally {
      this.settingsBusy = false;
      this.renderActiveView();
    }
  }

  private async handleBrowseDataDir(): Promise<void> {
    const selected = await rendererApi.pickDataDirectory();
    if (!selected) {
      return;
    }
    const input = getElement<HTMLInputElement>('settings-data-dir');
    if (input) {
      input.value = selected;
    }
  }

  private async handleCreateChannel(type: ChannelType): Promise<void> {
    const name = prompt(type === 'TEXT' ? 'Nome do novo canal de texto:' : 'Nome do novo canal de voz:');
    if (!name) {
      return;
    }

    try {
      this.config = await rendererApi.createChannel({ name, type });
      this.status = await rendererApi.getStatus();
      this.setBanner('Canal criado com sucesso.', 'success');
      this.renderActiveView();
    } catch (error) {
      this.setBanner(this.getErrorMessage(error), 'error');
    }
  }

  private async handleRenameChannel(channel: GuiChannel): Promise<void> {
    const name = prompt('Novo nome do canal:', channel.name);
    if (!name || name === channel.name) {
      return;
    }

    try {
      this.config = await rendererApi.renameChannel(channel.id, name);
      this.setBanner('Canal renomeado com sucesso.', 'success');
      this.renderActiveView();
    } catch (error) {
      this.setBanner(this.getErrorMessage(error), 'error');
    }
  }

  private async handleDeleteChannel(channel: GuiChannel): Promise<void> {
    if (!confirm(`Excluir o canal "${channel.name}"?`)) {
      return;
    }

    try {
      this.config = await rendererApi.deleteChannel(channel.id);
      this.status = await rendererApi.getStatus();
      this.setBanner('Canal removido com sucesso.', 'success');
      this.renderActiveView();
    } catch (error) {
      this.setBanner(this.getErrorMessage(error), 'error');
    }
  }

  private async handleClearLogs(): Promise<void> {
    await rendererApi.clearLogs();
    this.logs = [];
    this.setBanner('Logs limpos.', 'success');
    this.renderActiveView();
  }

  private setBanner(message: string, kind: 'info' | 'success' | 'error'): void {
    this.bannerText = message;
    this.bannerKind = kind;
    this.renderShell();
    this.renderActiveView();
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return 'Ocorreu um erro inesperado.';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const appRoot = getElement<HTMLDivElement>('app');
  if (!appRoot) {
    return;
  }

  const gui = new MonkyServerGuiApp(appRoot);
  void gui.init();
});
