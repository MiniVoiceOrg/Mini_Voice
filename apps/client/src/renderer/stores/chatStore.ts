import { ChatMessage } from '@mini-voice/shared';
import { appEvents } from '../core/EventBus';

export class ChatStore {
  // Map of channelId -> ChatMessage[]
  private messages: Map<string, ChatMessage[]> = new Map();
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

  public clear(): void {
    this.messages.clear();
    appEvents.emit('chat.cleared');
  }
}

export const chatStore = new ChatStore();
