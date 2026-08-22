import {
  AuthSuccessPayload,
  ChannelCreatedPayload,
  ChannelDeletedPayload,
  ChatHistoryPayload,
  ChatMessage,
  MessageType,
  UserJoinedPayload,
  UserLeftPayload,
  UserConnectionStatePayload,
  UserUpdatedPayload,
  VoiceStateChangedPayload,
  VoiceUserJoinedPayload,
  VoiceUserLeftPayload,
} from '@mini-voice/shared';
import { appEvents } from './core/EventBus';
import { networkClient } from './core/NetworkClient';
import { participantManager } from './core/ParticipantManager';
import { soundEffects } from './core/SoundEffects';
import { soundboardService } from './core/SoundboardService';
import { updateService } from './core/UpdateService';
import { webRtcManager } from './core/WebRtcManager';
import { chatStore } from './stores/chatStore';
import { connectionStore } from './stores/connectionStore';
import { serverStore } from './stores/serverStore';
import { voiceStore } from './stores/voiceStore';
import { ConnectionView } from './views/ConnectionView';
import { MainView } from './views/MainView';
import { screenAudioService } from './core/ScreenAudioService';
import { screenSharePickerModal } from './views/ScreenSharePickerModal';
import { showAlert } from './views/Dialog';

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
    this.setupTitleBar();

    // Render connection view initially
    this.connectionView.render();

    // Load soundboard sounds if configured
    soundboardService.loadSounds().catch(() => {});

    // Start checking for app updates (non-blocking)
    updateService.init();
  }

  private setupTitleBar(): void {
    const titlebar = document.getElementById('titlebar');
    if (window.api?.platform === 'darwin') {
      titlebar?.classList.add('titlebar--mac');
    }

    document.getElementById('win-min')?.addEventListener('click', () => window.api?.minimize());
    document.getElementById('win-max')?.addEventListener('click', () => window.api?.maximize());
    document.getElementById('win-close')?.addEventListener('click', () => window.api?.close());
  }

  private showReconnectOverlay(): void {
    let overlay = document.getElementById('reconnect-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'reconnect-overlay';
      overlay.className = 'reconnect-overlay';
      overlay.innerHTML = `
        <div class="reconnect-card">
          <div class="reconnect-spinner"></div>
          <div class="reconnect-title">Conexão perdida</div>
          <div id="reconnect-subtitle" class="reconnect-subtitle"></div>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    const subtitle = document.getElementById('reconnect-subtitle');
    if (subtitle) {
      subtitle.textContent = 'Tentando reconectar…';
    }
  }

  private hideReconnectOverlay(): void {
    document.getElementById('reconnect-overlay')?.remove();
  }

  private setupGlobalEventListeners(): void {
    // Network Connect / Disconnect
    appEvents.on('network.connected', (payload: AuthSuccessPayload) => {
      // Preserve the voice channel we were in so we can auto-rejoin after an
      // automatic reconnection (null on a fresh connect, so this no-ops then).
      const previousVoiceChannelId = voiceStore.currentVoiceChannelId;

      serverStore.setServerDetails(payload.server, payload.currentUser);
      participantManager.clear();
      participantManager.setUsers(payload.server.members);

      // Populate existing voice states
      for (const [_, state] of Object.entries(payload.server.voiceStates)) {
        participantManager.updateVoiceState(state);
      }

      webRtcManager.setCurrentUserId(payload.currentUser.id);
      // Drop any stale peer connections left over from a dropped session.
      webRtcManager.closeAllPeers();

      this.mainView.render();
      this.hideReconnectOverlay();

      const stillHasVoiceChannel =
        !!previousVoiceChannelId &&
        payload.server.channels.some(
          (c) => c.id === previousVoiceChannelId && c.type === 'VOICE'
        );
      if (stillHasVoiceChannel) {
        this.mainView.rejoinVoiceChannel(previousVoiceChannelId!);
      }
    });

    appEvents.on('network.disconnected', () => {
      this.hideReconnectOverlay();
      serverStore.clear();
      chatStore.clear();
      voiceStore.reset();
      participantManager.clear();
      webRtcManager.closeAllPeers();

      this.connectionView.render();
    });

    // Reconnection feedback overlay
    appEvents.on('network.reconnecting', () => {
      this.showReconnectOverlay();
    });

    // Protocol Server -> Client Broadcast Handlers
    appEvents.on(`message.${MessageType.USER_JOINED}`, (payload: UserJoinedPayload) => {
      participantManager.addUser(payload.user);
    });

    appEvents.on(`message.${MessageType.USER_LEFT}`, (payload: UserLeftPayload) => {
      participantManager.removeUser(payload.userId);
      webRtcManager.removePeer(payload.userId);
    });

    appEvents.on(`message.${MessageType.USER_CONNECTION_STATE}`, (payload: UserConnectionStatePayload) => {
      // Reflect other users' temporary connection loss / recovery (#44).
      participantManager.setReconnecting(payload.userId, payload.status === 'reconnecting');
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
        // Let everyone already in the channel hear that someone joined (#54).
        soundEffects.play('join_voice');
      }
    });

    appEvents.on(`message.${MessageType.VOICE_USER_LEFT}`, (payload: VoiceUserLeftPayload) => {
      // Play a leave sound for everyone still in the same voice channel (#54).
      if (
        voiceStore.currentVoiceChannelId === payload.channelId &&
        payload.userId !== serverStore.currentUser?.id
      ) {
        soundEffects.play('leave_voice');
      }
      participantManager.removeVoiceState(payload.userId);
      webRtcManager.removePeer(payload.userId);
    });

    appEvents.on(`message.${MessageType.VOICE_STATE_CHANGED}`, (payload: VoiceStateChangedPayload) => {
      const previousVoiceState = participantManager.get(payload.voiceState.userId)?.voiceState;
      const isRemoteUser = payload.voiceState.userId !== serverStore.currentUser?.id;
      const isSameVoiceChannel =
        voiceStore.currentVoiceChannelId === payload.voiceState.channelId;

      if (isRemoteUser && isSameVoiceChannel && !voiceStore.isDeafened) {
        if (
          previousVoiceState?.isScreenSharing === false &&
          payload.voiceState.isScreenSharing === true
        ) {
          soundEffects.play('screen_share_start');
        } else if (
          previousVoiceState?.isScreenSharing === true &&
          payload.voiceState.isScreenSharing === false
        ) {
          soundEffects.play('screen_share_stop');
        }
      }

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

    // Screen-share start/stop sound cue (covers all paths: picker, quick-stop,
    // switching to camera, and the OS "stop sharing" button).
    appEvents.on('local.screen_started', () => {
      soundEffects.play('screen_share_start');
    });
    appEvents.on('local.screen_stopped', () => {
      soundEffects.play('screen_share_stop');
      // Auto-stop screen audio when screen share ends
      if (screenAudioService.getIsCapturing()) {
        screenAudioService.stop();
      }
    });

    // Host closed the server: show a friendly notice (the network layer already
    // returned us to the home screen).
    appEvents.on('network.server_shutdown', (data: { reason?: string }) => {
      showAlert({
        title: 'Servidor encerrado',
        message: data?.reason || 'O anfitrião encerrou o servidor. Você foi desconectado.',
        variant: 'warning',
      });
    });
  }
}

// Bootstrap when DOM ready
document.addEventListener('DOMContentLoaded', () => {
  new App();
});
