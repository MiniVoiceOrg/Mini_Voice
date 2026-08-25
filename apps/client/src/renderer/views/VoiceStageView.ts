import { MessageType } from '@monky/shared';
import { escapeHtml } from '../utils/html';
import { appEvents } from '../core/EventBus';
import { networkClient } from '../core/NetworkClient';
import { participantManager, ParticipantViewModel } from '../core/ParticipantManager';
import { screenAudioService } from '../core/ScreenAudioService';
import { serverStore } from '../stores/serverStore';
import { settingsStore } from '../stores/settingsStore';
import { voiceStore } from '../stores/voiceStore';
import { audioProcessor } from '../core/AudioProcessor';
import { videoService } from '../core/VideoService';
import { webRtcManager } from '../core/WebRtcManager';
import { soundEffects } from '../core/SoundEffects';
import { getAvatarUrl } from '../utils/avatar';
import { showAlert, showConfirm } from './Dialog';
import { userContextMenu } from './UserContextMenu';
import { setButtonLoading, isButtonLoading } from '../utils/buttonLoading';
import { soundboardModal } from './SoundboardModal';
import { t } from '../i18n';

interface ScreenTelemetrySnapshot {
  kind: 'sender' | 'receiver';
  fps: number | null;
  width: number | null;
  height: number | null;
  bitrateKbps: number | null;
  codec: string | null;
  framesEncoded: number | null;
  keyFramesEncoded: number | null;
  packetLossPct: number | null;
  jitterMs: number | null;
  framesDecoded: number | null;
  framesDropped: number | null;
}

interface TelemetryByteSample {
  bytes: number;
  timestamp: number;
}

/**
 * A single renderable tile on the stage. A participant contributes one tile per
 * active media source, so someone sharing camera + screen at once shows up as
 * two independent tiles (#26). Participants with no video get a single 'voice'
 * (avatar) tile.
 */
type StageTileKind = 'voice' | 'camera' | 'screen';
interface StageTile {
  p: ParticipantViewModel;
  kind: StageTileKind;
  key: string; // `${userId}:${kind}` — stable identity for focus/DOM keys
}

export class VoiceStageView {
  private container: HTMLElement;
  private currentChannelId: string | null = null;
  private unbindEvents: Array<() => void> = [];
  private focusedTileKey: string | null = null;
  private gridExpanded = false;
  private suppressCardClickUntil = 0;
  // #150: remote screen shares are gated behind an explicit "Assistir
  // transmissão". These sets survive innerHTML re-renders (instance state).
  private watchingUserIds: Set<string> = new Set();
  private mutedScreenUserIds: Set<string> = new Set();
  private pingInterval: any = null;
  private telemetryInterval: number | null = null;
  private telemetryRefreshInFlight = false;
  private telemetrySnapshots: Map<string, ScreenTelemetrySnapshot> = new Map();
  private telemetryByteSamples: Map<string, TelemetryByteSample> = new Map();
  // Caches the current live-banner content so updateControlsUI() only rebuilds
  // it when the broadcast state actually changes, preventing the pulse dot from
  // flickering on frequent voice.state_updated events (#70).
  private broadcastBannerSignature: string | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public setChannel(channelId: string | null): void {
    this.currentChannelId = channelId;
    this.focusedTileKey = null;
    if (!channelId) {
      this.stopTelemetryMonitor();
    }
    this.render();
  }

  public render(): void {
    this.stopPingMonitor();
    this.stopTelemetryMonitor(false);
    this.unbindListeners();

    if (!this.currentChannelId || !serverStore.serverDetails) {
      this.container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); gap: 12px;">
          <span class="material-symbols-outlined md-36" style="color: var(--text-dim); font-size: 48px;">volume_up</span>
          <div style="font-size: 16px; font-weight: 600; color: var(--text-secondary);">${t('stage.noChannelTitle')}</div>
          <div style="font-size: 13px;">${t('stage.noChannelSubtitle')}</div>
        </div>
      `;
      return;
    }

    const channel = serverStore.serverDetails.channels.find((c) => c.id === this.currentChannelId);
    const channelName = channel ? channel.name : 'Geral';

    // Fresh DOM below means the (empty) banner wrapper must be repopulated by
    // updateControlsUI(), so drop the cached signature (#70).
    this.broadcastBannerSignature = null;
    this.container.innerHTML = `
      <div class="voice-stage-container">
        <div class="content-header">
          <div class="channel-title-container">
            <span class="material-symbols-outlined" style="color: var(--success); font-size: 20px;">volume_up</span>
            <span class="channel-title">${escapeHtml(channelName)}</span>
          </div>

          <div style="display: flex; align-items: center; gap: 10px;">
            <!-- Grid view toggle (#29) -->
            <button id="stage-btn-viewmode" class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;" title="${t('stage.toggleView')}">
              <span class="material-symbols-outlined md-16">${this.gridExpanded ? 'view_agenda' : 'grid_view'}</span>
            </button>
            <!-- Ping / Latency Badge -->
            <div id="stage-ping-badge" class="stage-ping-badge good">
              <span class="ping-dot"></span>
              <span id="stage-ping-text">-- ms</span>
              <div class="ping-tooltip">
                <div id="ping-tooltip-content">${t('stage.pingCalculating')}</div>
              </div>
            </div>

            <div class="header-status-badge" style="background-color: rgba(35, 165, 90, 0.15); color: var(--success); display: flex; align-items: center; gap: 6px;">
              <span class="material-symbols-outlined md-14">wifi_tethering</span>
              <span>${t('stage.connectedMesh')}</span>
            </div>
          </div>
        </div>

        <!-- Live Broadcast Top Banner Container -->
        <div id="stage-broadcast-banner-wrapper" style="display: none;"></div>

        <!-- Participants Container (Grid or Focused) -->
        <div id="stage-content-area" style="flex: 1; min-height: 0; display: flex; flex-direction: column;"></div>

        <!-- Stage Bottom Controls Bar -->
        <div class="stage-call-controls">
          <button id="stage-btn-mic" class="btn btn-icon ${voiceStore.isMuted ? 'danger-active' : ''}" title="${voiceStore.isMuted ? t('stage.unmuteMic') : t('stage.muteMic')}">
            <span class="material-symbols-outlined">${voiceStore.isMuted ? 'mic_off' : 'mic'}</span>
          </button>
          <button id="stage-btn-deafen" class="btn btn-icon ${voiceStore.isDeafened ? 'danger-active' : ''}" title="${voiceStore.isDeafened ? t('stage.undeafen') : t('stage.deafen')}">
            <span class="material-symbols-outlined">${voiceStore.isDeafened ? 'headset_off' : 'headphones'}</span>
          </button>
          <button id="stage-btn-camera" class="btn btn-icon ${voiceStore.isCameraOn ? 'broadcasting-pulse active' : ''}" title="${voiceStore.isCameraOn ? t('stage.cameraOff') : t('stage.cameraOn')}">
            <span class="material-symbols-outlined">${voiceStore.isCameraOn ? 'videocam_off' : 'videocam'}</span>
          </button>
          <button id="stage-btn-screen" class="btn btn-icon ${voiceStore.isScreenSharing ? 'broadcasting-pulse active' : ''}" title="${voiceStore.isScreenSharing ? t('stage.stopScreenShare') : t('main.shareScreen')}">
            <span class="material-symbols-outlined">${voiceStore.isScreenSharing ? 'stop_screen_share' : 'screen_share'}</span>
          </button>
          <button id="stage-btn-soundboard" class="btn btn-icon" title="${t('main.openSoundboard')}">
            <span class="material-symbols-outlined">music_note</span>
          </button>
          <button id="stage-btn-leave" class="btn btn-danger" style="margin-left: 12px; padding: 0 16px; height: 38px;" title="${t('stage.leaveChannel')}">
            <span class="material-symbols-outlined md-18" style="margin-right: 4px;">call_end</span>
            <span>${t('stage.leaveVoice')}</span>
          </button>
        </div>
      </div>
    `;

    this.renderParticipants();
    this.updateControlsUI();
    this.attachEvents();
    this.startPingMonitor();
    this.syncTelemetryMonitor();
  }

  public updateControlsUI(): void {
    const btnMic = document.getElementById('stage-btn-mic');
    if (btnMic) {
      btnMic.className = `btn btn-icon ${voiceStore.isMuted ? 'danger-active' : ''}`;
      btnMic.title = voiceStore.isMuted ? t('stage.unmuteMic') : t('stage.muteMic');
      btnMic.innerHTML = `<span class="material-symbols-outlined">${voiceStore.isMuted ? 'mic_off' : 'mic'}</span>`;
    }

    const btnDeafen = document.getElementById('stage-btn-deafen');
    if (btnDeafen) {
      btnDeafen.className = `btn btn-icon ${voiceStore.isDeafened ? 'danger-active' : ''}`;
      btnDeafen.title = voiceStore.isDeafened ? t('stage.undeafen') : t('stage.deafen');
      btnDeafen.innerHTML = `<span class="material-symbols-outlined">${voiceStore.isDeafened ? 'headset_off' : 'headphones'}</span>`;
    }

    const btnCam = document.getElementById('stage-btn-camera');
    if (btnCam) {
      btnCam.className = `btn btn-icon ${voiceStore.isCameraOn ? 'broadcasting-pulse active' : ''}`;
      btnCam.title = voiceStore.isCameraOn ? t('stage.cameraOff') : t('stage.cameraOn');
      btnCam.innerHTML = `<span class="material-symbols-outlined">${voiceStore.isCameraOn ? 'videocam_off' : 'videocam'}</span>`;
    }

    const btnScreen = document.getElementById('stage-btn-screen');
    if (btnScreen) {
      const hasScreenAudio = screenAudioService.getIsCapturing();
      btnScreen.className = `btn btn-icon ${voiceStore.isScreenSharing ? 'broadcasting-pulse active' : ''}`;
      btnScreen.title = voiceStore.isScreenSharing
        ? (hasScreenAudio ? t('stage.stopScreenShareWithAudio') : t('stage.stopScreenShare'))
        : t('main.shareScreen');
      btnScreen.innerHTML = `
        <span class="material-symbols-outlined">${voiceStore.isScreenSharing ? 'stop_screen_share' : 'screen_share'}</span>
        ${hasScreenAudio ? '<span class="material-symbols-outlined screen-audio-badge" style="font-size: 12px; position: absolute; bottom: 2px; right: 2px; color: var(--success);">volume_up</span>' : ''}
      `;
    }

    // Top broadcast banner
    const bannerWrapper = document.getElementById('stage-broadcast-banner-wrapper');
    if (bannerWrapper) {
      const isBroadcasting = voiceStore.isCameraOn || voiceStore.isScreenSharing;
      const hasScreenAudio = screenAudioService.getIsCapturing();
      // Only touch the DOM when the banner's content would actually change, so
      // the live-pulse animation isn't restarted on every state update (#70).
      const signature = isBroadcasting
        ? `${voiceStore.isScreenSharing ? 'screen' : 'cam'}:${hasScreenAudio ? 'audio' : 'noaudio'}`
        : 'off';
      if (signature !== this.broadcastBannerSignature) {
        this.broadcastBannerSignature = signature;
        if (isBroadcasting) {
          bannerWrapper.style.display = 'block';
          bannerWrapper.innerHTML = `
            <div class="stage-broadcast-banner">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span class="live-pulse-dot"></span>
                <span style="font-weight: 600; font-size: 12px; color: #ffffff;">
                  ${voiceStore.isScreenSharing
                    ? (hasScreenAudio ? t('stage.bannerScreenWithAudio') : t('stage.bannerScreen'))
                    : t('stage.bannerCamera')}
                </span>
              </div>
              <button id="btn-stage-quick-stop" class="btn btn-secondary" style="font-size: 11px; padding: 4px 12px; height: 26px; border-color: rgba(242, 63, 67, 0.5); color: #ff7b72;">
                <span class="material-symbols-outlined md-14" style="margin-right: 4px;">stop_circle</span>
                ${voiceStore.isScreenSharing ? t('stage.stopScreen') : t('stage.cameraOff')}
              </button>
            </div>
          `;
          const btnQuickStop = document.getElementById('btn-stage-quick-stop');
          btnQuickStop?.addEventListener('click', () => this.handleStopStreaming());
        } else {
          bannerWrapper.style.display = 'none';
          bannerWrapper.innerHTML = '';
        }
      }
    }
  }

  private updateSpeakingClasses(): void {
    if (!this.currentChannelId) return;
    const participants = participantManager.getInVoiceChannel(this.currentChannelId);
    participants.forEach((p) => {
      const isLocal = p.user.id === serverStore.currentUser?.id;
      const isSpeaking = isLocal ? voiceStore.isSpeaking : p.isSpeaking;
      this.setCardSpeaking(p.user.id, isSpeaking);
    });
  }

  private setCardSpeaking(userId: string, isSpeaking: boolean): void {
    // Update every non-screen tile for the user (a user may show a voice or
    // camera tile; the screen tile never pulses on speech — #26).
    const cards = document.querySelectorAll(`[data-user-id="${userId}"][data-kind]:not([data-kind="screen"])`);
    cards.forEach((card) => {
      if (isSpeaking) {
        card.classList.add('speaking');
      } else {
        card.classList.remove('speaking');
      }
    });
  }

  /**
   * Expands the flat participant list into renderable tiles. Camera + screen
   * are independent, so a participant broadcasting both yields two tiles (#26);
   * participants with no video yield a single avatar ('voice') tile.
   */
  private buildStageTiles(participants: ParticipantViewModel[], currentUserId?: string): StageTile[] {
    const tiles: StageTile[] = [];
    for (const p of participants) {
      const isLocal = p.user.id === currentUserId;
      const isCamOn = isLocal ? voiceStore.isCameraOn : (p.voiceState?.isCameraOn ?? false);
      const isScreenOn = isLocal ? voiceStore.isScreenSharing : (p.voiceState?.isScreenSharing ?? false);
      if (isCamOn) tiles.push({ p, kind: 'camera', key: `${p.user.id}:camera` });
      if (isScreenOn) tiles.push({ p, kind: 'screen', key: `${p.user.id}:screen` });
      if (!isCamOn && !isScreenOn) tiles.push({ p, kind: 'voice', key: `${p.user.id}:voice` });
    }
    return tiles;
  }

  private isTileSpeaking(tile: StageTile): boolean {
    // The speaking glow reflects the microphone; a pure screen tile shouldn't
    // pulse when the user talks (their camera/voice tile already does).
    if (tile.kind === 'screen') return false;
    return (tile.p.user.id === serverStore.currentUser?.id) ? voiceStore.isSpeaking : tile.p.isSpeaking;
  }

  public renderParticipants(): void {
    const area = document.getElementById('stage-content-area');
    if (!area || !this.currentChannelId) return;

    const participants = participantManager.getInVoiceChannel(this.currentChannelId);
    if (participants.length === 0) {
      area.innerHTML = `
        <div style="flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text-muted);">
          Aguardando outros amigos entrarem na chamada...
        </div>
      `;
      return;
    }

    const currentUserId = serverStore.currentUser?.id;

    // #150: reset watch-state for anyone who is no longer sharing their screen
    // so a fresh broadcast is gated behind "Assistir transmissão" again; also
    // drop their explicit screen-audio mute.
    for (const watchedId of [...this.watchingUserIds]) {
      const wp = participants.find((p) => p.user.id === watchedId);
      const stillSharing = !!wp && wp.user.id !== currentUserId && (wp.voiceState?.isScreenSharing ?? false);
      if (!stillSharing) {
        this.watchingUserIds.delete(watchedId);
        this.mutedScreenUserIds.delete(watchedId);
      }
    }

    // A participant sharing camera + screen contributes two independent tiles
    // (#26); focus, speaking and DOM keys are keyed per tile.
    const tiles = this.buildStageTiles(participants, currentUserId);

    if (this.focusedTileKey && !tiles.some((tile) => tile.key === this.focusedTileKey)) {
      this.focusedTileKey = null;
    }

    if (this.focusedTileKey) {
      const focusedTile = tiles.find((tile) => tile.key === this.focusedTileKey)!;
      const otherTiles = tiles.filter((tile) => tile.key !== this.focusedTileKey);
      const isFocusedSpeaking = this.isTileSpeaking(focusedTile);

      area.innerHTML = `
        <div class="stage-focused-layout">
          <div class="stage-focused-main ${isFocusedSpeaking ? 'speaking' : ''}" id="card-${focusedTile.p.user.id}-${focusedTile.kind}" data-user-id="${focusedTile.p.user.id}" data-kind="${focusedTile.kind}" data-tile-key="${focusedTile.key}">
            <div class="stage-focus-hint-badge">
              <span class="material-symbols-outlined md-14">zoom_in</span>
              <span>${t('stage.focusMode')}</span>
            </div>
            ${this.renderCardContent(focusedTile, true)}
          </div>

          ${otherTiles.length > 0 ? `
            <div class="stage-focused-strip">
              ${otherTiles.map((tile) => {
                return `
                  <div class="stage-mini-card ${this.isTileSpeaking(tile) ? 'speaking' : ''}" id="card-${tile.p.user.id}-${tile.kind}" data-user-id="${tile.p.user.id}" data-kind="${tile.kind}" data-tile-key="${tile.key}" title="${t('stage.focusOn', { name: escapeHtml(tile.p.user.nickname) })}">
                    ${this.renderCardContent(tile, false, true)}
                  </div>
                `;
              }).join('')}
            </div>
          ` : ''}
        </div>
      `;
    } else {
      area.innerHTML = `
        <div class="stage-grid ${this.gridExpanded ? 'stage-grid--expanded' : ''}" id="stage-grid">
          ${tiles.map((tile) => {
            return `
              <div class="stage-card ${this.isTileSpeaking(tile) ? 'speaking' : ''}" id="card-${tile.p.user.id}-${tile.kind}" data-user-id="${tile.p.user.id}" data-kind="${tile.kind}" data-tile-key="${tile.key}" title="${t('stage.focusHint')}">
                ${this.renderCardContent(tile, false, false)}
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // #150: gate remote screen audio behind the "Assistir transmissão" opt-in
    // while preserving explicit per-user mutes. The <audio> elements are created
    // by WebRtcManager on document.body and persist across these re-renders.
    participants.forEach((p) => {
      if (p.user.id === currentUserId) return;
      if (!(p.voiceState?.isScreenSharing ?? false)) return;
      const audioEl = document.querySelector(`audio[data-screen-audio-user="${p.user.id}"]`) as HTMLAudioElement | null;
      if (!audioEl) return;
      audioEl.muted = !this.watchingUserIds.has(p.user.id) || this.mutedScreenUserIds.has(p.user.id);
    });

    // Attach click listeners to cards for focus toggle & right-click for volume adjustment
    const allCards = area.querySelectorAll('[data-user-id]');
    allCards.forEach((card) => {
      card.addEventListener('click', (e: Event) => {
        // Don't toggle focus when the click originates from an interactive
        // overlay (volume/fullscreen), nor right after a slider drag whose
        // pointer-up may land outside the controls (#75).
        if (Date.now() < this.suppressCardClickUntil) return;
        if ((e.target as HTMLElement).closest('.stage-card-controls')) return;
        const tileKey = card.getAttribute('data-tile-key');
        if (tileKey) {
          this.focusedTileKey = (this.focusedTileKey === tileKey ? null : tileKey);
          this.renderParticipants();
        }
      });

      card.addEventListener('contextmenu', (e: Event) => {
        const mouseEvent = e as MouseEvent;
        mouseEvent.preventDefault();
        mouseEvent.stopPropagation();
        const userId = card.getAttribute('data-user-id');
        if (!userId) return;
        const participant = participantManager.get(userId);
        if (participant?.user) {
          userContextMenu.open(mouseEvent.clientX, mouseEvent.clientY, participant.user);
        }
      });
    });

    // Fullscreen buttons on video tiles (#68)
    const fsButtons = area.querySelectorAll('.stage-fullscreen-btn');
    fsButtons.forEach((btn) => {
      btn.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        const targetId = btn.getAttribute('data-fullscreen-target');
        if (targetId) this.toggleVideoFullscreen(targetId);
      });
    });

    // #150: "Assistir transmissão" — opt into a gated remote screen share.
    // Starts video + audio and auto-focuses the broadcaster.
    const watchBtns = area.querySelectorAll('.stage-watch-btn') as NodeListOf<HTMLButtonElement>;
    watchBtns.forEach((btn) => {
      btn.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        const userId = btn.getAttribute('data-watch-user');
        if (!userId) return;
        this.watchingUserIds.add(userId);
        this.mutedScreenUserIds.delete(userId);
        this.focusedTileKey = `${userId}:screen`;
        this.renderParticipants();
      });
    });

    // #150: "Parar de assistir" — re-gate the broadcast (blur + silence) and
    // drop back to the grid.
    const stopWatchBtns = area.querySelectorAll('.stage-stopwatch-btn') as NodeListOf<HTMLButtonElement>;
    stopWatchBtns.forEach((btn) => {
      btn.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        const userId = btn.getAttribute('data-stopwatch-user');
        if (!userId) return;
        this.watchingUserIds.delete(userId);
        if (this.focusedTileKey === `${userId}:screen`) this.focusedTileKey = null;
        this.renderParticipants();
      });
    });

    // Screen audio volume sliders (#75)
    const volSliders = area.querySelectorAll('.stage-screen-volume-slider') as NodeListOf<HTMLInputElement>;
    volSliders.forEach((slider) => {
      slider.addEventListener('input', () => {
        const userId = slider.getAttribute('data-user-id');
        if (!userId) return;
        const vol = parseInt(slider.value, 10);
        settingsStore.setScreenAudioVolume(userId, vol);
        const audioEl = document.querySelector(`audio[data-screen-audio-user="${userId}"]`) as HTMLAudioElement | null;
        if (audioEl) audioEl.volume = vol / 100;
      });
    });

    // Volume button click → toggle mute screen audio
    const volButtons = area.querySelectorAll('.stage-volume-btn') as NodeListOf<HTMLButtonElement>;
    volButtons.forEach((btn) => {
      // Sync the button icon + popup visibility with the current (possibly
      // persisted) mute state of the underlying <audio> element on each
      // render, so a muted share doesn't come back showing "volume_up" (#159).
      const initWrapper = btn.closest('.stage-volume-wrapper');
      const initSlider = initWrapper?.querySelector('.stage-screen-volume-slider') as HTMLInputElement | null;
      const initUserId = initSlider?.getAttribute('data-user-id');
      if (initUserId && this.mutedScreenUserIds.has(initUserId)) {
        const initIcon = btn.querySelector('.material-symbols-outlined');
        if (initIcon) initIcon.textContent = 'volume_off';
        btn.title = t('stage.screenAudioMuted');
        initWrapper?.classList.add('screen-audio-muted');
      }

      btn.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        const wrapper = btn.closest('.stage-volume-wrapper');
        const slider = wrapper?.querySelector('.stage-screen-volume-slider') as HTMLInputElement | null;
        if (!slider) return;
        const userId = slider.getAttribute('data-user-id');
        if (!userId) return;
        const audioEl = document.querySelector(`audio[data-screen-audio-user="${userId}"]`) as HTMLAudioElement | null;

        const icon = btn.querySelector('.material-symbols-outlined');
        if (this.mutedScreenUserIds.has(userId)) {
          this.mutedScreenUserIds.delete(userId);
          if (audioEl) audioEl.muted = false;
          if (icon) icon.textContent = 'volume_up';
          btn.title = t('stage.screenAudioVolume');
          wrapper?.classList.remove('screen-audio-muted');
        } else {
          this.mutedScreenUserIds.add(userId);
          if (audioEl) audioEl.muted = true;
          if (icon) icon.textContent = 'volume_off';
          btn.title = t('stage.screenAudioMuted');
          wrapper?.classList.add('screen-audio-muted');
        }
      });
    });

    // Volume controls must not toggle card focus (which re-renders and drops
    // fullscreen). Suppress the card click that follows any control interaction,
    // and keep the slider popup open + tracking the pointer while dragging, even
    // when the mouse leaves the small popup area (#75).
    const controlBars = area.querySelectorAll('.stage-card-controls');
    controlBars.forEach((bar) => {
      bar.addEventListener('pointerdown', () => {
        this.suppressCardClickUntil = Date.now() + 800;
      });
    });

    const volWrappers = area.querySelectorAll('.stage-volume-wrapper');
    volWrappers.forEach((wrapper) => {
      const slider = wrapper.querySelector('.stage-screen-volume-slider') as HTMLInputElement | null;
      if (!slider) return;
      slider.addEventListener('pointerdown', (e: Event) => {
        wrapper.classList.add('dragging');
        try { slider.setPointerCapture((e as PointerEvent).pointerId); } catch { /* ignore */ }
      });
      const endDrag = () => {
        wrapper.classList.remove('dragging');
        // Keep suppressing briefly so the trailing click can't reach the card.
        this.suppressCardClickUntil = Date.now() + 400;
      };
      slider.addEventListener('pointerup', endDrag);
      slider.addEventListener('lostpointercapture', endDrag);
    });

    // Attach media streams to the per-tile video elements cleanly. Camera rides
    // remoteStream / cameraStream; screen rides remoteScreenStream / screenStream
    // so both tiles show independent video (#26).
    tiles.forEach((tile) => {
      if (tile.kind === 'voice') return;
      const isLocal = tile.p.user.id === currentUserId;
      const stream = isLocal
        ? (tile.kind === 'screen' ? videoService.getScreenStream() : videoService.getCameraStream())
        : (tile.kind === 'screen' ? tile.p.remoteScreenStream : tile.p.remoteStream);
      if (!stream) return;
      const ids = [`video-${tile.p.user.id}-${tile.kind}`, `video-mini-${tile.p.user.id}-${tile.kind}`];
      ids.forEach((id) => {
        const el = document.getElementById(id) as HTMLVideoElement | null;
        if (el && el.srcObject !== stream) {
          el.muted = true;
          el.srcObject = stream;
          this.hideVideoLoadingWhenReady(el, id);
          el.play().catch(() => {});
        }
      });
    });

    this.applyTelemetryOverlayState();
    this.syncTelemetryMonitor();
  }

  /** Removes the "loading video" overlay once the stream actually renders (#48). */
  private hideVideoLoadingWhenReady(videoEl: HTMLVideoElement, videoId: string): void {
    const overlay = document.getElementById(`loading-${videoId}`);
    if (!overlay) return;
    const hide = () => overlay.remove();
    if (videoEl.readyState >= 2) {
      hide();
      return;
    }
    videoEl.addEventListener('playing', hide, { once: true });
    videoEl.addEventListener('loadeddata', hide, { once: true });
  }

  /** Toggles native fullscreen for a stage video tile (#68).
   *  Fullscreens the whole card (a <div>), not the bare <video>, so Chromium's
   *  native video controls don't appear — they act on the muted <video> element
   *  and can't reach the screen-audio <audio> element. Keeping the card in
   *  fullscreen preserves the stage's real volume/mute controls (#75). */
  private async toggleVideoFullscreen(videoId: string): Promise<void> {
    const videoEl = document.getElementById(videoId) as HTMLVideoElement | null;
    if (!videoEl) return;
    const target = (videoEl.closest('.stage-card, .stage-focused-main, .stage-mini-card') as HTMLElement | null) ?? videoEl;
    try {
      if (document.fullscreenElement === target) {
        await document.exitFullscreen();
      } else {
        await target.requestFullscreen();
      }
    } catch (err) {
      console.warn('[VoiceStageView] Fullscreen request failed:', err);
    }
  }

  private renderCardContent(tile: StageTile, isFocused: boolean = false, isMini: boolean = false): string {
    const p = tile.p;
    const isLocal = p.user.id === serverStore.currentUser?.id;
    const isCamOn = isLocal ? voiceStore.isCameraOn : (p.voiceState?.isCameraOn ?? false);
    const isScreenOn = isLocal ? voiceStore.isScreenSharing : (p.voiceState?.isScreenSharing ?? false);
    const isMuted = isLocal ? voiceStore.isMuted : (p.voiceState?.isMuted ?? false);
    const isDeafened = isLocal ? voiceStore.isDeafened : (p.voiceState?.isDeafened ?? false);
    const avatarSrc = getAvatarUrl(p.user.avatarUrl);

    const isVideoTile = tile.kind === 'camera' || tile.kind === 'screen';
    const isScreenTile = tile.kind === 'screen';
    const videoId = isMini ? `video-mini-${p.user.id}-${tile.kind}` : `video-${p.user.id}-${tile.kind}`;
    const isRemoteScreen = isScreenTile && !isLocal;
    const isWatching = this.watchingUserIds.has(p.user.id);
    // #150: a remote screen the local user has not opted into watching is
    // rendered blurred + silent behind an "Assistir transmissão" CTA. Applies
    // to screen tiles only — the camera tile always plays normally (#26).
    const isLocked = isRemoteScreen && !isWatching;
    // Distinguish the two tiles of a camera + screen sharer with a "· Tela"
    // suffix on the screen tile label (#26).
    const label = isScreenTile ? `${escapeHtml(p.user.nickname)} · Tela` : escapeHtml(p.user.nickname);

    return `
      ${isVideoTile ? `
        <video id="${videoId}" class="stage-video-element ${isScreenTile ? 'screen-share' : ''}${isLocked ? ' screen-locked' : ''}" autoplay playsinline muted></video>
        ${!isLocked ? `
          <div class="stage-loading-overlay" id="loading-${videoId}">
            <div class="reconnect-spinner"></div>
            <span>${isScreenTile ? t('stage.loadingScreen') : t('stage.loadingCamera')}</span>
          </div>
        ` : ''}
        ${(isScreenTile && !isLocked) ? `
          <div
            class="telemetry-overlay position-${settingsStore.screenShareTelemetryPosition}${settingsStore.screenShareTelemetryEnabled ? '' : ' is-hidden'}"
            data-telemetry-user-id="${p.user.id}"
          >${this.getTelemetryText(p.user.id)}</div>
        ` : ''}
        ${isLocked ? `
          <div class="stage-watch-overlay">
            <button class="stage-watch-btn" data-watch-user="${p.user.id}">
              <span class="material-symbols-outlined">smart_display</span>
              <span>${t('stage.watchBroadcast')}</span>
            </button>
            <div class="stage-watch-caption">${t('stage.watchCaption', { name: escapeHtml(p.user.nickname) })}</div>
          </div>
        ` : `
          <div class="stage-card-controls">
            ${isRemoteScreen ? `
              <div class="stage-volume-wrapper">
                <div class="stage-volume-popup">
                  <input type="range" class="stage-screen-volume-slider" data-user-id="${p.user.id}" min="0" max="100" value="${settingsStore.getScreenAudioVolume(p.user.id)}" />
                </div>
                <button class="stage-volume-btn" title="${t('stage.screenAudioVolume')}" aria-label="${t('stage.volumeAria')}">
                  <span class="material-symbols-outlined md-18">volume_up</span>
                </button>
              </div>
              <button class="stage-stopwatch-btn" data-stopwatch-user="${p.user.id}" title="${t('stage.stopWatching')}" aria-label="${t('stage.stopWatching')}">
                <span class="material-symbols-outlined md-18">visibility_off</span>
              </button>
            ` : ''}
            <button class="stage-fullscreen-btn" data-fullscreen-target="${videoId}" title="${t('stage.fullscreen')}" aria-label="${t('stage.fullscreen')}">
              <span class="material-symbols-outlined md-18">fullscreen</span>
            </button>
          </div>
        `}
      ` : `
        <div class="stage-avatar-wrapper">
          <img class="stage-avatar-img" src="${avatarSrc}">
          ${!isMini ? `
            <div class="stage-participant-name">${escapeHtml(p.user.nickname)} ${isLocal ? `(${t('common.you')})` : ''}</div>
          ` : ''}
        </div>
      `}

      <div class="stage-badges-overlay">
        <span>${label}</span>
        ${isMuted ? '<span class="material-symbols-outlined md-14" style="color: var(--danger);">mic_off</span>' : ''}
        ${isDeafened ? '<span class="material-symbols-outlined md-14" style="color: var(--danger);">headset_off</span>' : ''}
        ${isCamOn ? '<span class="material-symbols-outlined md-14" style="color: var(--accent-primary);">videocam</span>' : ''}
        ${isScreenOn ? '<span class="material-symbols-outlined md-14" style="color: var(--success);">screen_share</span>' : ''}
      </div>
      ${(!isLocal && p.isReconnecting) ? `
        <div class="stage-reconnecting-overlay">
          <div class="reconnect-spinner"></div>
          <span>${t('main.reconnecting')}</span>
        </div>
      ` : ''}
    `;
  }

  private getTelemetryText(userId: string): string {
    const snapshot = this.telemetrySnapshots.get(userId);
    if (!snapshot) {
      return 'Coletando...';
    }

    const lines = [
      `FPS: ${this.formatTelemetryNumber(snapshot.fps, 0)}`,
      `Res: ${this.formatResolution(snapshot.width, snapshot.height)}`,
      `Bitrate: ${this.formatTelemetryNumber(snapshot.bitrateKbps, 0, ' kbps')}`,
    ];

    if (settingsStore.screenShareTelemetryMode === 'complete') {
      if (snapshot.kind === 'sender') {
        lines.push(
          `Codec: ${snapshot.codec || '--'}`,
          `Frames enc: ${this.formatTelemetryNumber(snapshot.framesEncoded, 0)}`,
          `Keyframes: ${this.formatTelemetryNumber(snapshot.keyFramesEncoded, 0)}`
        );
      } else {
        lines.push(
          `Codec: ${snapshot.codec || '--'}`,
          `Loss: ${this.formatTelemetryNumber(snapshot.packetLossPct, 1, '%')}`,
          `Jitter: ${this.formatTelemetryNumber(snapshot.jitterMs, 1, ' ms')}`,
          `Frames dec: ${this.formatTelemetryNumber(snapshot.framesDecoded, 0)}`,
          `Frames drop: ${this.formatTelemetryNumber(snapshot.framesDropped, 0)}`
        );
      }
    }

    return lines.join('\n');
  }

  private formatTelemetryNumber(value: number | null, decimals: number, suffix = ''): string {
    if (value === null || !Number.isFinite(value)) return `--${suffix}`;
    return `${value.toFixed(decimals)}${suffix}`;
  }

  private formatResolution(width: number | null, height: number | null): string {
    if (!width || !height) return '--';
    return `${width}x${height}`;
  }

  private applyTelemetryOverlayState(): void {
    const overlays = this.container.querySelectorAll('.telemetry-overlay');
    overlays.forEach((overlay) => {
      overlay.classList.remove(
        'position-top-left',
        'position-top-right',
        'position-bottom-left',
        'position-bottom-right'
      );
      overlay.classList.add(`position-${settingsStore.screenShareTelemetryPosition}`);
      overlay.classList.toggle('is-hidden', !settingsStore.screenShareTelemetryEnabled);
      const userId = overlay.getAttribute('data-telemetry-user-id');
      if (userId) {
        overlay.textContent = this.getTelemetryText(userId);
      }
    });
  }

  private hasActiveScreenShares(): boolean {
    if (!this.currentChannelId) return false;
    return participantManager.getInVoiceChannel(this.currentChannelId).some((participant) => {
      const isLocal = participant.user.id === serverStore.currentUser?.id;
      return isLocal ? voiceStore.isScreenSharing : (participant.voiceState?.isScreenSharing ?? false);
    });
  }

  private syncTelemetryMonitor(): void {
    if (!this.currentChannelId || !settingsStore.screenShareTelemetryEnabled || !this.hasActiveScreenShares()) {
      this.stopTelemetryMonitor(false);
      this.applyTelemetryOverlayState();
      return;
    }

    if (this.telemetryInterval !== null) {
      this.applyTelemetryOverlayState();
      return;
    }

    const tick = () => {
      void this.refreshTelemetry();
    };

    tick();
    this.telemetryInterval = window.setInterval(tick, 1500);
  }

  private async refreshTelemetry(): Promise<void> {
    if (this.telemetryRefreshInFlight || !this.currentChannelId || !settingsStore.screenShareTelemetryEnabled) {
      return;
    }

    this.telemetryRefreshInFlight = true;
    try {
      const participants = participantManager.getInVoiceChannel(this.currentChannelId);
      const screenParticipants = participants.filter((participant) => {
        const isLocal = participant.user.id === serverStore.currentUser?.id;
        return isLocal ? voiceStore.isScreenSharing : (participant.voiceState?.isScreenSharing ?? false);
      });

      if (screenParticipants.length === 0) {
        this.telemetrySnapshots.clear();
        this.telemetryByteSamples.clear();
        this.applyTelemetryOverlayState();
        this.stopTelemetryMonitor(false);
        return;
      }

      const nextSnapshots = new Map<string, ScreenTelemetrySnapshot>();
      await Promise.all(screenParticipants.map(async (participant) => {
        const snapshot = await this.collectTelemetrySnapshot(participant);
        if (snapshot) {
          nextSnapshots.set(participant.user.id, snapshot);
        }
      }));

      this.telemetrySnapshots = nextSnapshots;
      this.pruneTelemetryByteSamples(Array.from(screenParticipants, (participant) => participant.user.id));
      this.applyTelemetryOverlayState();
    } finally {
      this.telemetryRefreshInFlight = false;
    }
  }

  private async collectTelemetrySnapshot(participant: ParticipantViewModel): Promise<ScreenTelemetrySnapshot | null> {
    const isLocal = participant.user.id === serverStore.currentUser?.id;
    return isLocal
      ? this.collectSenderTelemetry(participant.user.id)
      : this.collectReceiverTelemetry(participant.user.id);
  }

  private async collectSenderTelemetry(userId: string): Promise<ScreenTelemetrySnapshot | null> {
    const peerConnections = webRtcManager.getPeerConnections();
    const localTrack = videoService.getScreenStream()?.getVideoTracks()[0] || null;
    const fallback = this.getLocalScreenFallback();

    if (peerConnections.length === 0) {
      return fallback;
    }

    let fps: number | null = fallback?.fps ?? null;
    let width: number | null = fallback?.width ?? null;
    let height: number | null = fallback?.height ?? null;
    let codec: string | null = null;
    let framesEncoded = 0;
    let keyFramesEncoded = 0;
    let totalBitrateKbps = 0;
    let reportCount = 0;

    await Promise.all(peerConnections.map(async (pc, index) => {
      try {
        const stats = await pc.getStats();
        stats.forEach((report: any) => {
          const kind = report.kind || report.mediaType;
          if (report.type !== 'outbound-rtp' || kind !== 'video' || typeof report.bytesSent !== 'number') {
            return;
          }

          reportCount++;
          fps = this.pickTelemetryNumber(fps, report.framesPerSecond);
          width = this.pickTelemetryNumber(width, report.frameWidth);
          height = this.pickTelemetryNumber(height, report.frameHeight);
          if (!codec) {
            codec = this.getCodecName(stats, report.codecId);
          }
          if (typeof report.framesEncoded === 'number') {
            framesEncoded += report.framesEncoded;
          }
          if (typeof report.keyFramesEncoded === 'number') {
            keyFramesEncoded += report.keyFramesEncoded;
          }

          const bitrate = this.computeBitrateKbps(`sender:${userId}:${index}:${report.id}`, report.bytesSent);
          if (bitrate !== null) {
            totalBitrateKbps += bitrate;
          }
        });
      } catch (err) {
        console.warn('[VoiceStageView] Error collecting sender telemetry:', err);
      }
    }));

    if (reportCount === 0) {
      if (localTrack) return fallback;
      return null;
    }

    return {
      kind: 'sender',
      fps,
      width,
      height,
      bitrateKbps: totalBitrateKbps > 0 ? totalBitrateKbps : 0,
      codec,
      framesEncoded,
      keyFramesEncoded,
      packetLossPct: null,
      jitterMs: null,
      framesDecoded: null,
      framesDropped: null,
    };
  }

  private async collectReceiverTelemetry(userId: string): Promise<ScreenTelemetrySnapshot | null> {
    const pc = webRtcManager.getPeerConnection(userId);
    if (!pc) return null;

    try {
      const stats = await pc.getStats();
      let snapshot: ScreenTelemetrySnapshot | null = null;

      stats.forEach((report: any) => {
        const kind = report.kind || report.mediaType;
        if (snapshot || report.type !== 'inbound-rtp' || kind !== 'video' || typeof report.bytesReceived !== 'number') {
          return;
        }

        const packetsReceived = typeof report.packetsReceived === 'number' ? report.packetsReceived : 0;
        const packetsLost = typeof report.packetsLost === 'number' ? report.packetsLost : 0;
        const totalPackets = packetsReceived + packetsLost;
        const packetLossPct = totalPackets > 0 ? (packetsLost / totalPackets) * 100 : 0;
        const jitterMs = typeof report.jitter === 'number' ? report.jitter * 1000 : null;

        snapshot = {
          kind: 'receiver',
          fps: this.pickTelemetryNumber(null, report.framesPerSecond),
          width: this.pickTelemetryNumber(null, report.frameWidth),
          height: this.pickTelemetryNumber(null, report.frameHeight),
          bitrateKbps: this.computeBitrateKbps(`receiver:${userId}:${report.id}`, report.bytesReceived) ?? 0,
          codec: this.getCodecName(stats, report.codecId),
          framesEncoded: null,
          keyFramesEncoded: null,
          packetLossPct,
          jitterMs,
          framesDecoded: typeof report.framesDecoded === 'number' ? report.framesDecoded : null,
          framesDropped: typeof report.framesDropped === 'number' ? report.framesDropped : null,
        };
      });

      return snapshot;
    } catch (err) {
      console.warn('[VoiceStageView] Error collecting receiver telemetry:', err);
      return null;
    }
  }

  private getLocalScreenFallback(): ScreenTelemetrySnapshot | null {
    const track = videoService.getScreenStream()?.getVideoTracks()[0];
    if (!track) return null;

    const settings = track.getSettings();
    return {
      kind: 'sender',
      fps: typeof settings.frameRate === 'number' ? settings.frameRate : null,
      width: typeof settings.width === 'number' ? settings.width : null,
      height: typeof settings.height === 'number' ? settings.height : null,
      bitrateKbps: 0,
      codec: null,
      framesEncoded: null,
      keyFramesEncoded: null,
      packetLossPct: null,
      jitterMs: null,
      framesDecoded: null,
      framesDropped: null,
    };
  }

  private pickTelemetryNumber(currentValue: number | null, nextValue: unknown): number | null {
    return typeof nextValue === 'number' && Number.isFinite(nextValue) ? nextValue : currentValue;
  }

  private getCodecName(stats: RTCStatsReport, codecId?: string): string | null {
    if (!codecId) return null;
    const codecReport = stats.get(codecId) as any;
    const mimeType = typeof codecReport?.mimeType === 'string' ? codecReport.mimeType : '';
    if (!mimeType) return null;
    const parts = mimeType.split('/');
    return parts[parts.length - 1] || mimeType;
  }

  private computeBitrateKbps(key: string, bytes: number): number | null {
    const now = Date.now();
    const previous = this.telemetryByteSamples.get(key);
    this.telemetryByteSamples.set(key, { bytes, timestamp: now });
    if (!previous) return null;

    const deltaBytes = bytes - previous.bytes;
    const deltaMs = now - previous.timestamp;
    if (deltaBytes < 0 || deltaMs <= 0) return null;

    return (deltaBytes * 8) / (deltaMs / 1000) / 1000;
  }

  private pruneTelemetryByteSamples(activeUserIds: string[]): void {
    const activePrefixes = new Set(activeUserIds.map((userId) => `:${userId}:`));
    for (const key of this.telemetryByteSamples.keys()) {
      const isActive = Array.from(activePrefixes).some((prefix) => key.includes(prefix));
      if (!isActive) {
        this.telemetryByteSamples.delete(key);
      }
    }
  }

  private stopTelemetryMonitor(clearSnapshots: boolean = true): void {
    if (this.telemetryInterval !== null) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
    }

    if (clearSnapshots) {
      this.telemetrySnapshots.clear();
      this.telemetryByteSamples.clear();
    }
  }

  private startPingMonitor(): void {
    this.stopPingMonitor();

    const updatePing = async () => {
      const pingBadge = document.getElementById('stage-ping-badge');
      const pingText = document.getElementById('stage-ping-text');
      const tooltipContent = document.getElementById('ping-tooltip-content');

      if (!pingBadge || !pingText || !this.currentChannelId) return;

      const participants = participantManager.getInVoiceChannel(this.currentChannelId);
      const isSolo = participants.length <= 1;

      if (isSolo) {
        pingBadge.className = 'stage-ping-badge good';
        pingText.textContent = '0 ms';
        if (tooltipContent) {
          tooltipContent.innerHTML = `
            ${t('stage.tooltipSolo')}
          `;
        }
        return;
      }

      const avgPing = await webRtcManager.getAverageP2pPing();

      if (avgPing !== null) {
        pingText.textContent = `${avgPing} ms`;

        let quality = t('stage.qualityExcellentShort');
        if (avgPing < 50) {
          pingBadge.className = 'stage-ping-badge good';
          quality = t('stage.qualityExcellent');
        } else if (avgPing < 120) {
          pingBadge.className = 'stage-ping-badge medium';
          quality = t('stage.qualityGood');
        } else {
          pingBadge.className = 'stage-ping-badge bad';
          quality = t('stage.qualityPoor');
        }

        if (tooltipContent) {
          tooltipContent.innerHTML = `
            ${t('stage.tooltipPing', { ping: avgPing, quality })}
          `;
        }
      } else {
        pingText.textContent = 'P2P';
        pingBadge.className = 'stage-ping-badge good';
        if (tooltipContent) {
          tooltipContent.innerHTML = t('stage.tooltipEstablishing');
        }
      }
    };

    updatePing();
    this.pingInterval = setInterval(updatePing, 2000);
  }

  private stopPingMonitor(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Leaves the current voice call. Public so it can also be triggered from the
   * sidebar voice-connection row (#60). No confirmation is shown (#59).
   */
  public leaveVoice(): void {
    if (!this.currentChannelId) return;
    this.stopPingMonitor();
    this.stopTelemetryMonitor();
    soundEffects.play('leave_voice');
    networkClient.send(MessageType.VOICE_LEAVE, { channelId: this.currentChannelId });
    audioProcessor.stopMicrophone();
    videoService.stopCamera();
    videoService.stopScreenShare();
    webRtcManager.closeAllPeers();
    voiceStore.reset();
    this.setChannel(null);
  }

  private async handleStopStreaming(): Promise<void> {
    if (voiceStore.isScreenSharing) {
      const confirmed = await showConfirm({
        title: t('stage.stopSharingTitle'),
        message: t('stage.stopSharingMessage'),
        confirmLabel: t('stage.stop'),
        variant: 'warning',
      });
      if (!confirmed) return;
      videoService.stopScreenShare();
      await webRtcManager.setLocalScreenTrack(null);
      voiceStore.setScreenSharing(false);
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isScreenSharing: false });
    } else if (voiceStore.isCameraOn) {
      videoService.stopCamera();
      await webRtcManager.setLocalCameraTrack(null);
      voiceStore.setCameraOn(false);
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isCameraOn: false });
    }
    this.updateControlsUI();
    this.renderParticipants();
  }

  /**
   * Toggles the local camera. Extracted so it can be triggered both from the
   * stage controls and from the sidebar media bar (#29). Camera and screen
   * share are independent (#26): toggling the camera never stops an active
   * screen share. Cleanly reverts state if the camera fails to start (e.g. no
   * camera plugged in).
   */
  public async toggleCamera(): Promise<void> {
    if (voiceStore.isCameraOn) {
      videoService.stopCamera();
      await webRtcManager.setLocalCameraTrack(null);
      voiceStore.setCameraOn(false);
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isCameraOn: false });
    } else {
      try {
        const stream = await videoService.startCamera();
        const track = stream.getVideoTracks()[0];
        await webRtcManager.setLocalCameraTrack(track);
        voiceStore.setCameraOn(true);
        networkClient.send(MessageType.VOICE_STATE_UPDATE, { isCameraOn: true });
      } catch (err: any) {
        // Fully revert local camera state (screen share, if any, is untouched).
        videoService.stopCamera();
        await webRtcManager.setLocalCameraTrack(null);
        voiceStore.setCameraOn(false);
        networkClient.send(MessageType.VOICE_STATE_UPDATE, { isCameraOn: false });
        await showAlert({
          title: t('stage.cameraErrorTitle'),
          message: t('stage.cameraErrorMessage', { error: err?.message || err }),
          variant: 'danger',
        });
      }
    }
    this.updateControlsUI();
    this.renderParticipants();
  }

  private attachEvents(): void {
    const btnMic = document.getElementById('stage-btn-mic');
    const btnDeafen = document.getElementById('stage-btn-deafen');
    const btnCam = document.getElementById('stage-btn-camera');
    const btnScreen = document.getElementById('stage-btn-screen');
    const btnLeave = document.getElementById('stage-btn-leave');

    btnMic?.addEventListener('click', () => {
      const newMuted = !voiceStore.isMuted;
      voiceStore.setMuted(newMuted);
      audioProcessor.setMuted(newMuted);
      soundEffects.play(newMuted ? 'mic_mute' : 'mic_unmute');
      // Unmuting the mic while deafened doesn't make sense (you'd talk but not
      // hear): also undeafen the audio output in that case (#62).
      let undeafened = false;
      if (!newMuted && voiceStore.isDeafened) {
        voiceStore.setDeafened(false);
        audioProcessor.setDeafened(false);
        webRtcManager.setDeafened(false);
        undeafened = true;
      }
      networkClient.send(MessageType.VOICE_STATE_UPDATE, {
        isMuted: newMuted,
        ...(undeafened ? { isDeafened: false } : {}),
      });
      this.updateControlsUI();
      this.renderParticipants();
    });

    btnDeafen?.addEventListener('click', () => {
      const newDeafened = !voiceStore.isDeafened;
      voiceStore.setDeafened(newDeafened);
      audioProcessor.setDeafened(newDeafened);
      // Restore the mic track to its (possibly restored) pre-deafen state (#74).
      audioProcessor.setMuted(voiceStore.isMuted);
      webRtcManager.setDeafened(newDeafened);
      soundEffects.play(newDeafened ? 'deafen' : 'undeafen');
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isDeafened: newDeafened, isMuted: voiceStore.isMuted });
      this.updateControlsUI();
      this.renderParticipants();
    });

    btnCam?.addEventListener('click', async () => {
      if (isButtonLoading(btnCam)) return;
      setButtonLoading(btnCam, true);
      try {
        await this.toggleCamera();
      } finally {
        setButtonLoading(btnCam, false);
      }
    });

    btnScreen?.addEventListener('click', () => {
      if (isButtonLoading(btnScreen)) return;
      // Show a loading state until the picker modal is actually open (#48).
      setButtonLoading(btnScreen, true);
      window.setTimeout(() => setButtonLoading(btnScreen, false), 10000);
      // Always open the picker: when not sharing, to start; when already sharing,
      // to switch source or stop (handled inside the modal).
      appEvents.emit('modal.open_screenshare_picker');
    });

    const btnViewMode = document.getElementById('stage-btn-viewmode');
    btnViewMode?.addEventListener('click', () => {
      this.gridExpanded = !this.gridExpanded;
      // The expanded grid is a full equal-split view, so leave focus mode.
      if (this.gridExpanded) this.focusedTileKey = null;
      const icon = btnViewMode.querySelector('.material-symbols-outlined');
      if (icon) icon.textContent = this.gridExpanded ? 'view_agenda' : 'grid_view';
      this.renderParticipants();
    });

    const btnSoundboard = document.getElementById('stage-btn-soundboard');
    btnSoundboard?.addEventListener('click', () => {
      soundboardModal.open();
    });

    btnLeave?.addEventListener('click', () => this.leaveVoice());

    // Listeners that do NOT destroy the DOM
    const u1 = appEvents.on('participants.updated', () => {
      this.renderParticipants();
    });

    const u2 = appEvents.on('voice.state_updated', () => {
      this.updateControlsUI();
      this.updateSpeakingClasses();
      this.applyTelemetryOverlayState();
      this.syncTelemetryMonitor();
    });

    const u3 = appEvents.on('participants.speaking_changed', (data: { userId: string; speaking: boolean }) => {
      this.setCardSpeaking(data.userId, data.speaking);
    });

    const u4 = appEvents.on('voice.speaking_changed', (speaking: boolean) => {
      if (serverStore.currentUser) {
        this.setCardSpeaking(serverStore.currentUser.id, speaking);
      }
    });

    // Clear the screen-share button loading once the picker modal is open (or
    // closed, as a safety) — loading should last only until the modal opens (#48).
    const clearScreenLoading = () => setButtonLoading(btnScreen, false);
    const u5 = appEvents.on('modal.screenshare_picker_opened', clearScreenLoading);
    const u6 = appEvents.on('modal.screenshare_picker_closed', clearScreenLoading);
    const u7 = appEvents.on('settings.updated', () => {
      this.applyTelemetryOverlayState();
      this.syncTelemetryMonitor();
    });

    const u8 = appEvents.on('local.screen_audio_started', () => this.updateControlsUI());
    const u9 = appEvents.on('local.screen_audio_stopped', () => this.updateControlsUI());

    this.unbindEvents.push(u1, u2, u3, u4, u5, u6, u7, u8, u9);
  }

  private unbindListeners(): void {
    this.unbindEvents.forEach((u) => u());
    this.unbindEvents = [];
  }

  public destroy(): void {
    this.stopPingMonitor();
    this.stopTelemetryMonitor();
    this.unbindListeners();
  }
}
