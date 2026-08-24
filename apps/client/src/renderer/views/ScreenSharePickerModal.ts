import { MessageType } from '@mini-voice/shared';
import { escapeHtml } from '../utils/html';
import { appEvents } from '../core/EventBus';
import { networkClient } from '../core/NetworkClient';
import { screenAudioService } from '../core/ScreenAudioService';
import { videoService } from '../core/VideoService';
import { voiceStore } from '../stores/voiceStore';
import { webRtcManager } from '../core/WebRtcManager';
import { showAlert } from './Dialog';

type DesktopSource = {
  id: string;
  name: string;
  type: 'screen' | 'window';
  thumbnailDataUrl: string;
  appIconDataUrl: string | null;
};

export class ScreenSharePickerModal {
  private modalEl: HTMLElement | null = null;
  private selectedSourceId: string | null = null;
  private activeTab: 'screen' | 'window' = 'screen';

  public async open(): Promise<void> {
    this.close();

    let sources: DesktopSource[] = [];
    if (window.api?.getDesktopSources) {
      sources = (await window.api.getDesktopSources()) as DesktopSource[];
    }

    // When there is nothing on a given tab, fall back to the one that has sources.
    const hasScreens = sources.some((s) => s.type === 'screen');
    if (!hasScreens && sources.some((s) => s.type === 'window')) {
      this.activeTab = 'window';
    }

    const alreadySharing = voiceStore.isScreenSharing;

    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-backdrop';
    this.modalEl.innerHTML = `
      <div class="modal-card" style="max-width: 680px;">
        <div class="modal-header">
          <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
            <span class="material-symbols-outlined" style="color: var(--accent-primary);">screen_share</span>
            <span>${alreadySharing ? 'Trocar Fonte de Compartilhamento' : 'Compartilhar Tela ou Janela'}</span>
          </div>
          <button id="modal-close" class="modal-close-btn">&times;</button>
        </div>

        ${alreadySharing ? `
          <div class="share-active-banner">
            <span class="live-pulse-dot"></span>
            <span>Você está compartilhando agora. Escolha outra fonte para trocar ou pare de compartilhar.</span>
          </div>
        ` : ''}

        <div class="nav-tabs" style="margin-bottom: 12px;">
          <button type="button" id="share-tab-screen" class="tab-button ${this.activeTab === 'screen' ? 'active' : ''}">
            <span class="material-symbols-outlined md-16" style="margin-right: 4px; vertical-align: middle;">desktop_windows</span>
            Telas
          </button>
          <button type="button" id="share-tab-window" class="tab-button ${this.activeTab === 'window' ? 'active' : ''}">
            <span class="material-symbols-outlined md-16" style="margin-right: 4px; vertical-align: middle;">web_asset</span>
            Aplicativos
          </button>
        </div>

        <div id="share-sources-panel"></div>

        <div class="modal-footer">
          ${alreadySharing ? `
            <button type="button" id="btn-stop-share" class="btn btn-danger" style="margin-right: auto;">
              <span class="material-symbols-outlined md-16" style="margin-right: 4px;">stop_screen_share</span>
              Parar de Compartilhar
            </button>
          ` : ''}
          <label id="share-audio-label" style="display: flex; align-items: center; gap: 6px; margin-right: auto; cursor: pointer; font-size: 0.85rem; color: var(--text-secondary);">
            <input type="checkbox" id="chk-share-audio" style="cursor: pointer;" ${!screenAudioService.getIsTestTone() ? 'checked' : ''} />
            <span class="material-symbols-outlined md-16">volume_up</span>
            <span id="share-audio-text">${this.activeTab === 'window' ? 'Compartilhar áudio do aplicativo' : 'Compartilhar áudio do PC'}</span>
          </label>
          <button type="button" id="btn-cancel" class="btn btn-secondary">Cancelar</button>
          <button type="button" id="btn-share" class="btn btn-primary" disabled>
            <span class="material-symbols-outlined md-16" style="margin-right: 4px;">present_to_all</span>
            ${alreadySharing ? 'Trocar Fonte' : 'Compartilhar'}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(this.modalEl);
    this.renderSources(sources);
    this.attachEvents(sources);
    // Signal that the picker is now visible so the triggering button can clear
    // its loading state (loading should last only until the modal opens) (#48).
    appEvents.emit('modal.screenshare_picker_opened');
  }

  private renderSources(sources: DesktopSource[]): void {
    const panel = this.modalEl?.querySelector('#share-sources-panel');
    if (!panel) return;

    const filtered = sources.filter((s) => s.type === this.activeTab);

    if (filtered.length === 0) {
      panel.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-muted);">
          ${this.activeTab === 'screen'
            ? 'Nenhuma tela detectada.'
            : 'Nenhuma janela de aplicativo aberta foi detectada.'}
        </div>
      `;
      return;
    }

    panel.innerHTML = `
      <div class="screen-sources-grid">
        ${filtered.map((s) => `
          <div class="source-item ${this.selectedSourceId === s.id ? 'selected' : ''}" data-source-id="${escapeHtml(s.id)}">
            <img class="source-thumbnail" src="${s.thumbnailDataUrl}" alt="${escapeHtml(s.name)}">
            <div class="source-name" title="${escapeHtml(s.name)}">
              ${s.appIconDataUrl ? `<img src="${s.appIconDataUrl}" style="width: 14px; height: 14px; vertical-align: middle; margin-right: 4px;">` : ''}
              ${escapeHtml(s.name)}
            </div>
          </div>
        `).join('')}
      </div>
    `;

    this.attachSourceEvents();
  }

  private attachSourceEvents(): void {
    if (!this.modalEl) return;
    const btnShare = this.modalEl.querySelector('#btn-share') as HTMLButtonElement;
    const sourceItems = this.modalEl.querySelectorAll('.source-item');

    sourceItems.forEach((item) => {
      item.addEventListener('click', () => {
        sourceItems.forEach((i) => i.classList.remove('selected'));
        item.classList.add('selected');
        this.selectedSourceId = item.getAttribute('data-source-id');
        if (btnShare) btnShare.disabled = false;
      });

      item.addEventListener('dblclick', () => {
        this.selectedSourceId = item.getAttribute('data-source-id');
        this.startSharing();
      });
    });
  }

  private attachEvents(sources: DesktopSource[]): void {
    if (!this.modalEl) return;

    const btnClose = this.modalEl.querySelector('#modal-close');
    const btnCancel = this.modalEl.querySelector('#btn-cancel');
    const btnShare = this.modalEl.querySelector('#btn-share') as HTMLButtonElement;
    const btnStop = this.modalEl.querySelector('#btn-stop-share');
    const tabScreen = this.modalEl.querySelector('#share-tab-screen');
    const tabWindow = this.modalEl.querySelector('#share-tab-window');

    btnClose?.addEventListener('click', () => this.close());
    btnCancel?.addEventListener('click', () => this.close());
    btnShare?.addEventListener('click', () => this.startSharing());
    btnStop?.addEventListener('click', () => this.stopSharing());

    const switchTab = (tab: 'screen' | 'window') => {
      this.activeTab = tab;
      this.selectedSourceId = null;
      if (btnShare) btnShare.disabled = true;
      tabScreen?.classList.toggle('active', tab === 'screen');
      tabWindow?.classList.toggle('active', tab === 'window');
      const audioText = this.modalEl?.querySelector('#share-audio-text');
      if (audioText) {
        audioText.textContent = tab === 'window' ? 'Compartilhar áudio do aplicativo' : 'Compartilhar áudio do PC';
      }
      this.renderSources(sources);
    };

    tabScreen?.addEventListener('click', () => switchTab('screen'));
    tabWindow?.addEventListener('click', () => switchTab('window'));
  }

  private async startSharing(): Promise<void> {
    try {
      if (voiceStore.isCameraOn) {
        videoService.stopCamera();
        await webRtcManager.setLocalCameraTrack(null);
        voiceStore.setCameraOn(false);
      }
      const stream = await videoService.startScreenShare(this.selectedSourceId || undefined);
      const track = stream.getVideoTracks()[0];
      await webRtcManager.setLocalScreenTrack(track);
      voiceStore.setScreenSharing(true);
      networkClient.send(MessageType.VOICE_STATE_UPDATE, { isScreenSharing: true, isCameraOn: false });

      // Start or stop screen audio capture based on checkbox. When sharing a
      // single window, pass its source id so only that app's audio is captured.
      const chk = this.modalEl?.querySelector('#chk-share-audio') as HTMLInputElement | null;
      if (chk?.checked && !screenAudioService.getIsCapturing()) {
        const audioTrack = await screenAudioService.start(this.selectedSourceId || undefined);
        if (!audioTrack) {
          console.warn('[ScreenShare] Screen audio capture not available or failed to start');
        }
      } else if (!chk?.checked && screenAudioService.getIsCapturing()) {
        await screenAudioService.stop();
      }

      this.close();
    } catch (err: any) {
      await showAlert({
        title: 'Erro ao compartilhar tela',
        message: `Não foi possível iniciar o compartilhamento de tela: ${err.message}`,
        variant: 'danger',
      });
    }
  }

  private async stopSharing(): Promise<void> {
    videoService.stopScreenShare();
    await webRtcManager.setLocalScreenTrack(null);
    voiceStore.setScreenSharing(false);
    networkClient.send(MessageType.VOICE_STATE_UPDATE, { isScreenSharing: false });

    if (screenAudioService.getIsCapturing()) {
      await screenAudioService.stop();
    }

    this.close();
  }

  public close(): void {
    const wasOpen = this.modalEl !== null;
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
      this.selectedSourceId = null;
    }
    // Let callers (e.g. the screen-share button loading state) know the picker
    // is no longer open, including on cancel (#48). Only emit when something was
    // actually open, otherwise the close() call at the start of open() would
    // instantly clear the button loading before the picker even appears.
    if (wasOpen) {
      appEvents.emit('modal.screenshare_picker_closed');
    }
  }
}

export const screenSharePickerModal = new ScreenSharePickerModal();
