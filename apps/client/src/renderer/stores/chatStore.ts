import { ChatMessage } from '@monky/shared';
import { appEvents, EventBus } from '../core/EventBus';
import { createActiveProxy } from '../core/activeProxy';

export class ChatStore {
  /** See ServerStore.bus: background servers get a silent bus (#400). */
  public bus: EventBus = appEvents;
  // Map of channelId -> ChatMessage[]
  private messages: Map<string, ChatMessage[]> = new Map();
  // Text channels with an unread @-mention for the current user (#14).
  private mentionChannels: Set<string> = new Set();
  // Text channels with unread messages for the current user (#263).
  private unreadChannels: Set<string> = new Set();
  // Half-written messages, keyed by channelId (#478). They live in the store
  // instead of the view because the view is torn down and rebuilt whenever the
  // center area switches between chat and the voice stage.
  private drafts: Map<string, string> = new Map();
  // Maximum number of messages kept in memory per channel to bound memory usage.
  private static readonly MAX_MESSAGES_PER_CHANNEL = 250;

  public setHistory(channelId: string, msgs: ChatMessage[]): void {
    const trimmed =
      msgs.length > ChatStore.MAX_MESSAGES_PER_CHANNEL
        ? msgs.slice(-ChatStore.MAX_MESSAGES_PER_CHANNEL)
        : msgs;
    this.messages.set(channelId, trimmed);
    this.bus.emit('chat.history_loaded', { channelId, messages: trimmed });
  }

  public addMessage(message: ChatMessage): void {
    let list = this.messages.get(message.channelId);
    if (!list) {
      list = [];
      this.messages.set(message.channelId, list);
    }
    if (list.some((m) => m.id === message.id)) {
      return;
    }
    list.push(message);
    // Keep only the most recent messages to prevent unbounded memory growth.
    if (list.length > ChatStore.MAX_MESSAGES_PER_CHANNEL) {
      list.splice(0, list.length - ChatStore.MAX_MESSAGES_PER_CHANNEL);
    }
    this.bus.emit('chat.message_added', message);
  }

  /**
   * Replaces a message already in the feed with its edited/deleted state (#504).
   * A message the client never loaded is ignored: it will arrive in its final
   * shape the next time the history is fetched.
   */
  public updateMessage(message: ChatMessage): void {
    const list = this.messages.get(message.channelId);
    if (!list) return;
    const index = list.findIndex((m) => m.id === message.id);
    if (index === -1) return;
    list[index] = message;
    this.bus.emit('chat.message_updated', message);
  }

  public getMessages(channelId: string): ChatMessage[] {
    return this.messages.get(channelId) || [];
  }

  /** Flag a text channel as having an unread @-mention (#14). */
  public markMention(channelId: string): void {
    if (this.mentionChannels.has(channelId)) return;
    this.mentionChannels.add(channelId);
    this.bus.emit('chat.mentions_updated');
  }

  /**
   * Replace the whole set of channels with unread @-mentions, e.g. when seeding
   * from ServerDetails on (re)connect so mentions received while offline show up
   * (#14).
   */
  public setMentions(channelIds: string[]): void {
    this.mentionChannels = new Set(channelIds);
    this.bus.emit('chat.mentions_updated');
  }

  /** Clear the unread @-mention flag for a channel (e.g. when opened). */
  public clearMention(channelId: string): void {
    if (!this.mentionChannels.delete(channelId)) return;
    this.bus.emit('chat.mentions_updated');
  }

  public hasMention(channelId: string): boolean {
    return this.mentionChannels.has(channelId);
  }

  /** Flag a text channel as having unread messages (#263). */
  public markUnread(channelId: string): void {
    if (this.unreadChannels.has(channelId)) return;
    this.unreadChannels.add(channelId);
    this.bus.emit('chat.unread_updated');
  }

  /** Clear the unread flag for a channel (opened or marked as read) (#263). */
  public clearUnread(channelId: string): void {
    if (!this.unreadChannels.delete(channelId)) return;
    this.bus.emit('chat.unread_updated');
  }

  public hasUnread(channelId: string): boolean {
    return this.unreadChannels.has(channelId);
  }

  /** Whether anything is unread anywhere, used by the server rail badge (#400). */
  public hasAnyUnread(): boolean {
    return this.unreadChannels.size > 0 || this.mentionChannels.size > 0;
  }

  /**
   * Whether any channel holds an unread @-mention. The rail badge separates it
   * from plain unread so a mention shows up in red instead of white (#479).
   */
  public hasAnyMention(): boolean {
    return this.mentionChannels.size > 0;
  }

  /**
   * Remembers what the user had typed but not sent in a channel, so leaving for
   * the voice stage or another channel doesn't throw the text away (#478).
   */
  public setDraft(channelId: string, text: string): void {
    if (text.length === 0) {
      this.drafts.delete(channelId);
      return;
    }
    this.drafts.set(channelId, text);
  }

  public getDraft(channelId: string): string {
    return this.drafts.get(channelId) || '';
  }

  public clearDraft(channelId: string): void {
    this.drafts.delete(channelId);
  }

  public clear(): void {
    this.messages.clear();
    this.mentionChannels.clear();
    this.unreadChannels.clear();
    this.drafts.clear();
    this.bus.emit('chat.cleared');
  }
}

export function createChatStore(): ChatStore {
  return new ChatStore();
}

let activeChatStore = createChatStore();

export function setActiveChatStore(store: ChatStore): void {
  activeChatStore = store;
}

export const chatStore = createActiveProxy<ChatStore>(() => activeChatStore);
