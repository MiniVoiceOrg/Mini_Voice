import { ChatMessage } from '@mini-voice/shared';
import { appEvents } from '../core/EventBus';

export class ChatStore {
  // Map of channelId -> ChatMessage[]
  private messages: Map<string, ChatMessage[]> = new Map();

  public setHistory(channelId: string, msgs: ChatMessage[]): void {
    this.messages.set(channelId, msgs);
    appEvents.emit('chat.history_loaded', { channelId, messages: msgs });
  }

  public addMessage(message: ChatMessage): void {
    let list = this.messages.get(message.channelId);
    if (!list) {
      list = [];
      this.messages.set(message.channelId, list);
    }
    list.push(message);
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
