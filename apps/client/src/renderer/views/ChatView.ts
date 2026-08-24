import { ChatMessage, LIMITS, MessageType } from '@mini-voice/shared';
import type { UserSummary } from '@mini-voice/shared';
import { escapeHtml } from '../utils/html';
import { appEvents } from '../core/EventBus';
import { networkClient } from '../core/NetworkClient';
import { chatStore } from '../stores/chatStore';
import { serverStore } from '../stores/serverStore';
import { participantManager } from '../core/ParticipantManager';
import { userContextMenu } from './UserContextMenu';
import { getAvatarUrl } from '../utils/avatar';
import { renderMarkdown } from '../utils/markdown';

export class ChatView {
  private container: HTMLElement;
  private currentChannelId: string | null = null;
  private unbindEvents: Array<() => void> = [];
  // @-mention autocomplete state (#14)
  private mentionActive = false;
  private mentionMatches: UserSummary[] = [];
  private mentionActiveIndex = 0;
  private mentionAtIndex = -1;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public setChannel(channelId: string): void {
    this.currentChannelId = channelId;
    this.render();
    this.loadHistory();
  }

  public render(): void {
    if (!this.currentChannelId || !serverStore.serverDetails) {
      this.container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted);">
          Selecione um canal para conversar
        </div>
      `;
      return;
    }

    const channel = serverStore.serverDetails.channels.find((c) => c.id === this.currentChannelId);
    const channelName = channel ? channel.name : 'geral';

    this.container.innerHTML = `
      <div class="chat-container">
        <div class="content-header">
          <div class="channel-title-container">
            <span class="material-symbols-outlined md-18" style="color: var(--text-muted);">tag</span>
            <span class="channel-title">${escapeHtml(channelName)}</span>
          </div>
          <div class="header-status-badge">Canal de Texto</div>
        </div>

        <div id="chat-messages-feed" class="chat-messages-feed"></div>

        <div class="chat-input-container">
          <div id="mention-dropup" class="mention-dropup" style="display: none;"></div>
          <div class="chat-input-wrapper">
            <textarea id="chat-message-input" class="chat-input-field" rows="1" placeholder="Conversar em #${escapeHtml(channelName)}... (Shift+Enter para quebrar linha)" maxlength="${LIMITS.MAX_MESSAGE_LENGTH}"></textarea>
            <span id="chat-char-counter" class="chat-char-count">0/${LIMITS.MAX_MESSAGE_LENGTH}</span>
            <button id="btn-send-message" class="btn btn-primary" style="padding: 6px 14px; font-size: 13px;">
              <span class="material-symbols-outlined md-16" style="margin-right: 4px;">send</span>
              Enviar
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
          <div style="font-size: 15px; font-weight: 600; color: var(--text-secondary);">Este é o início do canal #${escapeHtml(serverStore.serverDetails?.channels.find((c) => c.id === this.currentChannelId)?.name || 'geral')}</div>
          <div style="font-size: 13px;">Envie uma mensagem para começar!</div>
        </div>
      `;
      return;
    }

    feed.innerHTML = messages.map((m) => this.renderMessageRow(m)).join('');

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

    this.scrollToBottom();
  }

  private renderMessageRow(m: ChatMessage): string {
    const time = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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

    return `
      <div class="chat-message-row" data-user-id="${m.userId}">
        <img class="chat-author-avatar" src="${avatarSrc}">
        <div class="chat-message-body">
          <div class="chat-author-header">
            <span class="chat-author-name">${escapeHtml(m.userNickname)}</span>
            <span class="chat-timestamp">${time}</span>
          </div>
          <div class="chat-message-text">${renderMarkdown(m.content)}</div>
        </div>
      </div>
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
      if (!text) return;

      networkClient.send(MessageType.CHAT_SEND, {
        channelId: this.currentChannelId,
        content: text,
      });

      input.value = '';
      input.style.height = 'auto';
      if (charCounter) {
        charCounter.innerText = `0/${LIMITS.MAX_MESSAGE_LENGTH}`;
      }
      this.closeMentionDropup();
    };

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

  public destroy(): void {
    this.unbindEvents.forEach((u) => u());
    this.unbindEvents = [];
  }
}
