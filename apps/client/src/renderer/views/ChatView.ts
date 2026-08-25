import { ChatMessage, LIMITS, MessageType } from '@mini-voice/shared';
import type { AttachmentMeta, UserSummary } from '@mini-voice/shared';
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
            <button id="btn-attach" type="button" class="chat-attach-btn" title="${t('chat.attachFile')}">
              <span class="material-symbols-outlined md-22">add_circle</span>
            </button>
            <input id="chat-file-input" type="file" multiple style="display: none;">
            <textarea id="chat-message-input" class="chat-input-field" rows="1" placeholder="${t('chat.inputPlaceholder', { channel: escapeHtml(channelName) })}" maxlength="${LIMITS.MAX_MESSAGE_LENGTH}"></textarea>
            <span id="chat-char-counter" class="chat-char-count">0/${LIMITS.MAX_MESSAGE_LENGTH}</span>
            <button id="btn-send-message" class="btn btn-primary" style="padding: 6px 14px; font-size: 13px;">
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

    // Image attachments open in a lightbox; file chips download externally (#11).
    feed.querySelectorAll('.chat-attachment-image').forEach((img) => {
      img.addEventListener('click', () => {
        const url = img.getAttribute('data-full-url');
        if (url) this.openLightbox(url);
      });
    });
    feed.querySelectorAll('.chat-attachment-file').forEach((chip) => {
      chip.addEventListener('click', () => {
        const url = chip.getAttribute('data-download-url');
        if (url && window.api?.openExternal) window.api.openExternal(url);
      });
    });

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

    const avatarSrc = getAvatarUrl(m.userAvatarUrl);
    const textHtml =
      m.content && m.content.trim().length > 0
        ? `<div class="chat-message-text">${renderMarkdown(m.content)}</div>`
        : '';
    const attachmentsHtml = this.renderAttachments(m.attachments);

    return `
      <div class="chat-message-row" data-user-id="${m.userId}">
        <img class="chat-author-avatar" src="${avatarSrc}">
        <div class="chat-message-body">
          <div class="chat-author-header">
            <span class="chat-author-name">${escapeHtml(m.userNickname)}</span>
            <span class="chat-timestamp">${time}</span>
          </div>
          ${textHtml}
          ${attachmentsHtml}
        </div>
      </div>
    `;
  }

  /** Renders the attachment grid below a message body (#11). */
  private renderAttachments(attachments?: AttachmentMeta[]): string {
    if (!attachments || attachments.length === 0) return '';
    const items = attachments.map((a) => this.renderAttachment(a)).join('');
    return `<div class="chat-attachments">${items}</div>`;
  }

  private renderAttachment(a: AttachmentMeta): string {
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

    if (a.kind === 'image') {
      return `<img class="chat-attachment-image" src="${src}" alt="${name}" title="${name}" data-full-url="${src}" loading="lazy">`;
    }

    if (a.kind === 'video') {
      return `<video class="chat-attachment-video" controls preload="metadata" src="${src}"></video>`;
    }

    return `
      <button type="button" class="chat-attachment-file" data-download-url="${src}" title="Baixar ${name}">
        <span class="material-symbols-outlined md-24 af-icon">${fileIconName(a.kind, a.mimeType, a.originalName)}</span>
        <span class="af-meta">
          <span class="af-name">${name}</span>
          <span class="af-size">${formatBytes(a.sizeBytes)}</span>
        </span>
        <span class="material-symbols-outlined md-20 af-dl">download</span>
      </button>
    `;
  }

  private attachEvents(): void {
    // Clear old unbinders
    this.unbindEvents.forEach((u) => u());
    this.unbindEvents = [];

    const input = document.getElementById('chat-message-input') as HTMLTextAreaElement;
    const charCounter = document.getElementById('chat-char-counter');
    const btnSend = document.getElementById('btn-send-message');

    const autoResize = () => {
      if (!input) return;
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    };

    input?.addEventListener('input', () => {
      if (charCounter) {
        charCounter.innerText = `${input.value.length}/${LIMITS.MAX_MESSAGE_LENGTH}`;
      }
      autoResize();
      this.updateMentionDropup(input);
    });

    const handleSend = () => {
      if (!input || !this.currentChannelId) return;
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

    btnAttach?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        this.addFiles(fileInput.files);
      }
      fileInput.value = '';
    });

    // Paste files/images directly into the message box.
    input?.addEventListener('paste', (e: ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        e.preventDefault();
        this.addFiles(files);
      }
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

  private openLightbox(url: string): void {
    const overlay = document.createElement('div');
    overlay.className = 'attachment-lightbox';
    overlay.innerHTML = `
      <img src="${url}" alt="">
      <button type="button" class="lightbox-close" title="${t('common.close')}">
        <span class="material-symbols-outlined">close</span>
      </button>
    `;
    const close = () => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
  }

  public destroy(): void {
    this.clearPending();
    this.unbindEvents.forEach((u) => u());
    this.unbindEvents = [];
  }
}
