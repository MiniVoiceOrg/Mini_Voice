import { MessageType } from '@monky/shared';
import { escapeHtml } from '../utils/html';
import { appEvents } from '../core/EventBus';
import { enableBackdropClose } from '../utils/modal';
import { networkClient } from '../core/NetworkClient';
import { screenAudioService } from '../core/ScreenAudioService';
import { videoService } from '../core/VideoService';
import { voiceStore, VoiceStore } from '../stores/voiceStore';
import { webRtcManager } from '../core/WebRtcManager';
import { showAlert } from './Dialog';
import { t } from '../i18n';

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
            <span>${alreadySharing ? t('screenShare.titleSwitch') : t('screenShare.title')}</span>
          </div>
          <button id="modal-close" class="modal-close-btn">&times;</button>
        </div>

        ${alreadySharing ? `
          <div class="share-active-banner">
            <span class="live-pulse-dot"></span>
            <span>${t('screenShare.alreadySharingNotice')}</span>
          </div>
        ` : ''}

        <div class="nav-tabs" style="margin-bottom: 12px;">
          <button type="button" id="share-tab-screen" class="tab-button ${this.activeTab === 'screen' ? 'active' : ''}">
            <span class="material-symbols-outlined md-16" style="margin-right: 4px; vertical-align: middle;">desktop_windows</span>
            ${t('screenShare.screensTab')}
          </button>
          <button type="button" id="share-tab-window" class="tab-button ${this.activeTab === 'window' ? 'active' : ''}">
            <span class="material-symbols-outlined md-16" style="margin-right: 4px; vertical-align: middle;">web_asset</span>
            ${t('screenShare.windowsTab')}
          </button>
        </div>

        <div id="share-sources-panel"></div>

        <div class="modal-footer">
          <label id="share-audio-label" style="display: flex; align-items: center; gap: 8px; margin-right: auto; cursor: pointer; font-size: 0.85rem; color: var(--text-secondary);">
            <span class="material-symbols-outlined md-16">volume_up</span>
            <span id="share-audio-text">${this.activeTab === 'window' ? t('screenShare.shareAppAudio') : t('screenShare.shareAudio')}</span>
            <label class="toggle-switch" style="margin-left: 4px;">
              <input type="checkbox" id="chk-share-audio" ${!screenAudioService.getIsTestTone() ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </label>
          </label>
          <button type="button" id="btn-cancel" class="btn btn-secondary">${t('common.cancel')}</button>
          ${alreadySharing && voiceStore.canAddScreenShare() ? `
            <button type="button" id="btn-share-add" class="btn btn-secondary" disabled>
              <span class="material-symbols-outlined md-16" style="margin-right: 4px;">add_to_queue</span>
              ${t('screenShare.confirmAdd')}
            </button>
          ` : ''}
          <button type="button" id="btn-share" class="btn btn-primary" disabled>
            <span class="material-symbols-outlined md-16" style="margin-right: 4px;">present_to_all</span>
            ${alreadySharing ? t('screenShare.confirmSwitch') : t('screenShare.confirm')}
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
            ? t('screenShare.noScreens')
            : t('screenShare.noWindows')}
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
    const confirmButtons = this.modalEl.querySelectorAll(
      '#btn-share, #btn-share-add'
    ) as NodeListOf<HTMLButtonElement>;
    const sourceItems = this.modalEl.querySelectorAll('.source-item');

    sourceItems.forEach((item) => {
      item.addEventListener('click', () => {
        sourceItems.forEach((i) => i.classList.remove('selected'));
        item.classList.add('selected');
        this.selectedSourceId = item.getAttribute('data-source-id');
        confirmButtons.forEach((btn) => { btn.disabled = false; });
      });

      item.addEventListener('dblclick', () => {
        this.selectedSourceId = item.getAttribute('data-source-id');
        // Double-click keeps the historical "switch source" shortcut (#264).
        this.startSharing('replace');
      });
    });
  }

  private attachEvents(sources: DesktopSource[]): void {
    if (!this.modalEl) return;

    const btnClose = this.modalEl.querySelector('#modal-close');
    const btnCancel = this.modalEl.querySelector('#btn-cancel');
    const btnShare = this.modalEl.querySelector('#btn-share') as HTMLButtonElement;
    const btnShareAdd = this.modalEl.querySelector('#btn-share-add') as HTMLButtonElement | null;
    const tabScreen = this.modalEl.querySelector('#share-tab-screen');
    const tabWindow = this.modalEl.querySelector('#share-tab-window');

    btnClose?.addEventListener('click', () => this.close());
    enableBackdropClose(this.modalEl, () => this.close());
    btnCancel?.addEventListener('click', () => this.close());
    btnShare?.addEventListener('click', () => this.startSharing('replace'));
    btnShareAdd?.addEventListener('click', () => this.startSharing('add'));

    const switchTab = (tab: 'screen' | 'window') => {
      this.activeTab = tab;
      this.selectedSourceId = null;
      if (btnShare) btnShare.disabled = true;
      if (btnShareAdd) btnShareAdd.disabled = true;
      tabScreen?.classList.toggle('active', tab === 'screen');
      tabWindow?.classList.toggle('active', tab === 'window');
      const audioText = this.modalEl?.querySelector('#share-audio-text');
      if (audioText) {
        audioText.textContent = tab === 'window' ? t('screenShare.shareAppAudio') : t('screenShare.shareAudio');
      }
      this.renderSources(sources);
    };

    tabScreen?.addEventListener('click', () => switchTab('screen'));
    tabWindow?.addEventListener('click', () => switchTab('window'));
  }

  /**
   * Starts a screen share. 'replace' keeps the historical behaviour of swapping
   * the current source (#264); 'add' broadcasts an extra screen alongside the
   * existing ones, up to VoiceStore.MAX_SCREEN_SHARES (#253).
   */
  private async startSharing(mode: 'add' | 'replace'): Promise<void> {
    if (mode === 'add' && !voiceStore.canAddScreenShare()) {
      await showAlert({
        title: t('screenShare.limitTitle'),
        message: t('screenShare.limitMessage', { max: String(VoiceStore.MAX_SCREEN_SHARES) }),
        variant: 'warning',
      });
      return;
    }

    try {
      // Acquire the new capture BEFORE tearing anything down: if the user
      // cancels the OS picker or the source vanished, the current share must
      // survive untouched instead of leaving local and server state disagreeing.
      const previousShareIds = mode === 'replace' ? [...voiceStore.screenShareIds] : [];
      const stream = await videoService.startScreenShare(this.selectedSourceId || undefined);

      for (const previousId of previousShareIds) {
        videoService.stopScreenShare(previousId);
        await webRtcManager.removeLocalScreenTrack(previousId);
        voiceStore.removeScreenShare(previousId);
      }

      await webRtcManager.addLocalScreenTrack(stream);
      voiceStore.addScreenShare(stream.id);
      // Camera and screen are independent (#26) — do not disturb camera state.
      networkClient.send(MessageType.VOICE_STATE_UPDATE, {
        screenShareIds: voiceStore.screenShareIds,
        isScreenSharing: true,
      });

      // Start or stop screen audio capture based on checkbox. When sharing a
      // single window, pass its source id so only that app's audio is captured.
      // Only one share may carry system audio at a time (#253), so starting it
      // for a new share replaces whatever was capturing before.
      const chk = this.modalEl?.querySelector('#chk-share-audio') as HTMLInputElement | null;
      if (chk?.checked) {
        if (screenAudioService.getIsCapturing()) {
          await screenAudioService.stop();
        }
        const audioTrack = await screenAudioService.start(this.selectedSourceId || undefined);
        if (audioTrack) {
          voiceStore.setScreenAudioShare(stream.id);
        } else {
          console.warn('[ScreenShare] Screen audio capture not available or failed to start');
        }
      }

      this.close();
    } catch (err: any) {
      await showAlert({
        title: t('screenShare.errorTitle'),
        message: t('screenShare.errorMessage', { error: err.message }),
        variant: 'danger',
      });
    }
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
