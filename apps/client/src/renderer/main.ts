import {
  AuthSuccessPayload,
  ChannelCreatedPayload,
  ChannelDeletedPayload,
  ChatHistoryPayload,
  ChatMessage,
  MessageType,
  UserJoinedPayload,
  UserLeftPayload,
  UserUpdatedPayload,
  VoiceStateChangedPayload,
  VoiceUserJoinedPayload,
  VoiceUserLeftPayload,
} from '@mini-voice/shared';
import { appEvents } from './core/EventBus';
import { networkClient } from './core/NetworkClient';
import { participantManager } from './core/ParticipantManager';
import { updateService } from './core/UpdateService';
import { webRtcManager } from './core/WebRtcManager';
import { chatStore } from './stores/chatStore';
import { connectionStore } from './stores/connectionStore';
import { serverStore } from './stores/serverStore';
import { voiceStore } from './stores/voiceStore';
import { ConnectionView } from './views/ConnectionView';
import { MainView } from './views/MainView';
import { screenSharePickerModal } from './views/ScreenSharePickerModal';

class App {
  private appContainer: HTMLElement;
  private connectionView: ConnectionView;
  private mainView: MainView;

  constructor() {
    this.appContainer = document.getElementById('app')!;
    this.connectionView = new ConnectionView(this.appContainer);
    this.mainView = new MainView(this.appContainer);

    this.init();
  }

  private async init(): Promise<void> {
    // Obtain client ID
    if (window.api?.getClientId) {
      connectionStore.clientId = await window.api.getClientId();
    }

    this.setupGlobalEventListeners();

    // Render connection view initially
    this.connectionView.render();

    // Start checking for app updates (non-blocking)
    updateService.init();
  }

  private setupGlobalEventListeners(): void {
    // Network Connect / Disconnect
    appEvents.on('network.connected', (payload: AuthSuccessPayload) => {
      serverStore.setServerDetails(payload.server, payload.currentUser);
      participantManager.clear();
      participantManager.setUsers(payload.server.members);

      // Populate existing voice states
      for (const [_, state] of Object.entries(payload.server.voiceStates)) {
        participantManager.updateVoiceState(state);
      }

      webRtcManager.setCurrentUserId(payload.currentUser.id);

      this.mainView.render();
    });

    appEvents.on('network.disconnected', () => {
      serverStore.clear();
      chatStore.clear();
      voiceStore.reset();
      participantManager.clear();
      webRtcManager.closeAllPeers();

      this.connectionView.render();
    });

    // Protocol Server -> Client Broadcast Handlers
    appEvents.on(`message.${MessageType.USER_JOINED}`, (payload: UserJoinedPayload) => {
      participantManager.addUser(payload.user);
    });

    appEvents.on(`message.${MessageType.USER_LEFT}`, (payload: UserLeftPayload) => {
      participantManager.removeUser(payload.userId);
      webRtcManager.removePeer(payload.userId);
    });

    appEvents.on(`message.${MessageType.USER_UPDATED}`, (payload: UserUpdatedPayload) => {
      participantManager.updateUser(payload.user);
      if (payload.user.id === serverStore.currentUser?.id) {
        serverStore.updateCurrentUser(payload.user);
      }
    });

    appEvents.on(`message.${MessageType.CHANNEL_CREATED}`, (payload: ChannelCreatedPayload) => {
      serverStore.addChannel(payload.channel);
    });

    appEvents.on(`message.${MessageType.CHANNEL_DELETED}`, (payload: ChannelDeletedPayload) => {
      serverStore.removeChannel(payload.channelId);
    });

    appEvents.on(`message.${MessageType.CHAT_MESSAGE}`, (message: ChatMessage) => {
      chatStore.addMessage(message);
    });

    appEvents.on(`message.${MessageType.CHAT_HISTORY}`, (payload: ChatHistoryPayload) => {
      chatStore.setHistory(payload.channelId, payload.messages);
    });

    appEvents.on(`message.${MessageType.VOICE_USER_JOINED}`, (payload: VoiceUserJoinedPayload) => {
      participantManager.updateVoiceState(payload.voiceState);

      // If we are also in this voice channel and not the joining user, connect P2P Mesh
      if (
        voiceStore.currentVoiceChannelId === payload.channelId &&
        payload.userId !== serverStore.currentUser?.id
      ) {
        webRtcManager.connectToPeer(payload.userId, false);
      }
    });

    appEvents.on(`message.${MessageType.VOICE_USER_LEFT}`, (payload: VoiceUserLeftPayload) => {
      participantManager.removeVoiceState(payload.userId);
      webRtcManager.removePeer(payload.userId);
    });

    appEvents.on(`message.${MessageType.VOICE_STATE_CHANGED}`, (payload: VoiceStateChangedPayload) => {
      participantManager.updateVoiceState(payload.voiceState);
    });

    // Local VAD speaking state
    appEvents.on('local.speaking', (speaking: boolean) => {
      voiceStore.setSpeaking(speaking);
      if (serverStore.currentUser) {
        participantManager.setSpeaking(serverStore.currentUser.id, speaking);
      }
    });

    // Modals
    appEvents.on('modal.open_screenshare_picker', () => {
      screenSharePickerModal.open();
    });
  }
}

// Bootstrap when DOM ready
document.addEventListener('DOMContentLoaded', () => {
  new App();
});
