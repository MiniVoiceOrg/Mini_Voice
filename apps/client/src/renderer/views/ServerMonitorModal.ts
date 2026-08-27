import { LOG_LEVELS, type LogEntry, type LogLevel, type ServerStats } from '@monky/shared';
import { escapeHtml } from '../utils/html';
import { enableBackdropClose } from '../utils/modal';
import { t } from '../i18n';

const MAX_RENDERED_ENTRIES = 500;

const LEVEL_COLORS: Record<LogLevel, string> = {
  INFO: 'var(--text-secondary)',
  WARN: 'var(--warning, #faa61a)',
  ERROR: 'var(--danger)',
};

/**
 * Live view of the server hosted by this client: metrics plus the log stream.
 *
 * Replaces the standalone Monky Server GUI, which reached into server
 * internals through unchecked casts. Everything here goes through IPC
 * contracts instead.
 */
export class ServerMonitorModal {
  private modalEl: HTMLElement | null = null;
  private entries: LogEntry[] = [];
  private levelFilter: LogLevel | 'ALL' = 'ALL';
  private searchTerm = '';
  private autoScroll = true;
  private unsubscribeLog: (() => void) | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  public async open(): Promise<void> {
    this.close();

    this.entries = [];
    this.levelFilter = 'ALL';
    this.searchTerm = '';
    this.autoScroll = true;

    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-backdrop';
    this.modalEl.innerHTML = `
      <div class="modal-card" style="max-width: 860px; width: 92vw;">
        <div class="modal-header">
          <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
            <span class="material-symbols-outlined" style="color: var(--accent-primary);">monitoring</span>
            <span>${t('serverMonitor.title')}</span>
          </div>
          <button id="modal-close" class="modal-close-btn">&times;</button>
        </div>

        <div id="monitor-stats" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px;">
          ${this.renderStatsSkeleton()}
        </div>

        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
          <div style="display: flex; gap: 4px;">
            ${(['ALL', ...LOG_LEVELS] as const)
              .map(
                (level) => `
                  <button type="button" class="btn btn-secondary btn-log-level" data-level="${level}"
                    style="padding: 4px 10px; font-size: 11px; height: 26px;">
                    ${level === 'ALL' ? t('serverMonitor.levelAll') : level}
                  </button>
                `
              )
              .join('')}
          </div>
          <input id="monitor-search" type="text" placeholder="${t('serverMonitor.searchPlaceholder')}"
            style="flex: 1; min-width: 140px; font-size: 12px; padding: 5px 10px; height: 26px;">
          <label style="display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-muted); cursor: pointer; white-space: nowrap;">
            <input id="monitor-autoscroll" type="checkbox" checked style="margin: 0;">
            ${t('serverMonitor.autoScroll')}
          </label>
        </div>

        <div id="monitor-logs" style="background: var(--bg-tertiary, #1e1f22); border: 1px solid var(--border-color); border-radius: var(--radius-md); height: 320px; overflow-y: auto; padding: 8px 10px; font-family: var(--font-mono); font-size: 11px; line-height: 1.6;">
          <div style="color: var(--text-muted); text-align: center; padding: 16px;">${t('serverMonitor.loading')}</div>
        </div>

        <div class="modal-footer" style="display: flex; gap: 8px;">
          <span id="monitor-count" style="flex: 1; font-size: 11px; color: var(--text-muted); align-self: center;"></span>
          <button id="btn-copy-logs" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;">
            <span class="material-symbols-outlined md-16" style="margin-right: 4px;">content_copy</span>
            ${t('serverMonitor.copy')}
          </button>
          <button id="btn-clear-logs" class="btn btn-danger" style="font-size: 12px; padding: 6px 12px;">
            <span class="material-symbols-outlined md-16" style="margin-right: 4px;">delete_sweep</span>
            ${t('serverMonitor.clear')}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(this.modalEl);
    this.attachEvents();
    this.updateLevelButtons();

    await Promise.all([this.loadLogs(), this.refreshStats()]);

    this.unsubscribeLog = window.api?.onHostServerLog?.((entry) => this.appendEntry(entry)) ?? null;
    this.statsTimer = setInterval(() => void this.refreshStats(), 3000);
  }

  private renderStatsSkeleton(): string {
    const cards: Array<{ id: string; icon: string; label: string }> = [
      { id: 'uptime', icon: 'schedule', label: t('serverMonitor.uptime') },
      { id: 'online', icon: 'group', label: t('serverMonitor.online') },
      { id: 'members', icon: 'badge', label: t('serverMonitor.members') },
      { id: 'channels', icon: 'tag', label: t('serverMonitor.channels') },
      { id: 'messages', icon: 'chat', label: t('serverMonitor.messages') },
      { id: 'port', icon: 'lan', label: t('serverMonitor.port') },
    ];

    return cards
      .map(
        (card) => `
          <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 8px 10px;">
            <div style="display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px;">
              <span class="material-symbols-outlined md-14">${card.icon}</span>
              ${card.label}
            </div>
            <div id="stat-${card.id}" style="font-size: 16px; font-weight: 700; color: var(--text-primary); margin-top: 2px;">—</div>
          </div>
        `
      )
      .join('');
  }

  private async refreshStats(): Promise<void> {
    if (!this.modalEl || !window.api?.hostServerStats) return;

    let stats: ServerStats | null = null;
    try {
      stats = await window.api.hostServerStats();
    } catch {
      stats = null;
    }
    if (!this.modalEl) return;

    const set = (id: string, value: string) => {
      const el = this.modalEl?.querySelector(`#stat-${id}`) as HTMLElement | null;
      if (el) el.textContent = value;
    };

    if (!stats) {
      ['uptime', 'online', 'members', 'channels', 'messages', 'port'].forEach((id) => set(id, '—'));
      return;
    }

    set('uptime', this.formatUptime(stats.uptimeMs));
    set('online', `${stats.onlineUsers}/${stats.maxUsers}`);
    set('members', String(stats.members));
    set('channels', String(stats.channels));
    set('messages', String(stats.messages));
    set('port', String(stats.port));
  }

  private formatUptime(ms: number): string {
    if (ms <= 0) return '—';
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  private async loadLogs(): Promise<void> {
    if (!window.api?.hostServerLogs) {
      this.entries = [];
      this.renderLogs();
      return;
    }
    try {
      this.entries = (await window.api.hostServerLogs()) || [];
    } catch {
      this.entries = [];
    }
    this.renderLogs();
  }

  private appendEntry(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_RENDERED_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_RENDERED_ENTRIES);
    }
    this.renderLogs();
  }

  private getVisibleEntries(): LogEntry[] {
    const term = this.searchTerm.toLowerCase();
    return this.entries.filter((entry) => {
      if (this.levelFilter !== 'ALL' && entry.level !== this.levelFilter) return false;
      if (!term) return true;
      return (
        entry.message.toLowerCase().includes(term) || entry.category.toLowerCase().includes(term)
      );
    });
  }

  private renderLogs(): void {
    if (!this.modalEl) return;
    const container = this.modalEl.querySelector('#monitor-logs') as HTMLElement | null;
    const countEl = this.modalEl.querySelector('#monitor-count') as HTMLElement | null;
    if (!container) return;

    const visible = this.getVisibleEntries();

    if (countEl) {
      countEl.textContent = t('serverMonitor.entryCount', {
        shown: visible.length,
        total: this.entries.length,
      });
    }

    if (visible.length === 0) {
      container.innerHTML = `<div style="color: var(--text-muted); text-align: center; padding: 16px;">${
        this.entries.length === 0 ? t('serverMonitor.empty') : t('serverMonitor.noMatches')
      }</div>`;
      return;
    }

    container.innerHTML = visible
      .map((entry) => {
        const time = this.formatTime(entry.timestamp);
        return `
          <div style="display: flex; gap: 8px; white-space: pre-wrap; word-break: break-word;">
            <span style="color: var(--text-muted); flex-shrink: 0;">${escapeHtml(time)}</span>
            <span style="color: ${LEVEL_COLORS[entry.level]}; flex-shrink: 0; font-weight: 600;">[${escapeHtml(entry.category)}]</span>
            <span style="color: var(--text-primary);">${escapeHtml(entry.message)}</span>
          </div>
        `;
      })
      .join('');

    if (this.autoScroll) {
      container.scrollTop = container.scrollHeight;
    }
  }

  private formatTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleTimeString();
  }

  private updateLevelButtons(): void {
    if (!this.modalEl) return;
    this.modalEl.querySelectorAll<HTMLElement>('.btn-log-level').forEach((btn) => {
      const isActive = btn.getAttribute('data-level') === this.levelFilter;
      btn.style.background = isActive ? 'var(--accent-primary)' : '';
      btn.style.color = isActive ? '#fff' : '';
      btn.style.borderColor = isActive ? 'var(--accent-primary)' : '';
    });
  }

  private attachEvents(): void {
    if (!this.modalEl) return;

    this.modalEl.querySelector('#modal-close')?.addEventListener('click', () => this.close());
    enableBackdropClose(this.modalEl, () => this.close());

    this.modalEl.querySelectorAll<HTMLElement>('.btn-log-level').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.levelFilter = (btn.getAttribute('data-level') as LogLevel | 'ALL') || 'ALL';
        this.updateLevelButtons();
        this.renderLogs();
      });
    });

    const search = this.modalEl.querySelector('#monitor-search') as HTMLInputElement | null;
    search?.addEventListener('input', () => {
      this.searchTerm = search.value.trim();
      this.renderLogs();
    });

    const autoScroll = this.modalEl.querySelector('#monitor-autoscroll') as HTMLInputElement | null;
    autoScroll?.addEventListener('change', () => {
      this.autoScroll = autoScroll.checked;
      if (this.autoScroll) this.renderLogs();
    });

    this.modalEl.querySelector('#btn-copy-logs')?.addEventListener('click', async () => {
      const text = this.getVisibleEntries()
        .map((entry) => `${entry.timestamp} [${entry.category}] ${entry.message}`)
        .join('\n');
      try {
        await navigator.clipboard.writeText(text);
      } catch (err) {
        console.warn('[ServerMonitorModal] Could not copy logs', err);
      }
    });

    this.modalEl.querySelector('#btn-clear-logs')?.addEventListener('click', async () => {
      try {
        await window.api?.hostServerClearLogs?.();
      } catch (err) {
        console.warn('[ServerMonitorModal] Could not clear logs', err);
      }
      this.entries = [];
      this.renderLogs();
    });
  }

  public close(): void {
    if (this.unsubscribeLog) {
      this.unsubscribeLog();
      this.unsubscribeLog = null;
    }
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }
}

export const serverMonitorModal = new ServerMonitorModal();
