import { ChatMessage, LIMITS, MessageType, Permission } from '@monky/shared';
import type { AttachmentMeta, UserSummary } from '@monky/shared';
import { escapeHtml } from '../utils/html';
import { appEvents } from '../core/EventBus';
import { networkClient } from '../core/NetworkClient';
import { chatStore } from '../stores/chatStore';
import { serverStore } from '../stores/serverStore';
import { participantManager } from '../core/ParticipantManager';
import { userContextMenu } from './UserContextMenu';
import { getAvatarUrl } from '../utils/avatar';
import { renderMarkdown } from '../utils/markdown';
import { getLanguage, t } from '../i18n';
import { uploadAttachment, UploadHandle } from '../core/AttachmentUploader';
import { getAttachmentUrl, formatBytes, fileIconName } from '../utils/attachment';
import { showAlert } from './Dialog';

/** A file picked for upload, tracked until its message is sent (#11). */
interface PendingAttachment {
  localId: string;
  name: string;
  size: number;
  isImage: boolean;
  previewUrl: string | null;
  status: 'uploading' | 'done' | 'error';
  progress: number;
  meta?: AttachmentMeta;
  error?: string;
  handle?: UploadHandle;
}

interface LightboxMedia {
  kind: 'image' | 'video';
  url: string;
  fileName: string;
  senderName: string;
  timestamp: string;
  source: HTMLElement;
}

interface LinkPreviewData {
  url: string;
  title: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
}

export class ChatView {
  private container: HTMLElement;
  private currentChannelId: string | null = null;
  private unbindEvents: Array<() => void> = [];
  // @-mention autocomplete state (#14)
  private mentionActive = false;
  private mentionMatches: UserSummary[] = [];
  private mentionActiveIndex = 0;
  private mentionAtIndex = -1;
  // Files picked for the next message, keyed by a local id (#11).
  private pending: PendingAttachment[] = [];
  private uploadSeq = 0;
  private closeLightbox: (() => void) | null = null;
  private linkPreviewCache = new Map<string, LinkPreviewData | null>();
  private linkPreviewRequests = new Map<string, Promise<LinkPreviewData | null>>();

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public setChannel(channelId: string): void {
    this.currentChannelId = channelId;
    // Switching channels discards any files staged for the previous channel (#11).
    this.clearPending();
    // Opening a channel reads its mentions: clear the local badge and tell the
    // server so offline-delivered mentions aren't re-shown next connect (#14).
    chatStore.clearMention(channelId);
    networkClient.send(MessageType.CHAT_MENTIONS_READ, { channelId });
    this.render();
    this.loadHistory();
    // Auto-focus the message input after the fresh DOM has settled (#181).
    this.focusChatInput({ defer: true });
  }

  public render(): void {
    if (!this.currentChannelId || !serverStore.serverDetails) {
      this.container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted);">
          ${t('chat.selectChannel')}
        </div>
      `;
      return;
    }

    const channel = serverStore.serverDetails.channels.find((c) => c.id === this.currentChannelId);
    const channelName = channel ? channel.name : 'geral';
    const canSendMessages = serverStore.hasPermission(Permission.SEND_MESSAGES);
    const canAttachFiles = serverStore.hasPermission(Permission.ATTACH_FILES);

    this.container.innerHTML = `
      <div class="chat-container">
        <div id="chat-drop-overlay" class="chat-drop-overlay">
          <div class="drop-inner">
            <span class="material-symbols-outlined" style="font-size: 48px;">upload_file</span>
            <div class="drop-title">${t('chat.dropTitle')}</div>
            <div class="drop-sub">${t('chat.dropSubtitle')}</div>
          </div>
        </div>
        <div class="content-header">
          <div class="channel-title-container">
            <span class="material-symbols-outlined md-18" style="color: var(--text-muted);">tag</span>
            <span class="channel-title">${escapeHtml(channelName)}</span>
          </div>
          <div class="header-status-badge">${t('chat.textChannelBadge')}</div>
        </div>

        <div id="chat-messages-feed" class="chat-messages-feed"></div>

        <div class="chat-input-container">
          <div id="mention-dropup" class="mention-dropup" style="display: none;"></div>
          <div id="chat-attachment-tray" class="chat-attachment-tray" style="display: none;"></div>
          <div class="chat-input-wrapper">
            <button id="btn-attach" type="button" class="chat-attach-btn" title="${t('chat.attachFile')}" ${canAttachFiles ? '' : 'disabled'}>
              <span class="material-symbols-outlined md-22">add_circle</span>
            </button>
            <input id="chat-file-input" type="file" multiple style="display: none;">
            <textarea id="chat-message-input" class="chat-input-field" rows="1" placeholder="${t('chat.inputPlaceholder', { channel: escapeHtml(channelName) })}" maxlength="${LIMITS.MAX_MESSAGE_LENGTH}"></textarea>
            <span id="chat-char-counter" class="chat-char-count">0/${LIMITS.MAX_MESSAGE_LENGTH}</span>
            <button id="btn-send-message" class="btn btn-primary" style="padding: 6px 14px; font-size: 13px;" ${canSendMessages ? '' : 'disabled'}>
              <span class="material-symbols-outlined md-16" style="margin-right: 4px;">send</span>
              ${t('chat.send')}
            </button>
          </div>
        </div>
      </div>
    `;

    this.renderMessages();
    this.attachEvents();
  }

  private loadHistory(): void {
    if (!this.currentChannelId) return;

    networkClient.send(MessageType.CHAT_LOAD_HISTORY, {
      channelId: this.currentChannelId,
      limit: LIMITS.MAX_HISTORY_MESSAGES_INITIAL,
    });
  }

  private renderMessages(): void {
    const feed = document.getElementById('chat-messages-feed');
    if (!feed || !this.currentChannelId) return;

    const messages = chatStore.getMessages(this.currentChannelId);
    if (messages.length === 0) {
      feed.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); gap: 10px;">
          <span class="material-symbols-outlined md-36" style="color: var(--text-dim); font-size: 44px;">forum</span>
          <div style="font-size: 15px; font-weight: 600; color: var(--text-secondary);">${t('chat.emptyTitle', { channel: escapeHtml(serverStore.serverDetails?.channels.find((c) => c.id === this.currentChannelId)?.name || 'geral') })}</div>
          <div style="font-size: 13px;">${t('chat.emptySubtitle')}</div>
        </div>
      `;
      return;
    }

    feed.innerHTML = this.renderMessagesWithDividers(messages);

    // Open markdown links in the external browser instead of navigating the app.
    feed.querySelectorAll('a.md-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const url = link.getAttribute('data-external-link');
        if (url && window.api?.openExternal) {
          window.api.openExternal(url);
        }
      });
    });

    this.initializeLinkPreviews(feed);

    // Attach right-click context menu on message rows (when not selecting text)
    feed.querySelectorAll('.chat-message-row').forEach((row) => {
      row.addEventListener('contextmenu', (e: Event) => {
        const mouseEvent = e as MouseEvent;
        // If text is currently highlighted / selected, allow normal browser selection copy
        const selection = window.getSelection()?.toString();
        if (selection && selection.trim().length > 0) {
          return;
        }

        const userId = row.getAttribute('data-user-id');
        if (!userId) return;

        const targetUser =
          participantManager.get(userId)?.user ||
          serverStore.serverDetails?.members.find((m) => m.id === userId);

        if (targetUser && targetUser.id !== serverStore.currentUser?.id) {
          mouseEvent.preventDefault();
          userContextMenu.open(mouseEvent.clientX, mouseEvent.clientY, targetUser);
        }
      });
    });

    this.bindMediaInteractions(feed);
    this.initializeCustomVideoPlayers(feed);

    this.scrollToBottom();
  }

  /** Interleaves messages with a per-day divider line (#11). */
  private renderMessagesWithDividers(messages: ChatMessage[]): string {
    const parts: string[] = [];
    let lastKey = '';
    for (const m of messages) {
      const key = this.dateKey(m.createdAt);
      if (key !== lastKey) {
        parts.push(this.renderDateDivider(m.createdAt));
        lastKey = key;
      }
      parts.push(this.renderMessageRow(m));
    }
    return parts.join('');
  }

  private dateKey(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  private renderDateDivider(ts: number): string {
    const label = new Date(ts).toLocaleDateString(getLanguage(), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    return `<div class="chat-date-divider"><span class="chat-date-divider-label">${escapeHtml(label)}</span></div>`;
  }

  /** Full date + time shown on each message, e.g. "24/08/2026 19:15" (#11). */
  private formatDateTime(ts: number): string {
    const d = new Date(ts);
    const date = d.toLocaleDateString(getLanguage());
    const time = d.toLocaleTimeString(getLanguage(), { hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  }

  private focusChatInput(options?: { defer?: boolean }): void {
    const applyFocus = () => {
      const input = this.container.querySelector('#chat-message-input') as HTMLTextAreaElement | null;
      if (!input) return;
      input.focus({ preventScroll: true });
      const caret = input.value.length;
      input.setSelectionRange(caret, caret);
    };

    if (options?.defer) {
      requestAnimationFrame(() => requestAnimationFrame(applyFocus));
      return;
    }

    applyFocus();
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    const el =
      target instanceof HTMLElement
        ? target
        : target instanceof Node
          ? target.parentElement
          : null;
    if (!el) return false;
    return !!el.closest('textarea, input, [contenteditable]:not([contenteditable="false"])');
  }

  private isUserMentioned(content: string, currentNickname: string): boolean {
    if (!content || !currentNickname) return false;
    const escaped = currentNickname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|[\\s(])@${escaped}(?=$|[\\s),.!?:;])`, 'i');
    return regex.test(content);
  }

  private renderMessageRow(m: ChatMessage): string {
    const time = this.formatDateTime(m.createdAt);

    if (m.isSystem) {
      return `
        <div class="system-message-row">
          <span class="material-symbols-outlined md-14" style="color: var(--accent-primary);">info</span>
          <span>${escapeHtml(m.content)}</span>
          <span style="font-size: 10px; color: var(--text-muted); margin-left: auto;">${time}</span>
        </div>
      `;
    }

    const me = serverStore.currentUser;
    const currentNickname = me?.nickname?.trim();
    const isMentioned = !m.isSystem && !!currentNickname && this.isUserMentioned(m.content, currentNickname);

    const knownNicknames = Array.from(serverStore.knownMembers.values()).map((u) => u.nickname);
    if (currentNickname && !knownNicknames.includes(currentNickname)) {
      knownNicknames.push(currentNickname);
    }

    const avatarSrc = getAvatarUrl(m.userAvatarUrl);
    const textHtml =
      m.content && m.content.trim().length > 0
        ? `<div class="chat-message-text">${renderMarkdown(m.content, { currentNickname, knownNicknames })}</div>`
        : '';
    const attachmentsHtml = this.renderAttachments(m.attachments, m);
    const rowClass = `chat-message-row${isMentioned ? ' chat-message-mentioned' : ''}`;

    return `
      <div class="${rowClass}" data-user-id="${m.userId}" data-message-id="${m.id}">
        <img class="chat-author-avatar" src="${avatarSrc}">
        <div class="chat-message-body">
          <div class="chat-author-header">
            <span class="chat-author-name">${escapeHtml(m.userNickname)}</span>
            <span class="chat-timestamp">${time}</span>
          </div>
          ${textHtml}
          <div class="chat-link-previews" data-message-id="${escapeHtml(m.id)}"></div>
          ${attachmentsHtml}
        </div>
      </div>
    `;
  }

  /** Renders the attachment grid below a message body (#11). */
  private renderAttachments(attachments?: AttachmentMeta[], message?: ChatMessage): string {
    if (!attachments || attachments.length === 0) return '';
    const items = attachments.map((a) => this.renderAttachment(a, message)).join('');
    return `<div class="chat-attachments">${items}</div>`;
  }

  private renderAttachment(a: AttachmentMeta, message?: ChatMessage): string {
    // FIFO eviction removed the binary: show a placeholder instead of a broken link.
    if (!a.url) {
      return `
        <div class="attachment-evicted" title="${escapeHtml(a.originalName)}">
          <span class="material-symbols-outlined md-18">hide_source</span>
          <span>${t('chat.attachmentEvicted')}</span>
        </div>
      `;
    }

    const src = getAttachmentUrl(a.url);
    const name = escapeHtml(a.originalName);
    const senderName = escapeHtml(message?.userNickname || '');
    const sentAt = escapeHtml(message ? this.formatDateTime(message.createdAt) : '');
    const lightboxMeta = `
      data-lightbox-sender="${senderName}"
      data-lightbox-timestamp="${sentAt}"
    `;
    const inlineActions = `
      <div class="chat-inline-media-actions">
        <button
          type="button"
          class="chat-attachment-action chat-attachment-lightbox-trigger"
          title="${t('chat.openMediaViewer')}"
        >
          <span class="material-symbols-outlined md-18">open_in_full</span>
        </button>
        <button
          type="button"
          class="chat-attachment-action chat-attachment-download"
          data-download-url="${src}"
          data-file-name="${name}"
          title="${t('common.download')}"
        >
          <span class="material-symbols-outlined md-18">download</span>
        </button>
      </div>
    `;

    if (a.kind === 'image') {
      return `
        <div
          class="chat-inline-media chat-inline-media--image"
          data-lightbox-kind="image"
          data-lightbox-url="${src}"
          data-lightbox-name="${name}"
          ${lightboxMeta}
        >
          <img class="chat-attachment-image" src="${src}" alt="${name}" title="${name}" loading="lazy">
          ${inlineActions}
        </div>
      `;
    }

    if (a.kind === 'video') {
      return `
        <div
          class="chat-attachment-video-wrap chat-inline-media chat-inline-media--video"
          data-lightbox-kind="video"
          data-lightbox-url="${src}"
          data-lightbox-name="${name}"
          ${lightboxMeta}
        >
          <div class="chat-video-player">
            <video class="chat-attachment-video" preload="metadata" src="${src}" playsinline></video>
            ${inlineActions}
          </div>
        </div>
      `;
    }

    return `
      <button
        type="button"
        class="chat-attachment-file"
        data-download-url="${src}"
        data-file-name="${name}"
        title="${t('common.download')} ${name}"
      >
        <span class="material-symbols-outlined md-24 af-icon">${fileIconName(a.kind, a.mimeType, a.originalName)}</span>
        <span class="af-meta">
          <span class="af-name">${name}</span>
          <span class="af-size">${formatBytes(a.sizeBytes)}</span>
        </span>
        <span class="material-symbols-outlined md-20 af-dl">download</span>
      </button>
    `;
  }

  private initializeLinkPreviews(feed: HTMLElement): void {
    if (!window.api?.fetchLinkPreview) return;

    feed.querySelectorAll<HTMLElement>('.chat-link-previews').forEach((container) => {
      const row = container.closest('.chat-message-row') as HTMLElement | null;
      if (!row) {
        container.remove();
        return;
      }

      const urls = this.collectPreviewUrls(row);
      if (urls.length === 0) {
        container.remove();
        return;
      }

      container.innerHTML = '';
      for (const url of urls) {
        const slot = document.createElement('div');
        slot.className = 'chat-link-preview-slot';
        slot.innerHTML = this.renderLinkPreviewSkeleton();
        container.appendChild(slot);
        void this.populateLinkPreview(url, slot);
      }
    });
  }

  private collectPreviewUrls(row: HTMLElement): string[] {
    const attachmentUrls = new Set<string>();
    row.querySelectorAll<HTMLElement>('[data-download-url], [data-lightbox-url]').forEach((element) => {
      const rawUrl = element.getAttribute('data-download-url') || element.getAttribute('data-lightbox-url');
      const normalized = this.normalizePreviewUrl(rawUrl);
      if (normalized) {
        attachmentUrls.add(normalized);
      }
    });

    const seen = new Set<string>();
    const urls: string[] = [];
    row.querySelectorAll<HTMLAnchorElement>('.chat-message-text .md-link[data-external-link]').forEach((link) => {
      const normalized = this.normalizePreviewUrl(link.getAttribute('data-external-link'));
      if (!normalized || seen.has(normalized) || attachmentUrls.has(normalized)) {
        return;
      }

      seen.add(normalized);
      urls.push(normalized);
    });

    return urls;
  }

  private normalizePreviewUrl(url: string | null | undefined): string | null {
    if (!url) return null;

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }

      parsed.hash = '';
      return parsed.toString();
    } catch {
      return null;
    }
  }

  private async populateLinkPreview(url: string, slot: HTMLElement): Promise<void> {
    const preview = await this.fetchLinkPreview(url);
    if (!slot.isConnected) return;

    const parent = slot.parentElement;
    if (!preview) {
      slot.remove();
      if (parent && parent.childElementCount === 0) {
        parent.remove();
      }
      return;
    }

    slot.innerHTML = this.renderLinkPreviewCard(preview);

    const card = slot.querySelector<HTMLElement>('.chat-link-preview');
    card?.addEventListener('click', () => {
      void window.api.openExternal(preview.url);
    });

    const favicon = slot.querySelector<HTMLImageElement>('.chat-link-preview-favicon');
    favicon?.addEventListener('error', () => {
      const iconWrap = favicon.parentElement;
      if (!iconWrap) return;
      iconWrap.classList.add('chat-link-preview-site-icon--fallback');
      iconWrap.innerHTML = '<span class="material-symbols-outlined md-16">public</span>';
    });

    const thumb = slot.querySelector<HTMLImageElement>('.chat-link-preview-thumb');
    thumb?.addEventListener('error', () => {
      thumb.closest('.chat-link-preview-media')?.remove();
      card?.classList.add('chat-link-preview--no-image');
    });
  }

  private async fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
    if (this.linkPreviewCache.has(url)) {
      return this.linkPreviewCache.get(url) ?? null;
    }

    const pendingRequest = this.linkPreviewRequests.get(url);
    if (pendingRequest) {
      return pendingRequest;
    }

    const request = window.api.fetchLinkPreview(url)
      .catch(() => null)
      .then((preview) => {
        this.linkPreviewCache.set(url, preview);
        const normalizedPreviewUrl = this.normalizePreviewUrl(preview?.url);
        if (normalizedPreviewUrl && normalizedPreviewUrl !== url) {
          this.linkPreviewCache.set(normalizedPreviewUrl, preview);
        }
        this.linkPreviewRequests.delete(url);
        return preview;
      });

    this.linkPreviewRequests.set(url, request);
    return request;
  }

  private renderLinkPreviewSkeleton(): string {
    return `
      <div class="chat-link-preview chat-link-preview--loading" aria-hidden="true">
        <div class="chat-link-preview-main">
          <div class="chat-link-preview-site">
            <span class="chat-link-preview-site-icon chat-link-preview-skeleton-block"></span>
            <span class="chat-link-preview-skeleton-line chat-link-preview-skeleton-line--site"></span>
          </div>
          <span class="chat-link-preview-skeleton-line chat-link-preview-skeleton-line--title"></span>
          <span class="chat-link-preview-skeleton-line chat-link-preview-skeleton-line--text"></span>
          <span class="chat-link-preview-skeleton-line chat-link-preview-skeleton-line--text chat-link-preview-skeleton-line--short"></span>
        </div>
        <div class="chat-link-preview-media chat-link-preview-skeleton-block"></div>
      </div>
    `;
  }

  private renderLinkPreviewCard(preview: LinkPreviewData): string {
    const normalizedUrl = this.normalizePreviewUrl(preview.url) ?? preview.url;
    const hostname = this.getPreviewHostname(normalizedUrl);
    const siteLabel = escapeHtml((preview.siteName || hostname || normalizedUrl).trim());
    const title = escapeHtml((preview.title || preview.siteName || hostname || normalizedUrl).trim());
    const description = preview.description ? escapeHtml(preview.description.trim()) : '';
    const faviconHtml = preview.favicon
      ? `<img class="chat-link-preview-favicon" src="${escapeHtml(preview.favicon)}" alt="" loading="lazy">`
      : '<span class="material-symbols-outlined md-16">public</span>';
    const thumbHtml = preview.image
      ? `
        <div class="chat-link-preview-media">
          <img class="chat-link-preview-thumb" src="${escapeHtml(preview.image)}" alt="" loading="lazy">
        </div>
      `
      : '';

    return `
      <button
        type="button"
        class="chat-link-preview${preview.image ? '' : ' chat-link-preview--no-image'}"
        title="${escapeHtml(normalizedUrl)}"
      >
        <div class="chat-link-preview-main">
          <div class="chat-link-preview-site">
            <span class="chat-link-preview-site-icon${preview.favicon ? '' : ' chat-link-preview-site-icon--fallback'}">
              ${faviconHtml}
            </span>
            <span class="chat-link-preview-site-label">${siteLabel}</span>
          </div>
          <span class="chat-link-preview-title">${title}</span>
          ${description ? `<span class="chat-link-preview-description">${description}</span>` : ''}
        </div>
        ${thumbHtml}
      </button>
    `;
  }

  private getPreviewHostname(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./i, '');
    } catch {
      return '';
    }
  }

  private bindMediaInteractions(feed: HTMLElement): void {
    feed.querySelectorAll('.chat-inline-media[data-lightbox-kind="image"] .chat-attachment-image').forEach((img) => {
      img.addEventListener('click', () => {
        const source = (img as HTMLElement).closest('[data-lightbox-kind]') as HTMLElement | null;
        if (source) this.openLightboxFromSource(source);
      });
    });

    feed.querySelectorAll('.chat-attachment-lightbox-trigger').forEach((button) => {
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const source = (button as HTMLElement).closest('[data-lightbox-kind]') as HTMLElement | null;
        if (source) this.openLightboxFromSource(source);
      });
    });

    feed.querySelectorAll('.chat-attachment-file').forEach((chip) => {
      chip.addEventListener('click', () => {
        const url = chip.getAttribute('data-download-url');
        const name = chip.getAttribute('data-file-name') || 'attachment';
        if (url) void this.downloadAttachment(url, name);
      });
    });

    feed.querySelectorAll('.chat-attachment-download').forEach((button) => {
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const url = button.getAttribute('data-download-url');
        const name = button.getAttribute('data-file-name') || 'attachment';
        if (url) void this.downloadAttachment(url, name);
      });
    });
  }

  private initializeCustomVideoPlayers(root: ParentNode): void {
    root.querySelectorAll<HTMLElement>('.chat-video-player').forEach((player) => {
      if (player.dataset.enhanced === 'true') return;
      player.dataset.enhanced = 'true';

      const video = player.querySelector('video') as HTMLVideoElement | null;
      if (!video) return;

      video.controls = false;
      video.removeAttribute('controls');
      video.playsInline = true;
      video.volume = video.volume || 0.8;

      const bigPlay = document.createElement('button');
      bigPlay.type = 'button';
      bigPlay.className = 'chat-video-big-play';
      bigPlay.title = t('common.play');
      bigPlay.innerHTML = '<span class="material-symbols-outlined md-36">play_arrow</span>';

      const controls = document.createElement('div');
      controls.className = 'chat-video-controls';
      controls.innerHTML = `
        <div class="chat-video-progress-shell">
          <input
            type="range"
            class="sb-slider chat-video-seek"
            min="0"
            max="100"
            step="0.1"
            value="0"
            style="--slider-progress: 0%;"
            aria-label="${t('chat.videoSeek')}"
            title="${t('chat.videoSeek')}"
          >
        </div>
        <div class="chat-video-controls-row">
          <button type="button" class="chat-video-control-btn" data-action="play" title="${t('common.play')}">
            <span class="material-symbols-outlined md-20">play_arrow</span>
          </button>
          <div class="stage-volume-wrapper chat-video-volume-wrapper">
            <div class="stage-volume-popup chat-video-volume-popup">
              <input
                type="range"
                class="chat-video-volume"
                min="0"
                max="1"
                step="0.05"
                value="${video.volume || 0.8}"
                aria-label="${t('chat.videoVolume')}"
                title="${t('chat.videoVolume')}"
              >
            </div>
            <button type="button" class="chat-video-control-btn stage-volume-btn" data-action="mute" title="${t('common.mute')}">
              <span class="material-symbols-outlined md-20">volume_up</span>
            </button>
          </div>
          <div class="chat-video-time">00:00 / --:--</div>
          <button type="button" class="chat-video-control-btn" data-action="fullscreen" title="${t('common.fullscreen')}">
            <span class="material-symbols-outlined md-20">fullscreen</span>
          </button>
        </div>
      `;

      player.append(bigPlay, controls);

      const playButton = controls.querySelector('[data-action="play"]') as HTMLButtonElement | null;
      const playIcon = playButton?.querySelector('.material-symbols-outlined') as HTMLElement | null;
      const muteButton = controls.querySelector('[data-action="mute"]') as HTMLButtonElement | null;
      const muteIcon = muteButton?.querySelector('.material-symbols-outlined') as HTMLElement | null;
      const fullscreenButton = controls.querySelector('[data-action="fullscreen"]') as HTMLButtonElement | null;
      const fullscreenIcon = fullscreenButton?.querySelector('.material-symbols-outlined') as HTMLElement | null;
      const progress = controls.querySelector('.chat-video-seek') as HTMLInputElement | null;
      const volume = controls.querySelector('.chat-video-volume') as HTMLInputElement | null;
      const volumeWrapper = controls.querySelector('.chat-video-volume-wrapper') as HTMLElement | null;
      const timeDisplay = controls.querySelector('.chat-video-time') as HTMLElement | null;
      let lastVolume = video.volume || 0.8;

      const syncRangeFill = (input: HTMLInputElement, ratio: number) => {
        const percent = `${Math.max(0, Math.min(ratio * 100, 100))}%`;
        input.style.setProperty('--slider-progress', percent);
        input.style.setProperty('--value', percent);
      };

      const getVolumeIcon = (level: number) => {
        if (level <= 0.001) return 'volume_off';
        if (level < 0.5) return 'volume_down';
        return 'volume_up';
      };

      const updatePlayState = () => {
        const paused = video.paused || video.ended;
        player.classList.toggle('is-paused', paused);
        if (playIcon) playIcon.innerText = paused ? 'play_arrow' : 'pause';
        if (playButton) playButton.title = paused ? t('common.play') : t('common.pause');
        bigPlay.title = paused ? t('common.play') : t('common.pause');
      };

      const updateTimeline = () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
        if (timeDisplay) {
          timeDisplay.innerText = `${this.formatMediaTime(current)} / ${duration > 0 ? this.formatMediaTime(duration) : '--:--'}`;
        }
        if (progress) {
          const ratio = duration > 0 ? current / duration : 0;
          progress.value = `${ratio * 100}`;
          syncRangeFill(progress, ratio);
        }
      };

      const updateVolumeState = () => {
        const level = video.muted ? 0 : video.volume;
        if (muteIcon) muteIcon.innerText = getVolumeIcon(level);
        if (muteButton) muteButton.title = level <= 0.001 ? t('common.unmute') : t('common.mute');
        if (volume) {
          volume.value = `${level}`;
          syncRangeFill(volume, level);
        }
      };

      const updateFullscreenState = () => {
        const isFullscreen = document.fullscreenElement === player;
        if (fullscreenIcon) fullscreenIcon.innerText = isFullscreen ? 'fullscreen_exit' : 'fullscreen';
        if (fullscreenButton) {
          fullscreenButton.title = isFullscreen ? t('common.exitFullscreen') : t('common.fullscreen');
        }
      };

      const togglePlay = async () => {
        try {
          if (video.paused || video.ended) {
            if (video.ended) video.currentTime = 0;
            await video.play();
          } else {
            video.pause();
          }
        } catch (err) {
          console.warn('[ChatView] Unable to toggle video playback:', err);
        }
      };

      player.querySelectorAll('.chat-attachment-action').forEach((button) => {
        button.addEventListener('click', (e) => e.stopPropagation());
      });
      controls.addEventListener('pointerdown', (e) => e.stopPropagation());
      controls.addEventListener('click', (e) => e.stopPropagation());
      controls.addEventListener('dblclick', (e) => e.stopPropagation());
      playButton?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void togglePlay();
      });
      bigPlay.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void togglePlay();
      });
      video.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void togglePlay();
      });
      video.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      progress?.addEventListener('input', (e) => {
        const target = e.currentTarget as HTMLInputElement;
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const ratio = Number(target.value) / 100;
        syncRangeFill(target, ratio);
        if (duration > 0) {
          video.currentTime = duration * ratio;
          updateTimeline();
        }
      });

      muteButton?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (video.muted || video.volume <= 0.001) {
          video.muted = false;
          video.volume = lastVolume > 0 ? lastVolume : 0.8;
        } else {
          lastVolume = video.volume;
          video.muted = true;
        }
        updateVolumeState();
      });

      volume?.addEventListener('input', (e) => {
        const target = e.currentTarget as HTMLInputElement;
        const nextVolume = Number(target.value);
        video.muted = nextVolume <= 0.001;
        video.volume = nextVolume;
        if (nextVolume > 0.001) lastVolume = nextVolume;
        syncRangeFill(target, nextVolume);
        updateVolumeState();
      });
      volume?.addEventListener('pointerdown', (e) => {
        volumeWrapper?.classList.add('dragging');
        try { volume.setPointerCapture((e as PointerEvent).pointerId); } catch { /* ignore */ }
      });
      const endVolumeDrag = () => volumeWrapper?.classList.remove('dragging');
      volume?.addEventListener('pointerup', endVolumeDrag);
      volume?.addEventListener('lostpointercapture', endVolumeDrag);

      fullscreenButton?.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          if (document.fullscreenElement === player) {
            await document.exitFullscreen();
          } else {
            await player.requestFullscreen();
          }
        } catch (err) {
          console.warn('[ChatView] Unable to toggle video fullscreen:', err);
        }
        updateFullscreenState();
      });

      player.addEventListener('mouseenter', updateFullscreenState);
      video.addEventListener('play', updatePlayState);
      video.addEventListener('pause', updatePlayState);
      video.addEventListener('ended', updatePlayState);
      video.addEventListener('loadedmetadata', updateTimeline);
      video.addEventListener('durationchange', updateTimeline);
      video.addEventListener('timeupdate', updateTimeline);
      video.addEventListener('volumechange', updateVolumeState);

      updatePlayState();
      updateTimeline();
      updateVolumeState();
      updateFullscreenState();
    });
  }

  private openLightboxFromSource(source: HTMLElement): void {
    const feed = document.getElementById('chat-messages-feed');
    if (!feed) return;

    const items = Array.from(feed.querySelectorAll<HTMLElement>('[data-lightbox-kind]'))
      .map((node) => {
        const kind = node.getAttribute('data-lightbox-kind');
        const url = node.getAttribute('data-lightbox-url');
        const fileName = node.getAttribute('data-lightbox-name') || 'attachment';
        const senderName = node.getAttribute('data-lightbox-sender') || '';
        const timestamp = node.getAttribute('data-lightbox-timestamp') || '';
        if ((kind === 'image' || kind === 'video') && url) {
          return { kind, url, fileName, senderName, timestamp, source: node } as LightboxMedia;
        }
        return null;
      })
      .filter((item): item is LightboxMedia => item !== null);

    if (items.length === 0) return;
    const startIndex = items.findIndex((item) => item.source === source);
    if (startIndex >= 0) this.openLightbox(items, startIndex);
  }

  private formatMediaTime(totalSeconds: number): string {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return [hours, minutes, secs].map((part, index) => (index === 0 ? `${part}` : `${part}`.padStart(2, '0'))).join(':');
    }
    return `${minutes}`.padStart(2, '0') + `:${`${secs}`.padStart(2, '0')}`;
  }

  private attachEvents(): void {
    // Clear old unbinders
    this.unbindEvents.forEach((u) => u());
    this.unbindEvents = [];

    const input = this.container.querySelector('#chat-message-input') as HTMLTextAreaElement | null;
    const inputContainer = this.container.querySelector('.chat-input-container') as HTMLElement | null;
    const inputWrapper = this.container.querySelector('.chat-input-wrapper') as HTMLElement | null;
    const charCounter = document.getElementById('chat-char-counter');
    const btnSend = document.getElementById('btn-send-message');
    const canSendMessages = serverStore.hasPermission(Permission.SEND_MESSAGES);
    const canAttachFiles = serverStore.hasPermission(Permission.ATTACH_FILES);

    const autoResize = () => {
      if (!input) return;
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    };

    const focusFromInputShell = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!input) return;
      if (this.isEditableTarget(target)) return;
      if (target?.closest('button, .mention-dropup, #chat-attachment-tray')) return;
      requestAnimationFrame(() => this.focusChatInput());
    };
    inputContainer?.addEventListener('mousedown', focusFromInputShell);
    inputWrapper?.addEventListener('mousedown', focusFromInputShell);

    input?.addEventListener('input', () => {
      if (charCounter) {
        charCounter.innerText = `${input.value.length}/${LIMITS.MAX_MESSAGE_LENGTH}`;
      }
      autoResize();
      this.updateMentionDropup(input);
    });

    const handleSend = () => {
      if (!input || !this.currentChannelId || !serverStore.hasPermission(Permission.SEND_MESSAGES)) return;
      const text = input.value.trim();

      // Block sending until every staged upload has finished (#11).
      if (this.pending.some((p) => p.status === 'uploading')) return;

      const attachmentIds = this.pending
        .filter((p) => p.status === 'done' && p.meta)
        .map((p) => p.meta!.id);

      if (!text && attachmentIds.length === 0) return;

      networkClient.send(MessageType.CHAT_SEND, {
        channelId: this.currentChannelId,
        content: text,
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
      });

      this.clearPending();
      input.value = '';
      input.style.height = 'auto';
      if (charCounter) {
        charCounter.innerText = `0/${LIMITS.MAX_MESSAGE_LENGTH}`;
      }
      this.closeMentionDropup();
    };

    // --- Attachment upload wiring (#11) ---
    const btnAttach = document.getElementById('btn-attach');
    const fileInput = document.getElementById('chat-file-input') as HTMLInputElement | null;

    btnAttach?.addEventListener('click', () => {
      if (!canAttachFiles) return;
      fileInput?.click();
    });
    fileInput?.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        if (!canAttachFiles) return;
        this.addFiles(fileInput.files);
      }
      fileInput.value = '';
    });

    // Paste files/images directly into the message box.
    input?.addEventListener('paste', (e: ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        if (!canAttachFiles) return;
        e.preventDefault();
        this.addFiles(files);
      }
    });

    // Global paste handler: Ctrl+V anywhere on the page uploads files when a
    // text channel is open (#181).
    const onGlobalPaste = (e: Event) => {
      const ce = e as ClipboardEvent;
      // Never hijack normal paste into editable fields; only catch truly global
      // pastes so text input keeps its native Ctrl+V behavior (#181).
      if (this.isEditableTarget(ce.target)) return;
      if (!this.currentChannelId) return;
      const files = ce.clipboardData?.files;
      if (files && files.length > 0) {
        if (!canAttachFiles) return;
        e.preventDefault();
        this.addFiles(files);
        // Focus the input so the user can add a message to accompany the file.
        this.focusChatInput();
      }
    };
    document.addEventListener('paste', onGlobalPaste);
    this.unbindEvents.push(() => document.removeEventListener('paste', onGlobalPaste));
    this.unbindEvents.push(() => {
      inputContainer?.removeEventListener('mousedown', focusFromInputShell);
      inputWrapper?.removeEventListener('mousedown', focusFromInputShell);
    });

    // Drag & drop onto the chat pane. Listeners live on the persistent container,
    // so they must be unbound on re-render to avoid stacking.
    const onDragOver = (e: Event) => {
      const de = e as DragEvent;
      if (!de.dataTransfer || !Array.from(de.dataTransfer.types).includes('Files')) return;
      e.preventDefault();
      de.dataTransfer.dropEffect = 'copy';
      this.container.querySelector('.chat-container')?.classList.add('chat-drag-over');
    };
    const onDragLeave = (e: Event) => {
      const related = (e as DragEvent).relatedTarget as Node | null;
      // Only clear when the pointer actually leaves the chat pane, not when it
      // crosses between child elements (which would otherwise flicker).
      if (!related || !this.container.contains(related)) {
        this.container.querySelector('.chat-container')?.classList.remove('chat-drag-over');
      }
    };
    const onDrop = (e: Event) => {
      const de = e as DragEvent;
      this.container.querySelector('.chat-container')?.classList.remove('chat-drag-over');
      if (de.dataTransfer?.files && de.dataTransfer.files.length > 0) {
        e.preventDefault();
        this.addFiles(de.dataTransfer.files);
      }
    };
    this.container.addEventListener('dragover', onDragOver);
    this.container.addEventListener('dragleave', onDragLeave);
    this.container.addEventListener('drop', onDrop);
    this.unbindEvents.push(() => {
      this.container.removeEventListener('dragover', onDragOver);
      this.container.removeEventListener('dragleave', onDragLeave);
      this.container.removeEventListener('drop', onDrop);
    });

    // Re-render the tray for any files staged before this (re)render.
    this.renderTray();

    input?.addEventListener('keydown', (e) => {
      // While the mention dropup is open, arrows/enter/tab/esc drive it (#14).
      if (this.mentionActive && this.mentionMatches.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.mentionActiveIndex = (this.mentionActiveIndex + 1) % this.mentionMatches.length;
          this.renderMentionDropup();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.mentionActiveIndex =
            (this.mentionActiveIndex - 1 + this.mentionMatches.length) % this.mentionMatches.length;
          this.renderMentionDropup();
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          this.applyMention(this.mentionActiveIndex);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          this.closeMentionDropup();
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    input?.addEventListener('blur', () => {
      // Delay so a click (mousedown) on a dropup item is processed first.
      setTimeout(() => this.closeMentionDropup(), 150);
    });

    btnSend?.addEventListener('click', () => {
      handleSend();
    });

    // Listen for new messages
    const u1 = appEvents.on('chat.message_added', (msg: ChatMessage) => {
      if (msg.channelId === this.currentChannelId) {
        this.renderMessages();
      }
    });

    const u2 = appEvents.on('chat.history_loaded', (data: { channelId: string }) => {
      if (data.channelId === this.currentChannelId) {
        this.renderMessages();
      }
    });

    this.unbindEvents.push(u1, u2);
  }

  private scrollToBottom(): void {
    const feed = document.getElementById('chat-messages-feed');
    if (feed) {
      feed.scrollTop = feed.scrollHeight;
    }
  }

  private updateMentionDropup(input: HTMLTextAreaElement): void {
    const caret = input.selectionStart ?? input.value.length;
    const before = input.value.substring(0, caret);
    // A mention token is an "@" at start/after whitespace, followed by the
    // nickname typed so far (no spaces — nicknames may contain spaces but the
    // full name is inserted on selection, ending the token).
    const match = before.match(/(?:^|\s)@([\w.\-]*)$/);
    if (!match) {
      this.closeMentionDropup();
      return;
    }
    const query = match[1].toLowerCase();
    this.mentionAtIndex = caret - match[1].length - 1;

    const all = serverStore.getMentionableUsers();
    const matches = (query ? all.filter((u) => u.nickname.toLowerCase().includes(query)) : all)
      // Prioritize names that start with the query.
      .sort((a, b) => {
        const aStarts = a.nickname.toLowerCase().startsWith(query) ? 0 : 1;
        const bStarts = b.nickname.toLowerCase().startsWith(query) ? 0 : 1;
        return aStarts - bStarts;
      })
      .slice(0, 8);

    if (matches.length === 0) {
      this.closeMentionDropup();
      return;
    }

    this.mentionMatches = matches;
    this.mentionActive = true;
    if (this.mentionActiveIndex >= matches.length || this.mentionActiveIndex < 0) {
      this.mentionActiveIndex = 0;
    }
    this.renderMentionDropup();
  }

  private renderMentionDropup(): void {
    const el = document.getElementById('mention-dropup');
    if (!el) return;
    el.innerHTML = this.mentionMatches
      .map((u, i) => {
        const online = u.status !== 'DISCONNECTED';
        return `
          <div class="mention-item ${i === this.mentionActiveIndex ? 'active' : ''}" data-mention-index="${i}">
            <img class="mention-avatar" src="${getAvatarUrl(u.avatarUrl)}">
            <span class="mention-nick">${escapeHtml(u.nickname)}</span>
            <span class="mention-status-dot ${online ? 'online' : 'offline'}"></span>
          </div>
        `;
      })
      .join('');
    el.style.display = 'block';

    el.querySelectorAll('.mention-item').forEach((item) => {
      // mousedown (not click) + preventDefault keeps focus in the textarea.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const idx = parseInt((item as HTMLElement).getAttribute('data-mention-index') || '0', 10);
        this.applyMention(idx);
      });
    });
  }

  private applyMention(index: number): void {
    const input = document.getElementById('chat-message-input') as HTMLTextAreaElement | null;
    const user = this.mentionMatches[index];
    if (!input || !user || this.mentionAtIndex < 0) {
      this.closeMentionDropup();
      return;
    }
    const caret = input.selectionStart ?? input.value.length;
    const before = input.value.substring(0, this.mentionAtIndex);
    const after = input.value.substring(caret);
    const insert = `@${user.nickname} `;
    input.value = `${before}${insert}${after}`;
    const newCaret = before.length + insert.length;
    input.setSelectionRange(newCaret, newCaret);
    this.closeMentionDropup();
    input.focus();

    const charCounter = document.getElementById('chat-char-counter');
    if (charCounter) {
      charCounter.innerText = `${input.value.length}/${LIMITS.MAX_MESSAGE_LENGTH}`;
    }
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }

  private closeMentionDropup(): void {
    this.mentionActive = false;
    this.mentionMatches = [];
    this.mentionActiveIndex = 0;
    this.mentionAtIndex = -1;
    const el = document.getElementById('mention-dropup');
    if (el) {
      el.style.display = 'none';
      el.innerHTML = '';
    }
  }

  private addFiles(fileList: FileList): void {
    if (!this.currentChannelId) return;
    const channelId = this.currentChannelId;
    const maxFile =
      serverStore.serverDetails?.attachmentStorage?.maxFileBytes ??
      LIMITS.MAX_ATTACHMENT_FILE_SIZE_DEFAULT;
    let overflow = false;

    for (const file of Array.from(fileList)) {
      if (this.pending.length >= LIMITS.MAX_ATTACHMENTS_PER_MESSAGE) {
        overflow = true;
        break;
      }

      const isImage = file.type.startsWith('image/');
      const item: PendingAttachment = {
        localId: `up-${++this.uploadSeq}`,
        name: file.name,
        size: file.size,
        isImage,
        previewUrl: isImage ? URL.createObjectURL(file) : null,
        status: 'uploading',
        progress: 0,
      };

      if (file.size > maxFile) {
        item.status = 'error';
        item.error = `Maior que o limite (${formatBytes(maxFile)})`;
        this.pending.push(item);
        continue;
      }

      this.pending.push(item);
      const handle = uploadAttachment(channelId, file, (frac) => {
        item.progress = frac;
        this.updatePendingProgress(item.localId);
      });
      item.handle = handle;
      handle.promise
        .then((meta) => {
          item.status = 'done';
          item.meta = meta;
          item.handle = undefined;
          this.renderTray();
          this.updateSendButtonState();
        })
        .catch((err) => {
          // A cancelled upload was already removed from the list; ignore it.
          if (!this.pending.includes(item)) return;
          item.status = 'error';
          item.error = err?.message || 'Falha no upload';
          item.handle = undefined;
          this.renderTray();
          this.updateSendButtonState();
        });
    }

    this.renderTray();
    this.updateSendButtonState();
    if (overflow) {
      this.showTrayNotice(t('chat.tooManyAttachments', { max: LIMITS.MAX_ATTACHMENTS_PER_MESSAGE }));
    }
  }

  private renderTray(): void {
    const tray = document.getElementById('chat-attachment-tray');
    if (!tray) return;
    if (this.pending.length === 0) {
      tray.style.display = 'none';
      tray.innerHTML = '';
      return;
    }
    tray.style.display = 'flex';
    tray.innerHTML = this.pending.map((p) => this.renderTrayItem(p)).join('');
    tray.querySelectorAll('[data-remove-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-remove-id');
        if (id) this.removePending(id);
      });
    });
  }

  private renderTrayItem(p: PendingAttachment): string {
    const thumb =
      p.isImage && p.previewUrl
        ? `<img class="tray-thumb" src="${p.previewUrl}" alt="">`
        : `<span class="material-symbols-outlined md-22 tray-thumb-icon">draft</span>`;

    let statusHtml: string;
    if (p.status === 'uploading') {
      const pct = Math.round(p.progress * 100);
      statusHtml = `
        <div class="tray-progress"><div class="tray-progress-bar" data-progress-id="${p.localId}" style="width: ${pct}%;"></div></div>
        <span class="tray-status" data-progress-label="${p.localId}">${pct}%</span>
      `;
    } else if (p.status === 'error') {
      statusHtml = `<span class="tray-status tray-error">${escapeHtml(p.error || t('common.error'))}</span>`;
    } else {
      statusHtml = `<span class="tray-status tray-done">${t('common.done')}</span>`;
    }

    return `
      <div class="tray-item ${p.status === 'error' ? 'is-error' : ''}" data-local-id="${p.localId}" title="${escapeHtml(p.name)}">
        ${thumb}
        <div class="tray-info">
          <span class="tray-name">${escapeHtml(p.name)}</span>
          <div class="tray-sub">
            <span class="tray-size">${formatBytes(p.size)}</span>
            ${statusHtml}
          </div>
        </div>
        <button type="button" class="tray-remove" data-remove-id="${p.localId}" title="${t('common.remove')}">
          <span class="material-symbols-outlined md-18">close</span>
        </button>
      </div>
    `;
  }

  private updatePendingProgress(localId: string): void {
    const item = this.pending.find((p) => p.localId === localId);
    if (!item) return;
    const pct = Math.round(item.progress * 100);
    const bar = document.querySelector(`[data-progress-id="${localId}"]`) as HTMLElement | null;
    if (bar) bar.style.width = `${pct}%`;
    const label = document.querySelector(`[data-progress-label="${localId}"]`) as HTMLElement | null;
    if (label) label.innerText = `${pct}%`;
  }

  private updateSendButtonState(): void {
    const btnSend = document.getElementById('btn-send-message') as HTMLButtonElement | null;
    if (!btnSend) return;
    const uploading = this.pending.some((p) => p.status === 'uploading');
    btnSend.disabled = uploading;
    btnSend.style.opacity = uploading ? '0.6' : '';
    btnSend.style.cursor = uploading ? 'not-allowed' : '';
  }

  private removePending(localId: string): void {
    const idx = this.pending.findIndex((p) => p.localId === localId);
    if (idx < 0) return;
    const [item] = this.pending.splice(idx, 1);
    item.handle?.cancel();
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    this.renderTray();
    this.updateSendButtonState();
  }

  private clearPending(): void {
    for (const p of this.pending) {
      p.handle?.cancel();
      if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    }
    this.pending = [];
    this.renderTray();
    this.updateSendButtonState();
  }

  private showTrayNotice(message: string): void {
    const tray = document.getElementById('chat-attachment-tray');
    if (!tray) return;
    const notice = document.createElement('div');
    notice.className = 'tray-notice';
    notice.innerText = message;
    tray.appendChild(notice);
    setTimeout(() => notice.remove(), 3000);
  }

  private async downloadAttachment(url: string, fileName: string): Promise<void> {
    if (!window.api?.downloadFile) return;
    const result = await window.api.downloadFile(url, fileName);
    if (!result.success && result.error) {
      await showAlert({
        title: t('chat.downloadFailedTitle'),
        message: t('chat.downloadFailedMessage', { error: result.error }),
        variant: 'danger',
      });
    }
  }

  private openLightbox(items: LightboxMedia[], startIndex: number): void {
    if (items.length === 0) return;
    this.closeLightbox?.();

    let currentIndex = Math.max(0, Math.min(startIndex, items.length - 1));
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let dragging = false;
    let pointerId: number | null = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let startPanX = 0;
    let startPanY = 0;
    let currentImage: HTMLImageElement | null = null;
    let currentLightboxVideo: HTMLVideoElement | null = null;
    let currentInlineVideo: HTMLVideoElement | null = null;
    let resumeInlineVideoOnClose = false;

    const overlay = document.createElement('div');
    overlay.className = 'attachment-lightbox';
    overlay.innerHTML = `
      <div class="lightbox-toolbar">
        <div class="lightbox-meta">
          <div class="lightbox-counter-row">
            <span class="lightbox-counter"></span>
            <span class="lightbox-zoom-indicator" hidden></span>
          </div>
          <div class="lightbox-caption"></div>
          <div class="lightbox-meta-details"></div>
        </div>
        <div class="lightbox-actions">
          <button type="button" class="lightbox-btn lightbox-download" title="${t('common.download')}">
            <span class="material-symbols-outlined">download</span>
          </button>
          <button type="button" class="lightbox-btn lightbox-close" title="${t('common.close')}">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      <button type="button" class="lightbox-nav lightbox-nav--prev" title="${t('common.previous')}">
        <span class="material-symbols-outlined md-28">chevron_left</span>
      </button>
      <div class="lightbox-stage">
        <div class="lightbox-media-frame"></div>
      </div>
      <button type="button" class="lightbox-nav lightbox-nav--next" title="${t('common.next')}">
        <span class="material-symbols-outlined md-28">chevron_right</span>
      </button>
    `;

    const stage = overlay.querySelector('.lightbox-stage') as HTMLElement | null;
    const frame = overlay.querySelector('.lightbox-media-frame') as HTMLElement | null;
    const counter = overlay.querySelector('.lightbox-counter') as HTMLElement | null;
    const caption = overlay.querySelector('.lightbox-caption') as HTMLElement | null;
    const metaDetails = overlay.querySelector('.lightbox-meta-details') as HTMLElement | null;
    const zoomIndicator = overlay.querySelector('.lightbox-zoom-indicator') as HTMLElement | null;
    const prevButton = overlay.querySelector('.lightbox-nav--prev') as HTMLButtonElement | null;
    const nextButton = overlay.querySelector('.lightbox-nav--next') as HTMLButtonElement | null;
    const downloadButton = overlay.querySelector('.lightbox-download') as HTMLButtonElement | null;
    const closeButton = overlay.querySelector('.lightbox-close') as HTMLButtonElement | null;
    if (!stage || !frame || !counter || !caption || !metaDetails || !zoomIndicator || !prevButton || !nextButton || !downloadButton || !closeButton) {
      return;
    }

    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

    const updateZoomIndicator = () => {
      if (!currentImage) {
        zoomIndicator.hidden = true;
        return;
      }
      const fittedWidth = currentImage.clientWidth || currentImage.naturalWidth || 1;
      const fittedHeight = currentImage.clientHeight || currentImage.naturalHeight || 1;
      const actualScale = Math.max(currentImage.naturalWidth / fittedWidth, currentImage.naturalHeight / fittedHeight, 1);
      const percent = Math.round((zoom / actualScale) * 100);
      zoomIndicator.hidden = false;
      zoomIndicator.innerText = `${percent}%`;
      zoomIndicator.title = `${t('common.zoom')}: ${percent}%`;
    };

    const clampPan = () => {
      if (!currentImage || zoom <= 1) {
        panX = 0;
        panY = 0;
        return;
      }
      const maxX = Math.max(0, (currentImage.clientWidth * zoom - stage.clientWidth) / 2);
      const maxY = Math.max(0, (currentImage.clientHeight * zoom - stage.clientHeight) / 2);
      panX = clamp(panX, -maxX, maxX);
      panY = clamp(panY, -maxY, maxY);
    };

    const updateImageTransform = () => {
      if (!currentImage) {
        zoomIndicator.hidden = true;
        stage.classList.remove('is-pannable', 'is-dragging');
        return;
      }
      clampPan();
      currentImage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      currentImage.style.cursor = zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in';
      stage.classList.toggle('is-pannable', zoom > 1);
      stage.classList.toggle('is-dragging', dragging);
      updateZoomIndicator();
    };

    const resetZoom = () => {
      zoom = 1;
      panX = 0;
      panY = 0;
      dragging = false;
      pointerId = null;
      updateImageTransform();
    };

    const syncCurrentVideoBackToInline = (options?: { resume?: boolean }) => {
      if (!currentLightboxVideo || !currentInlineVideo) return;
      currentLightboxVideo.pause();
      if (Number.isFinite(currentLightboxVideo.currentTime)) {
        const nextTime = Math.max(0, currentLightboxVideo.currentTime);
        currentInlineVideo.currentTime = nextTime;
      }
      currentInlineVideo.pause();
      if (options?.resume && resumeInlineVideoOnClose) {
        void currentInlineVideo.play().catch(() => undefined);
      }
      currentLightboxVideo = null;
      currentInlineVideo = null;
      resumeInlineVideoOnClose = false;
    };

    const getActualScale = () => {
      if (!currentImage) return 1;
      const fittedWidth = currentImage.clientWidth || currentImage.naturalWidth || 1;
      const fittedHeight = currentImage.clientHeight || currentImage.naturalHeight || 1;
      return Math.max(currentImage.naturalWidth / fittedWidth, currentImage.naturalHeight / fittedHeight, 1);
    };

    const setZoom = (nextZoom: number) => {
      zoom = clamp(nextZoom, 1, 8);
      if (zoom <= 1) {
        panX = 0;
        panY = 0;
      }
      updateImageTransform();
    };

    const releaseDrag = () => {
      if (currentImage && pointerId !== null && currentImage.hasPointerCapture(pointerId)) {
        currentImage.releasePointerCapture(pointerId);
      }
      pointerId = null;
      dragging = false;
      updateImageTransform();
    };

    const navigate = (direction: number) => {
      const nextIndex = currentIndex + direction;
      if (nextIndex < 0 || nextIndex >= items.length) return;
      currentIndex = nextIndex;
      renderCurrent();
    };

    const renderCurrent = () => {
      syncCurrentVideoBackToInline();
      releaseDrag();
      resetZoom();
      frame.innerHTML = '';
      currentImage = null;
      const item = items[currentIndex];

      counter.innerText = `${currentIndex + 1} / ${items.length}`;
      caption.innerText = item.fileName;
      const metaLine = [item.senderName, item.timestamp].filter(Boolean).join(' • ');
      metaDetails.innerText = metaLine;
      metaDetails.hidden = metaLine.length === 0;
      prevButton.disabled = currentIndex === 0;
      nextButton.disabled = currentIndex === items.length - 1;
      zoomIndicator.hidden = item.kind !== 'image';

      if (item.kind === 'image') {
        const img = document.createElement('img');
        img.className = 'lightbox-media lightbox-media--image';
        img.src = item.url;
        img.alt = item.fileName;
        img.draggable = false;
        img.addEventListener('load', () => {
          resetZoom();
          updateImageTransform();
        });
        img.addEventListener(
          'wheel',
          (e) => {
            e.preventDefault();
            setZoom(zoom + (e.deltaY < 0 ? 0.2 : -0.2));
          },
          { passive: false },
        );
        img.addEventListener('dblclick', (e) => {
          e.preventDefault();
          e.stopPropagation();
          setZoom(zoom > 1.01 ? 1 : getActualScale());
        });
        img.addEventListener('pointerdown', (e) => {
          if (zoom <= 1) return;
          e.preventDefault();
          e.stopPropagation();
          pointerId = e.pointerId;
          dragging = true;
          dragStartX = e.clientX;
          dragStartY = e.clientY;
          startPanX = panX;
          startPanY = panY;
          img.setPointerCapture(e.pointerId);
          updateImageTransform();
        });
        img.addEventListener('pointermove', (e) => {
          if (!dragging || pointerId !== e.pointerId) return;
          panX = startPanX + (e.clientX - dragStartX);
          panY = startPanY + (e.clientY - dragStartY);
          updateImageTransform();
        });
        img.addEventListener('pointerup', releaseDrag);
        img.addEventListener('pointercancel', releaseDrag);
        currentImage = img;
        frame.appendChild(img);
        updateImageTransform();
      } else {
        const player = document.createElement('div');
        player.className = 'chat-video-player chat-video-player--lightbox';
        const video = document.createElement('video');
        video.className = 'chat-attachment-video chat-attachment-video--lightbox';
        video.src = item.url;
        video.preload = 'metadata';
        video.playsInline = true;
        const inlineVideo = item.source.querySelector('video') as HTMLVideoElement | null;
        const startTime = inlineVideo && Number.isFinite(inlineVideo.currentTime) ? inlineVideo.currentTime : 0;
        const shouldResumePlayback = !!inlineVideo && !inlineVideo.paused && !inlineVideo.ended;
        inlineVideo?.pause();
        // Sync volume from inline player to lightbox (#188)
        if (inlineVideo) {
          video.volume = inlineVideo.volume;
          video.muted = inlineVideo.muted;
        }
        player.appendChild(video);
        frame.appendChild(player);
        this.initializeCustomVideoPlayers(frame);
        currentLightboxVideo = video;
        currentInlineVideo = inlineVideo;
        resumeInlineVideoOnClose = shouldResumePlayback;
        const applyStartTime = () => {
          const duration = Number.isFinite(video.duration) ? video.duration : 0;
          const nextTime = duration > 0 ? Math.min(startTime, Math.max(duration - 0.05, 0)) : startTime;
          if (nextTime > 0) {
            try {
              video.currentTime = nextTime;
            } catch {
              // Ignore seek failures until metadata becomes available.
            }
          }
          if (shouldResumePlayback) {
            void video.play().catch(() => undefined);
          }
        };
        if (video.readyState >= 1) {
          applyStartTime();
        } else {
          video.addEventListener('loadedmetadata', applyStartTime, { once: true });
        }
      }
    };

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isFormField = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (!isFormField && e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        navigate(-1);
      } else if (!isFormField && e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        navigate(1);
      }
    };

    const close = () => {
      syncCurrentVideoBackToInline({ resume: true });
      releaseDrag();
      if (document.fullscreenElement && overlay.contains(document.fullscreenElement)) {
        void document.exitFullscreen().catch(() => undefined);
      }
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (this.closeLightbox === close) this.closeLightbox = null;
    };

    this.closeLightbox = close;
    closeButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      close();
    });
    downloadButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const current = items[currentIndex];
      void this.downloadAttachment(current.url, current.fileName);
    });
    prevButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigate(-1);
    });
    nextButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigate(1);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target === stage || e.target === frame) close();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    renderCurrent();
  }

  public destroy(): void {
    this.closeLightbox?.();
    this.clearPending();
    this.unbindEvents.forEach((u) => u());
    this.unbindEvents = [];
  }
}
