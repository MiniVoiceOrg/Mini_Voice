import { ChatMessage, LIMITS, MessageType } from '@mini-voice/shared';
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
    };

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
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

  public destroy(): void {
    this.unbindEvents.forEach((u) => u());
    this.unbindEvents = [];
  }
}
