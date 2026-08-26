import { ChatMessage } from '@monky/shared';
import { appEvents } from '../core/EventBus';

export class ChatStore {
  // Map of channelId -> ChatMessage[]
  private messages: Map<string, ChatMessage[]> = new Map();
  // Text channels with an unread @-mention for the current user (#14).
  private mentionChannels: Set<string> = new Set();
  // Text channels with unread messages for the current user (#263).
  private unreadChannels: Set<string> = new Set();
  // Maximum number of messages kept in memory per channel to bound memory usage.
  private static readonly MAX_MESSAGES_PER_CHANNEL = 500;

  public setHistory(channelId: string, msgs: ChatMessage[]): void {
    const trimmed =
      msgs.length > ChatStore.MAX_MESSAGES_PER_CHANNEL
        ? msgs.slice(-ChatStore.MAX_MESSAGES_PER_CHANNEL)
        : msgs;
    this.messages.set(channelId, trimmed);
    appEvents.emit('chat.history_loaded', { channelId, messages: trimmed });
  }

  public addMessage(message: ChatMessage): void {
    let list = this.messages.get(message.channelId);
    if (!list) {
      list = [];
      this.messages.set(message.channelId, list);
    }
    list.push(message);
    // Keep only the most recent messages to prevent unbounded memory growth.
    if (list.length > ChatStore.MAX_MESSAGES_PER_CHANNEL) {
      list.splice(0, list.length - ChatStore.MAX_MESSAGES_PER_CHANNEL);
    }
    appEvents.emit('chat.message_added', message);
  }

  public getMessages(channelId: string): ChatMessage[] {
    return this.messages.get(channelId) || [];
  }

  /** Flag a text channel as having an unread @-mention (#14). */
  public markMention(channelId: string): void {
    if (this.mentionChannels.has(channelId)) return;
    this.mentionChannels.add(channelId);
    appEvents.emit('chat.mentions_updated');
  }

  /**
   * Replace the whole set of channels with unread @-mentions, e.g. when seeding
   * from ServerDetails on (re)connect so mentions received while offline show up
   * (#14).
   */
  public setMentions(channelIds: string[]): void {
    this.mentionChannels = new Set(channelIds);
    appEvents.emit('chat.mentions_updated');
  }

  /** Clear the unread @-mention flag for a channel (e.g. when opened). */
  public clearMention(channelId: string): void {
    if (!this.mentionChannels.delete(channelId)) return;
    appEvents.emit('chat.mentions_updated');
  }

  public hasMention(channelId: string): boolean {
    return this.mentionChannels.has(channelId);
  }

  /** Flag a text channel as having unread messages (#263). */
  public markUnread(channelId: string): void {
    if (this.unreadChannels.has(channelId)) return;
    this.unreadChannels.add(channelId);
    appEvents.emit('chat.unread_updated');
  }

  /** Clear the unread flag for a channel (opened or marked as read) (#263). */
  public clearUnread(channelId: string): void {
    if (!this.unreadChannels.delete(channelId)) return;
    appEvents.emit('chat.unread_updated');
  }

  public hasUnread(channelId: string): boolean {
    return this.unreadChannels.has(channelId);
  }

  public clear(): void {
    this.messages.clear();
    this.mentionChannels.clear();
    this.unreadChannels.clear();
    appEvents.emit('chat.cleared');
  }
}

export const chatStore = new ChatStore();
