import { ChatMessage, LIMITS, MessageType } from '@mini-voice/shared';
import { appEvents } from '../core/EventBus';
import { networkClient } from '../core/NetworkClient';
import { chatStore } from '../stores/chatStore';
import { serverStore } from '../stores/serverStore';
import { getAvatarUrl } from '../utils/avatar';

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
            <span class="channel-title">${this.escapeHtml(channelName)}</span>
          </div>
          <div class="header-status-badge">Canal de Texto</div>
        </div>

        <div id="chat-messages-feed" class="chat-messages-feed"></div>

        <div class="chat-input-container">
          <div class="chat-input-wrapper">
            <input id="chat-message-input" class="chat-input-field" type="text" placeholder="Conversar em #${this.escapeHtml(channelName)}..." maxlength="${LIMITS.MAX_MESSAGE_LENGTH}">
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
          <div style="font-size: 15px; font-weight: 600; color: var(--text-secondary);">Este é o início do canal #${this.escapeHtml(serverStore.serverDetails?.channels.find((c) => c.id === this.currentChannelId)?.name || 'geral')}</div>
          <div style="font-size: 13px;">Envie uma mensagem para começar!</div>
        </div>
      `;
      return;
    }

    feed.innerHTML = messages.map((m) => this.renderMessageRow(m)).join('');
    this.scrollToBottom();
  }

  private renderMessageRow(m: ChatMessage): string {
    const time = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (m.isSystem) {
      return `
        <div class="system-message-row">
          <span class="material-symbols-outlined md-14" style="color: var(--accent-primary);">info</span>
          <span>${this.escapeHtml(m.content)}</span>
          <span style="font-size: 10px; color: var(--text-muted); margin-left: auto;">${time}</span>
        </div>
      `;
    }

    const avatarSrc = getAvatarUrl(m.userAvatarUrl);

    return `
      <div class="chat-message-row">
        <img class="chat-author-avatar" src="${avatarSrc}">
        <div class="chat-message-body">
          <div class="chat-author-header">
            <span class="chat-author-name">${this.escapeHtml(m.userNickname)}</span>
            <span class="chat-timestamp">${time}</span>
          </div>
          <div class="chat-message-text">${this.escapeHtml(m.content)}</div>
        </div>
      </div>
    `;
  }

  private attachEvents(): void {
    // Clear old unbinders
    this.unbindEvents.forEach((u) => u());
    this.unbindEvents = [];

    const input = document.getElementById('chat-message-input') as HTMLInputElement;
    const charCounter = document.getElementById('chat-char-counter');
    const btnSend = document.getElementById('btn-send-message');

    input?.addEventListener('input', () => {
      if (charCounter) {
        charCounter.innerText = `${input.value.length}/${LIMITS.MAX_MESSAGE_LENGTH}`;
      }
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

  private escapeHtml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  public destroy(): void {
    this.unbindEvents.forEach((u) => u());
    this.unbindEvents = [];
  }
}
