import type { ReleaseNotesResult } from '@monky/shared';
import { t } from '../i18n';
import { escapeHtml } from '../utils/html';
import { enableBackdropClose } from '../utils/modal';

const RELEASES_URL = 'https://github.com/MonkyOrg/Monky/releases/latest';

interface OpenOptions {
  /** Specific tag to fetch (e.g. "v8.2.8-beta"). Defaults to the running version. */
  tag?: string;
  /** Show the celebratory "updated to" header (used right after an update). */
  celebrate?: boolean;
  /**
   * Only open when there is real changelog content. Used by the auto-show after
   * an update, so an offline start (or a version with no release) falls back to
   * the plain banner instead of flashing an empty modal.
   */
  requireContent?: boolean;
}

/**
 * In-app changelog shown once after an update and on demand from Settings
 * (#547). The notes come from the GitHub release for the version (fetched in the
 * main process); this only extracts the "Changelog" section and renders a small,
 * safe subset of Markdown — every piece of text is HTML-escaped first, so a
 * release body can never inject markup into the app.
 */
export class ChangelogModal {
  private modalEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private unbind: Array<() => void> = [];
  private celebrate = false;
  private githubUrl = RELEASES_URL;

  public isOpen(): boolean {
    return !!this.modalEl;
  }

  /**
   * Opens the changelog. Resolves to whether a modal was shown: the auto-show
   * path passes `requireContent` and uses the result to decide whether to fall
   * back to the banner.
   */
  public async open(options: OpenOptions = {}): Promise<boolean> {
    if (this.modalEl) return true;
    if (!window.api?.getReleaseNotes) return false;

    this.celebrate = options.celebrate ?? false;

    if (options.requireContent) {
      const res = await this.fetchNotes(options.tag);
      const changelog = res.ok ? this.extractChangelog(res.body ?? '') : '';
      if (!res.ok || !changelog.trim()) {
        return false;
      }
      this.buildShell();
      this.applyResult(res, changelog);
      return true;
    }

    // On-demand (Settings): show the shell with a loading line, then fill it in.
    this.buildShell();
    this.setLoading();
    const res = await this.fetchNotes(options.tag);
    if (!this.modalEl) return true; // closed while loading
    this.applyResult(res, res.ok ? this.extractChangelog(res.body ?? '') : '');
    return true;
  }

  public close(): void {
    this.unbind.forEach((fn) => fn());
    this.unbind = [];
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
    this.bodyEl = null;
    this.titleEl = null;
    this.githubUrl = RELEASES_URL;
  }

  private async fetchNotes(tag?: string): Promise<ReleaseNotesResult> {
    try {
      return await window.api.getReleaseNotes(tag);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private buildShell(): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" style="max-width: 560px; width: 92%; display: flex; flex-direction: column;">
        <div class="modal-header">
          <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
            <span class="material-symbols-outlined" style="color: var(--accent-primary);">${this.celebrate ? 'celebration' : 'auto_awesome'}</span>
            <span data-el="title">${escapeHtml(t('changelog.title'))}</span>
          </div>
          <button id="modal-close" class="modal-close-btn" aria-label="${escapeHtml(t('common.close'))}">&times;</button>
        </div>
        <div data-el="body" class="changelog-body" style="max-height: 55vh; overflow-y: auto; padding: 4px 4px 2px; line-height: 1.5; font-size: 13px;"></div>
        <div class="modal-footer">
          <button type="button" id="changelog-github" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;">
            <span class="material-symbols-outlined md-16" style="margin-right: 4px;">open_in_new</span>
            ${escapeHtml(t('changelog.viewOnGithub'))}
          </button>
          <button type="button" id="changelog-close" class="btn btn-primary" style="font-size: 12px; padding: 6px 12px;">${escapeHtml(t('common.close'))}</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    this.modalEl = backdrop;
    this.bodyEl = backdrop.querySelector('[data-el="body"]');
    this.titleEl = backdrop.querySelector('[data-el="title"]');

    backdrop.querySelector('#modal-close')?.addEventListener('click', () => this.close());
    backdrop.querySelector('#changelog-close')?.addEventListener('click', () => this.close());
    backdrop.querySelector('#changelog-github')?.addEventListener('click', () => this.openGithub());
    enableBackdropClose(backdrop, () => this.close());

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    this.unbind.push(() => window.removeEventListener('keydown', onKeyDown, true));
  }

  private setLoading(): void {
    if (this.bodyEl) {
      this.bodyEl.innerHTML = `<p class="changelog-empty" style="color: var(--text-muted);">${escapeHtml(t('changelog.loading'))}</p>`;
    }
  }

  private applyResult(res: ReleaseNotesResult, changelog: string): void {
    if (res.ok && res.url) {
      this.githubUrl = res.url;
    }
    if (this.titleEl && res.ok && res.version) {
      this.titleEl.textContent = this.celebrate
        ? t('changelog.updatedTo', { version: `v${res.version}` })
        : t('changelog.titleVersion', { version: `v${res.version}` });
    }
    if (this.bodyEl) {
      this.bodyEl.innerHTML = changelog.trim()
        ? this.renderMarkdown(changelog)
        : `<p class="changelog-empty" style="color: var(--text-muted);">${escapeHtml(t('changelog.unavailable'))}</p>`;
    }
  }

  private openGithub(): void {
    const url = this.githubUrl;
    if (!window.api?.openExternal) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    window.api
      .openExternal(url)
      .then((r) => {
        if (!r?.success) window.open(url, '_blank', 'noopener');
      })
      .catch(() => window.open(url, '_blank', 'noopener'));
  }

  /**
   * Isolates the "Changelog" section from the full release body, dropping the
   * Downloads/verification boilerplate above it. Returns empty when the marker
   * is absent, so nothing but the curated notes is ever shown.
   */
  private extractChangelog(body: string): string {
    if (!body) return '';
    const parts = body.replace(/\r\n/g, '\n').split(/^\s*#{2,4}\s+Changelog\s*$/im);
    if (parts.length < 2) return '';
    return parts[parts.length - 1].trim();
  }

  /**
   * Renders the safe Markdown subset the changelog uses: `####`/`###` headings,
   * `-`/`*` bullets and `**bold**`. Text is escaped before any tag is added, and
   * links are dropped to plain text — the single "view on GitHub" button covers
   * navigation, so no arbitrary href from a release body is ever rendered.
   */
  private renderMarkdown(md: string): string {
    const inline = (text: string): string =>
      escapeHtml(text)
        .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    const lines = md.replace(/\r\n/g, '\n').split('\n');
    const out: string[] = [];
    let inList = false;
    const closeList = (): void => {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
    };

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) {
        closeList();
        continue;
      }
      // The comparison link is already reachable through the GitHub button.
      if (/^\*\*Compara[çc][ãa]o completa\*\*/i.test(line)) {
        closeList();
        continue;
      }
      let m: RegExpExecArray | null;
      if ((m = /^#{3,4}\s+(.*)$/.exec(line))) {
        closeList();
        out.push(
          `<div class="changelog-group" style="font-weight: 700; margin: 12px 0 4px;">${inline(m[1])}</div>`
        );
      } else if ((m = /^[-*]\s+(.*)$/.exec(line))) {
        if (!inList) {
          out.push('<ul style="margin: 0 0 4px; padding-left: 20px;">');
          inList = true;
        }
        out.push(`<li style="margin: 2px 0;">${inline(m[1])}</li>`);
      } else {
        closeList();
        out.push(`<p style="margin: 6px 0;">${inline(line)}</p>`);
      }
    }
    closeList();
    return out.join('\n');
  }
}

export const changelogModal = new ChangelogModal();
