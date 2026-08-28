import { StickerEntry } from '@monky/shared';
import { EMOJI_CATALOG, EmojiGroupId } from '../emoji/emojiCatalog';
import { stickerService } from '../core/StickerService';
import { settingsStore } from '../stores/settingsStore';
import { t, tCount, TranslationKey } from '../i18n';
import { escapeHtml } from '../utils/html';
import { normalizeSearchString } from '../utils/search';

type PickerTab = 'emojis' | 'stickers';

export interface EmojiPickerOptions {
  /** Positioned ancestor the popover is anchored inside (`.chat-input-container`). */
  container: HTMLElement;
  /** Button that toggles the picker; clicks on it must not count as "outside". */
  anchor: HTMLElement;
  onSelectEmoji: (emoji: string) => void;
  onSelectSticker: (sticker: StickerEntry) => void;
}

/** One representative emoji per category, used as the quick-nav icon. */
const GROUP_ICONS: Record<EmojiGroupId, string> = {
  smileys: '😀',
  people: '👋',
  nature: '🐻',
  food: '🍔',
  travel: '✈️',
  activities: '⚽',
  objects: '💡',
  symbols: '❤️',
  flags: '🏁',
};

/** Translated category headings, mapped explicitly so the keys stay type-checked. */
const GROUP_LABEL_KEYS: Record<EmojiGroupId, TranslationKey> = {
  smileys: 'emojiPicker.group.smileys',
  people: 'emojiPicker.group.people',
  nature: 'emojiPicker.group.nature',
  food: 'emojiPicker.group.food',
  travel: 'emojiPicker.group.travel',
  activities: 'emojiPicker.group.activities',
  objects: 'emojiPicker.group.objects',
  symbols: 'emojiPicker.group.symbols',
  flags: 'emojiPicker.group.flags',
};

/** Searching the whole catalog can match hundreds of emojis; only show the first ones. */
const MAX_SEARCH_RESULTS = 240;

/**
 * Emoji and sticker picker for the chat composer (#356).
 *
 * Emojis come from a catalog generated from the Unicode data files, so the
 * picker works offline and adds no runtime dependency. Stickers are images from
 * a folder the user picks, listed through IPC and lazily read as they scroll
 * into view.
 */
export class EmojiPicker {
  private readonly options: EmojiPickerOptions;
  private root: HTMLElement | null = null;
  private tab: PickerTab = 'emojis';
  private query = '';
  private imageObserver: IntersectionObserver | null = null;
  private stickersLoading = false;
  private unbind: Array<() => void> = [];

  constructor(options: EmojiPickerOptions) {
    this.options = options;
  }

  public isOpen(): boolean {
    return this.root !== null;
  }

  public toggle(): void {
    if (this.isOpen()) this.close();
    else void this.open();
  }

  public async open(): Promise<void> {
    if (this.isOpen()) return;

    this.query = '';
    const root = document.createElement('div');
    root.className = 'emoji-picker';
    root.innerHTML = this.renderShell();
    this.options.container.appendChild(root);
    this.root = root;

    this.bindShell();
    this.renderBody();

    root.querySelector<HTMLInputElement>('.emoji-picker-search-input')?.focus();
  }

  public close(): void {
    if (!this.root) return;
    this.imageObserver?.disconnect();
    this.imageObserver = null;
    this.unbind.forEach((off) => off());
    this.unbind = [];
    this.root.remove();
    this.root = null;
  }

  /** Frees every listener; call it when the owning view is torn down. */
  public destroy(): void {
    this.close();
  }

  // --- shell -------------------------------------------------------------

  private renderShell(): string {
    return `
      <div class="emoji-picker-tabs">
        <button type="button" class="emoji-picker-tab" data-picker-tab="emojis">
          <span class="material-symbols-outlined md-16">mood</span>
          ${t('emojiPicker.tabEmojis')}
        </button>
        <button type="button" class="emoji-picker-tab" data-picker-tab="stickers">
          <span class="material-symbols-outlined md-16">gesture</span>
          ${t('emojiPicker.tabStickers')}
        </button>
      </div>
      <div class="emoji-picker-search">
        <span class="material-symbols-outlined md-16">search</span>
        <input type="text" class="emoji-picker-search-input" spellcheck="false">
      </div>
      <div class="emoji-picker-body"></div>
      <div class="emoji-picker-footer"></div>
    `;
  }

  private bindShell(): void {
    const root = this.root;
    if (!root) return;

    root.querySelectorAll<HTMLElement>('[data-picker-tab]').forEach((btn) => {
      const onClick = () => {
        const next = btn.getAttribute('data-picker-tab') as PickerTab;
        if (next === this.tab) return;
        this.tab = next;
        this.query = '';
        const search = root.querySelector<HTMLInputElement>('.emoji-picker-search-input');
        if (search) search.value = '';
        this.renderBody();
        search?.focus();
      };
      btn.addEventListener('click', onClick);
      this.unbind.push(() => btn.removeEventListener('click', onClick));
    });

    const search = root.querySelector<HTMLInputElement>('.emoji-picker-search-input');
    const onSearch = () => {
      this.query = search?.value ?? '';
      this.renderResults();
    };
    search?.addEventListener('input', onSearch);
    this.unbind.push(() => search?.removeEventListener('input', onSearch));

    // The body and footer elements survive every re-render (only their innerHTML
    // changes), so their listeners are attached once here. Binding them from the
    // render functions instead would stack a new handler on every keystroke.
    const body = this.bodyEl;
    const footer = this.footerEl;

    const onBodyClick = (e: Event) => {
      const target = e.target as HTMLElement;

      const emoji = target.closest<HTMLElement>('[data-emoji]')?.getAttribute('data-emoji');
      if (emoji) {
        this.options.onSelectEmoji(emoji);
        return;
      }

      const filePath = target.closest<HTMLElement>('[data-sticker-path]')?.getAttribute('data-sticker-path');
      if (filePath) {
        const sticker = stickerService.getStickers().find((s) => s.filePath === filePath);
        if (sticker) this.options.onSelectSticker(sticker);
      }
    };
    body?.addEventListener('click', onBodyClick);
    this.unbind.push(() => body?.removeEventListener('click', onBodyClick));

    const onFooterClick = (e: Event) => {
      const target = e.target as HTMLElement;

      const groupId = target.closest<HTMLElement>('[data-goto-group]')?.getAttribute('data-goto-group');
      if (groupId) {
        body?.querySelector(`[data-emoji-group="${groupId}"]`)?.scrollIntoView({ block: 'start' });
        return;
      }

      if (target.closest('.emoji-picker-refresh-btn')) {
        void this.refreshStickers();
        return;
      }

      if (target.closest('.emoji-picker-folder-btn')) void this.pickFolder();
    };
    footer?.addEventListener('click', onFooterClick);
    this.unbind.push(() => footer?.removeEventListener('click', onFooterClick));

    // Clicking anywhere else dismisses the popover, except on the toggle button
    // itself (which would otherwise close and immediately reopen it).
    const onDocPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (root.contains(target) || this.options.anchor.contains(target)) return;
      this.close();
    };
    document.addEventListener('mousedown', onDocPointerDown);
    this.unbind.push(() => document.removeEventListener('mousedown', onDocPointerDown));

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    this.unbind.push(() => document.removeEventListener('keydown', onKeyDown, true));
  }

  // --- body --------------------------------------------------------------

  private renderBody(): void {
    const root = this.root;
    if (!root) return;

    root.querySelectorAll<HTMLElement>('[data-picker-tab]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-picker-tab') === this.tab);
    });

    const search = root.querySelector<HTMLInputElement>('.emoji-picker-search-input');
    if (search) {
      search.placeholder =
        this.tab === 'emojis' ? t('emojiPicker.searchEmojis') : t('emojiPicker.searchStickers');
    }

    // The folder listing is async, so the first paint shows a loading state and
    // the grid replaces it once the entries arrive.
    this.stickersLoading = this.tab === 'stickers' && stickerService.hasFolder();
    this.renderResults();

    if (this.stickersLoading) {
      // Always re-read from disk instead of trusting the cached listing: the
      // user can add or delete files while the app is open, and a stale grid
      // looks exactly like the feature being broken.
      void stickerService.loadStickers(true).then(() => {
        this.stickersLoading = false;
        if (this.root && this.tab === 'stickers') this.renderResults();
      });
    }
  }

  private renderResults(): void {
    if (this.tab === 'emojis') this.renderEmojis();
    else this.renderStickers();
  }

  private get bodyEl(): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>('.emoji-picker-body') ?? null;
  }

  private get footerEl(): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>('.emoji-picker-footer') ?? null;
  }

  // --- emojis ------------------------------------------------------------

  private renderEmojis(): void {
    const body = this.bodyEl;
    const footer = this.footerEl;
    if (!body || !footer) return;

    // The catalog terms are already accent-folded, so the query must be too.
    const query = normalizeSearchString(this.query).trim();

    let html: string;
    if (query) {
      const matches: string[] = [];
      for (const group of EMOJI_CATALOG) {
        for (const [char, name, terms] of group.emojis) {
          if (!terms.includes(query)) continue;
          matches.push(this.renderEmojiButton(char, name));
          if (matches.length >= MAX_SEARCH_RESULTS) break;
        }
        if (matches.length >= MAX_SEARCH_RESULTS) break;
      }
      html = matches.length
        ? `<div class="emoji-picker-grid">${matches.join('')}</div>`
        : this.renderEmptyState('search_off', t('emojiPicker.noResults'), '');
      footer.innerHTML = '';
    } else {
      html = EMOJI_CATALOG.map(
        (group) => `
          <div class="emoji-picker-section" data-emoji-group="${group.id}">
            <div class="emoji-picker-section-title">${t(GROUP_LABEL_KEYS[group.id])}</div>
            <div class="emoji-picker-grid">
              ${group.emojis.map(([char, name]) => this.renderEmojiButton(char, name)).join('')}
            </div>
          </div>
        `
      ).join('');
      footer.innerHTML = `
        <div class="emoji-picker-nav">
          ${EMOJI_CATALOG.map(
            (group) => `
              <button type="button" class="emoji-picker-nav-btn" data-goto-group="${group.id}" title="${t(GROUP_LABEL_KEYS[group.id])}">
                ${GROUP_ICONS[group.id]}
              </button>
            `
          ).join('')}
        </div>
      `;
    }

    body.innerHTML = html;
    body.scrollTop = 0;
  }

  private renderEmojiButton(char: string, name: string): string {
    return `<button type="button" class="emoji-picker-item" data-emoji="${escapeHtml(char)}" title="${escapeHtml(name)}">${escapeHtml(char)}</button>`;
  }

  // --- stickers ----------------------------------------------------------

  private renderStickers(): void {
    const body = this.bodyEl;
    const footer = this.footerEl;
    if (!body || !footer) return;

    this.imageObserver?.disconnect();
    this.imageObserver = null;

    if (!stickerService.hasFolder()) {
      body.innerHTML = this.renderEmptyState(
        'folder_open',
        t('emojiPicker.noFolderTitle'),
        t('emojiPicker.noFolderDesc')
      );
      footer.innerHTML = this.renderFolderButton(t('emojiPicker.chooseFolder'));
      return;
    }

    const all = stickerService.getStickers();
    const query = this.query.trim();
    const visible = query
      ? all.filter((s) => normalizeSearchString(s.name).includes(normalizeSearchString(query)))
      : all;

    if (all.length === 0) {
      body.innerHTML = this.stickersLoading
        ? this.renderEmptyState('hourglass_top', t('emojiPicker.loadingStickers'), '')
        : this.renderEmptyState(
            'image_not_supported',
            t('emojiPicker.emptyFolderTitle'),
            t('emojiPicker.emptyFolderDesc')
          );
    } else if (visible.length === 0) {
      body.innerHTML = this.renderEmptyState('search_off', t('emojiPicker.noResults'), '');
    } else {
      body.innerHTML = `
        <div class="emoji-picker-grid emoji-picker-grid--stickers">
          ${visible.map((sticker) => this.renderStickerTile(sticker)).join('')}
        </div>
      `;
    }

    footer.innerHTML = `
      <span class="emoji-picker-footer-info" title="${escapeHtml(settingsStore.stickersFolderPath)}">
        ${tCount('emojiPicker.stickersFound', all.length)}
      </span>
      <button type="button" class="btn btn-secondary emoji-picker-refresh-btn" title="${t('emojiPicker.refresh')}" aria-label="${t('emojiPicker.refresh')}">
        <span class="material-symbols-outlined md-14">refresh</span>
      </button>
      ${this.renderFolderButton(t('emojiPicker.changeFolder'))}
    `;

    this.observeStickerImages(body);
  }

  /** Re-reads the folder on demand, for when the user changed it outside the app. */
  private async refreshStickers(): Promise<void> {
    this.stickersLoading = true;
    if (this.root && this.tab === 'stickers') this.renderResults();

    await stickerService.loadStickers(true);
    this.stickersLoading = false;
    if (this.root && this.tab === 'stickers') this.renderResults();
  }

  /** Opens the folder dialog and reloads the grid with whatever is inside. */
  private async pickFolder(): Promise<void> {
    const folder = await window.api?.selectStickersFolder?.();
    if (!folder) return;

    settingsStore.stickersFolderPath = folder;
    settingsStore.save();
    this.stickersLoading = true;
    if (this.root && this.tab === 'stickers') this.renderResults();

    await stickerService.loadStickers(true);
    this.stickersLoading = false;
    // The popover may have been dismissed while the dialog was open.
    if (this.root && this.tab === 'stickers') this.renderResults();
  }

  private renderStickerTile(sticker: StickerEntry): string {
    const name = escapeHtml(sticker.name);
    if (sticker.tooLarge) {
      // Rendered but not selectable: an oversized file that simply vanished from
      // the grid was indistinguishable from the feature not working at all.
      return `
        <button type="button" class="emoji-picker-item emoji-picker-sticker emoji-picker-sticker--too-large" disabled title="${escapeHtml(t('emojiPicker.stickerTooLarge', { name: sticker.name }))}">
          <span class="material-symbols-outlined md-18">warning</span>
        </button>
      `;
    }
    return `
      <button type="button" class="emoji-picker-item emoji-picker-sticker" data-sticker-path="${escapeHtml(sticker.filePath)}" title="${name}">
        <img class="emoji-picker-sticker-img" alt="${name}" data-sticker-src="${escapeHtml(sticker.filePath)}">
      </button>
    `;
  }

  private renderFolderButton(label: string): string {
    return `
      <button type="button" class="btn btn-secondary emoji-picker-folder-btn">
        <span class="material-symbols-outlined md-14">folder_open</span>
        ${label}
      </button>
    `;
  }

  /** Reads sticker bytes only once a tile is about to be shown. */
  private observeStickerImages(body: HTMLElement): void {
    const images = body.querySelectorAll<HTMLImageElement>('[data-sticker-src]');
    if (images.length === 0) return;

    this.imageObserver = new IntersectionObserver(
      (entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const img = entry.target as HTMLImageElement;
          observer.unobserve(img);
          const filePath = img.getAttribute('data-sticker-src');
          if (!filePath) continue;
          void stickerService.getDataUrl(filePath).then((dataUrl) => {
            if (dataUrl && img.isConnected) img.src = dataUrl;
          });
        }
      },
      { root: body, rootMargin: '120px' }
    );

    images.forEach((img) => this.imageObserver?.observe(img));
  }

  private renderEmptyState(icon: string, title: string, description: string): string {
    return `
      <div class="emoji-picker-empty">
        <span class="material-symbols-outlined md-32">${icon}</span>
        <div class="emoji-picker-empty-title">${title}</div>
        ${description ? `<div class="emoji-picker-empty-desc">${description}</div>` : ''}
      </div>
    `;
  }
}
