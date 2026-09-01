import type {
  OverlayConfig,
  OverlayParticipantState,
  OverlaySyncState,
} from '@monky/shared';
import { escapeHtml } from '../utils/html';

type OverlayTile = {
  p: OverlayParticipantState;
  kind: 'camera' | 'screen' | 'voice';
  shareId?: string;
  slotIndex?: number;
  key: string;
};

export class OverlayStageView {
  private container: HTMLElement;
  private currentState: OverlaySyncState | null = null;
  private localPeerConnection: RTCPeerConnection | null = null;
  private slotStreams: MediaStream[] = [];
  private unbindListeners: Array<() => void> = [];

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public init(): void {
    document.body.classList.add('overlay-window-mode');
    document.getElementById('titlebar')?.remove();

    this.initLocalPeerConnection();

    if (window.api?.onOverlaySyncStateReceived) {
      this.unbindListeners.push(
        window.api.onOverlaySyncStateReceived((state) => {
          this.currentState = state;
          this.render();
        })
      );
    }

    if (window.api?.onOverlayConfigUpdated) {
      this.unbindListeners.push(
        window.api.onOverlayConfigUpdated((config) => {
          if (this.currentState) {
            this.currentState.config = config;
            this.render();
          }
        })
      );
    }

    if (window.api?.onOverlaySignalReceived) {
      this.unbindListeners.push(
        window.api.onOverlaySignalReceived(async (signalJson) => {
          try {
            const signal = JSON.parse(signalJson);
            if (signal.type === 'offer' && this.localPeerConnection) {
              await this.localPeerConnection.setRemoteDescription(new RTCSessionDescription(signal));
              const answer = await this.localPeerConnection.createAnswer();
              await this.localPeerConnection.setLocalDescription(answer);

              // Aguarda colheita completa de candidatos host no localhost
              await new Promise<void>((resolve) => {
                if (this.localPeerConnection?.iceGatheringState === 'complete') {
                  resolve();
                } else {
                  const handler = () => {
                    if (this.localPeerConnection?.iceGatheringState === 'complete') {
                      this.localPeerConnection?.removeEventListener('icegatheringstatechange', handler);
                      resolve();
                    }
                  };
                  this.localPeerConnection?.addEventListener('icegatheringstatechange', handler);
                  setTimeout(resolve, 300);
                }
              });

              const completeAnswer = this.localPeerConnection.localDescription || answer;
              if (window.api?.sendOverlaySignal) {
                await window.api.sendOverlaySignal({
                  target: 'main',
                  signal: JSON.stringify(completeAnswer),
                });
              }
            }
          } catch (e) {
            console.warn('[OverlayStage] Erro ao processar sinal WebRTC:', e);
          }
        })
      );
    }

    this.render();

    // Sinaliza ao main bridge que o overlay está pronto para receber a offer WebRTC.
    if (window.api?.sendOverlaySignal) {
      window.api.sendOverlaySignal({
        target: 'main',
        signal: JSON.stringify({ type: 'ready' }),
      }).catch(() => {});
    }
  }

  private initLocalPeerConnection(): void {
    try {
      this.localPeerConnection = new RTCPeerConnection({ iceServers: [] });
      this.slotStreams = [];

      this.localPeerConnection.ontrack = (event) => {
        const mid = event.transceiver?.mid;
        const slotIndex = mid !== undefined && mid !== null ? parseInt(mid, 10) : this.slotStreams.length;
        const stream = event.streams[0] || new MediaStream([event.track]);
        this.slotStreams[slotIndex] = stream;

        event.track.onunmute = () => {
          this.bindVideos();
        };

        this.bindVideos();
      };
    } catch (e) {
      console.warn('[OverlayStage] Erro ao inicializar RTCPeerConnection:', e);
    }
  }

  public render(): void {
    if (!this.currentState || !this.currentState.participants || this.currentState.participants.length === 0) {
      this.renderEmptyState();
      return;
    }

    const config = this.currentState.config;
    const opacity = typeof config.cardOpacity === 'number' ? config.cardOpacity : 0.85;
    const isFocusSpeaker = config.mode === 'cameras-only' && config.focusActiveSpeaker && !config.minimalistMode;
    const isTransparentBg = !!config.transparentBackground;
    const isMinimalist = !!config.minimalistMode;

    let displayParticipants: OverlayParticipantState[] = [];
    if (isFocusSpeaker) {
      const speaker = this.currentState.participants.find((p) => p.sessionId === this.currentState?.activeSpeakerSessionId)
        || this.currentState.participants[0];
      displayParticipants = speaker ? [speaker] : [];
    } else {
      displayParticipants = this.currentState.participants;
    }

    const tiles: OverlayTile[] = [];
    for (const p of displayParticipants) {
      if (isMinimalist) {
        // Modo Minimalista: 1 item por participante sem vídeo
        tiles.push({ p, kind: 'voice', key: `${p.sessionId}-mini` });
      } else if (config.mode === 'cameras-and-screens') {
        if (p.isCameraOn) {
          tiles.push({ p, kind: 'camera', slotIndex: p.videoSlotIndex, key: `${p.sessionId}-cam` });
        }
        for (const shareId of p.screenShareIds) {
          const slot = p.screenSlotIndexes ? p.screenSlotIndexes[shareId] : undefined;
          tiles.push({ p, kind: 'screen', shareId, slotIndex: slot, key: `${p.sessionId}-screen-${shareId}` });
        }
        if (!p.isCameraOn && p.screenShareIds.length === 0) {
          tiles.push({ p, kind: 'voice', key: `${p.sessionId}-voice` });
        }
      } else {
        if (p.isCameraOn) {
          tiles.push({ p, kind: 'camera', slotIndex: p.videoSlotIndex, key: `${p.sessionId}-cam` });
        } else {
          tiles.push({ p, kind: 'voice', key: `${p.sessionId}-voice` });
        }
      }
    }

    let layoutClass = 'layout-grid';
    if (isMinimalist) layoutClass = 'layout-minimalist';
    else if (config.layout === 'vertical') layoutClass = 'layout-vertical';
    else if (config.layout === 'horizontal') layoutClass = 'layout-horizontal';
    if (isFocusSpeaker) layoutClass = 'layout-focus-speaker';

    this.ensureBaseStructure();

    // Atualiza propriedades do container root
    const rootEl = this.container.querySelector('.overlay-stage-root') as HTMLElement | null;
    if (rootEl) {
      rootEl.style.setProperty('--overlay-card-opacity', String(opacity));
      rootEl.classList.toggle('transparent-bg', isTransparentBg);
      rootEl.classList.toggle('minimalist-mode', isMinimalist);
    }

    // Atualiza nome do canal
    const titleEl = this.container.querySelector('.overlay-channel-title') as HTMLElement | null;
    if (titleEl && this.currentState.channelName) {
      titleEl.textContent = this.currentState.channelName;
    }

    // Atualiza container de cards cirurgicamente sem destruir os elementos <video>
    const cardsContainer = this.container.querySelector('.overlay-cards-container') as HTMLElement | null;
    if (cardsContainer) {
      cardsContainer.className = `overlay-cards-container ${layoutClass}`;
      this.reconcileCards(cardsContainer, tiles, isMinimalist);
    }

    if (!isMinimalist) {
      this.bindVideos();
    }
  }

  private renderEmptyState(): void {
    this.container.innerHTML = `
      <div class="overlay-stage-root">
        <div class="overlay-stage-topbar">
          <div class="overlay-drag-handle">
            <span class="material-symbols-outlined md-14" style="color: var(--text-muted); margin-right: 4px;">drag_indicator</span>
            <span class="overlay-channel-title" style="font-size: 11px; font-weight: 600; color: var(--text-muted);">Monky Overlay</span>
          </div>
          <div class="overlay-topbar-actions">
            <button id="btn-overlay-close" class="overlay-action-btn close" title="Fechar Sobreposição">
              <span class="material-symbols-outlined md-14">close</span>
            </button>
          </div>
        </div>
        <div class="overlay-empty-state">
          <span class="material-symbols-outlined md-20" style="color: var(--text-muted); opacity: 0.6;">group</span>
          <span>Aguardando canal de voz...</span>
        </div>
      </div>
    `;
    this.attachControls();
  }

  private ensureBaseStructure(): void {
    let rootEl = this.container.querySelector('.overlay-stage-root');
    const emptyState = this.container.querySelector('.overlay-empty-state');
    if (!rootEl || emptyState) {
      this.container.innerHTML = `
        <div class="overlay-stage-root">
          <div class="overlay-stage-topbar">
            <div class="overlay-drag-handle">
              <span class="material-symbols-outlined md-14" style="color: var(--text-muted); margin-right: 4px;">drag_indicator</span>
              <span class="overlay-channel-title" style="font-size: 11px; font-weight: 600; color: var(--text-muted);"></span>
            </div>
            <div class="overlay-topbar-actions">
              <button id="btn-overlay-close" class="overlay-action-btn close" title="Fechar Sobreposição">
                <span class="material-symbols-outlined md-14">close</span>
              </button>
            </div>
          </div>
          <div class="overlay-cards-container"></div>
        </div>
      `;
      this.attachControls();
    }
  }

  /**
   * Reconciliação cirúrgica de cards do DOM.
   * Preserva a tag <video> e seu srcObject para evitar piscadas e repaints desnecessários.
   */
  private reconcileCards(cardsContainer: HTMLElement, tiles: OverlayTile[], isMinimalist: boolean): void {
    const existingItems = new Map<string, HTMLElement>();
    cardsContainer.querySelectorAll('.overlay-card, .overlay-mini-item').forEach((item) => {
      const key = item.getAttribute('data-tile-key');
      if (key) existingItems.set(key, item as HTMLElement);
    });

    const activeKeys = new Set(tiles.map((t) => t.key));

    // Remove cards obsoletos
    existingItems.forEach((item, key) => {
      if (!activeKeys.has(key)) {
        item.remove();
      }
    });

    // Atualiza ou insere cards/itens
    tiles.forEach((tile, index) => {
      const isSpeaking = tile.p.isSpeaking;
      const name = tile.p.displayName;
      const hasVideo = !isMinimalist && (tile.kind === 'camera' || tile.kind === 'screen') && tile.slotIndex !== undefined;
      const slotStr = tile.slotIndex !== undefined ? String(tile.slotIndex) : '';

      let item = existingItems.get(tile.key);

      if (isMinimalist) {
        // Renderização minimalista
        if (!item || !item.classList.contains('overlay-mini-item')) {
          item?.remove();
          item = document.createElement('div');
          item.className = `overlay-mini-item ${isSpeaking ? 'speaking' : ''}`;
          item.setAttribute('data-tile-key', tile.key);
          item.innerHTML = this.getMinimalistInnerHtml(tile.p, name, isSpeaking);
          cardsContainer.appendChild(item);
        } else {
          item.className = `overlay-mini-item ${isSpeaking ? 'speaking' : ''}`;
          const nameEl = item.querySelector('.overlay-mini-name');
          if (nameEl && nameEl.textContent !== name) nameEl.textContent = name;

          const avatarImg = item.querySelector('.overlay-mini-avatar') as HTMLImageElement | null;
          if (avatarImg && tile.p.avatarUrl && avatarImg.src !== tile.p.avatarUrl) {
            avatarImg.src = tile.p.avatarUrl;
          }

          const pulseEl = item.querySelector('.overlay-mini-avatar, .overlay-mini-avatar-placeholder');
          if (pulseEl) pulseEl.classList.toggle('speaking-pulse', isSpeaking);

          const iconsEl = item.querySelector('.overlay-mini-icons');
          if (iconsEl) iconsEl.innerHTML = this.getMiniIconsHtml(tile.p);
        }
      } else {
        // Renderização padrão de cards
        if (!item || item.classList.contains('overlay-mini-item')) {
          item?.remove();
          item = document.createElement('div');
          item.setAttribute('data-tile-key', tile.key);
          item.innerHTML = this.getCardInnerHtml(tile, hasVideo, name, isSpeaking);
          cardsContainer.appendChild(item);
        } else {
          const hadVideo = item.classList.contains('has-video');
          if (hadVideo !== hasVideo) {
            item.innerHTML = this.getCardInnerHtml(tile, hasVideo, name, isSpeaking);
          } else {
            const nameEl = item.querySelector('.overlay-user-name');
            if (nameEl && nameEl.textContent !== name) {
              nameEl.textContent = name;
            }

            const avatarImg = item.querySelector('.overlay-avatar-img') as HTMLImageElement | null;
            if (avatarImg && tile.p.avatarUrl && avatarImg.src !== tile.p.avatarUrl) {
              avatarImg.src = tile.p.avatarUrl;
            }

            const avatarPulse = item.querySelector('.overlay-avatar-img, .overlay-avatar-placeholder');
            if (avatarPulse) {
              avatarPulse.classList.toggle('speaking-pulse', isSpeaking);
            }

            const badgesEl = item.querySelector('.overlay-user-badges');
            if (badgesEl) {
              badgesEl.innerHTML = this.getBadgesHtml(tile);
            }
          }
        }

        item.className = `overlay-card ${hasVideo ? 'has-video' : 'voice-only'} ${isSpeaking ? 'speaking' : ''}`;
        item.setAttribute('data-slot', slotStr);
      }

      // Garante a ordem correta no DOM
      if (cardsContainer.children[index] !== item) {
        cardsContainer.insertBefore(item, cardsContainer.children[index] || null);
      }
    });
  }

  private getCardInnerHtml(tile: OverlayTile, hasVideo: boolean, name: string, isSpeaking: boolean): string {
    const escapedName = escapeHtml(name);
    return `
      ${hasVideo ? `
        <div class="overlay-video-wrapper">
          <video id="vid-${tile.key}" autoplay playsinline muted></video>
        </div>
      ` : `
        <div class="overlay-avatar-wrapper">
          ${tile.p.avatarUrl ? `
            <img src="${tile.p.avatarUrl}" alt="${escapedName}" class="overlay-avatar-img ${isSpeaking ? 'speaking-pulse' : ''}" />
          ` : `
            <div class="overlay-avatar-placeholder ${isSpeaking ? 'speaking-pulse' : ''}">${escapedName.charAt(0).toUpperCase()}</div>
          `}
        </div>
      `}

      <div class="overlay-card-footer">
        <span class="overlay-user-name">${escapedName}</span>
        <div class="overlay-user-badges">
          ${this.getBadgesHtml(tile)}
        </div>
      </div>
    `;
  }

  private getMinimalistInnerHtml(p: OverlayParticipantState, name: string, isSpeaking: boolean): string {
    const escapedName = escapeHtml(name);
    return `
      <div class="overlay-mini-avatar-wrapper">
        ${p.avatarUrl ? `
          <img src="${p.avatarUrl}" alt="${escapedName}" class="overlay-mini-avatar ${isSpeaking ? 'speaking-pulse' : ''}" />
        ` : `
          <div class="overlay-mini-avatar-placeholder ${isSpeaking ? 'speaking-pulse' : ''}">${escapedName.charAt(0).toUpperCase()}</div>
        `}
      </div>
      <span class="overlay-mini-name">${escapedName}</span>
      <div class="overlay-mini-icons">
        ${this.getMiniIconsHtml(p)}
      </div>
    `;
  }

  private getMiniIconsHtml(p: OverlayParticipantState): string {
    return `
      ${p.isMuted ? '<span class="material-symbols-outlined md-14" style="color: var(--danger);">mic_off</span>' : ''}
      ${p.isDeafened ? '<span class="material-symbols-outlined md-14" style="color: var(--danger);">headset_off</span>' : ''}
      ${p.screenShareIds.length > 0 ? '<span class="material-symbols-outlined md-14" style="color: var(--success);">screen_share</span>' : ''}
      ${p.isCameraOn ? '<span class="material-symbols-outlined md-14" style="color: var(--primary);">videocam</span>' : ''}
    `;
  }

  private getBadgesHtml(tile: OverlayTile): string {
    return `
      ${tile.p.isMuted ? '<span class="material-symbols-outlined md-12" style="color: var(--danger);">mic_off</span>' : ''}
      ${tile.p.isDeafened ? '<span class="material-symbols-outlined md-12" style="color: var(--danger);">headset_off</span>' : ''}
      ${tile.kind === 'camera' ? '<span class="material-symbols-outlined md-12" style="color: var(--primary);">videocam</span>' : ''}
      ${tile.kind === 'screen' ? '<span class="material-symbols-outlined md-12" style="color: var(--success);">screen_share</span>' : ''}
    `;
  }

  private bindVideos(): void {
    if (this.slotStreams.length === 0) return;

    const cards = this.container.querySelectorAll('.overlay-card.has-video');
    cards.forEach((card) => {
      const tileKey = card.getAttribute('data-tile-key');
      const slotStr = card.getAttribute('data-slot');
      if (!tileKey || !slotStr) return;

      const slotIndex = parseInt(slotStr, 10);
      if (isNaN(slotIndex) || slotIndex < 0 || slotIndex >= this.slotStreams.length) return;

      const stream = this.slotStreams[slotIndex];
      const videoEl = card.querySelector('video') as HTMLVideoElement | null;
      if (videoEl && stream) {
        if (videoEl.srcObject !== stream) {
          videoEl.muted = true;
          videoEl.autoplay = true;
          videoEl.playsInline = true;
          videoEl.srcObject = stream;
          videoEl.play().catch(() => {});
        }
      }
    });
  }

  private attachControls(): void {
    const btnClose = this.container.querySelector('#btn-overlay-close');
    btnClose?.addEventListener('click', () => {
      if (window.api?.closeOverlay) {
        window.api.closeOverlay().catch(() => {});
      }
    });
  }

  public destroy(): void {
    this.unbindListeners.forEach((u) => u());
    this.unbindListeners = [];
    if (this.localPeerConnection) {
      try {
        this.localPeerConnection.close();
      } catch {}
      this.localPeerConnection = null;
    }
  }
}
