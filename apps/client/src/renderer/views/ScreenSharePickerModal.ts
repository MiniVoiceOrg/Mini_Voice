import { MessageType } from '@mini-voice/shared';
import { networkClient } from '../core/NetworkClient';
import { videoService } from '../core/VideoService';
import { voiceStore } from '../stores/voiceStore';
import { webRtcManager } from '../core/WebRtcManager';
import { showAlert } from './Dialog';

export class ScreenSharePickerModal {
  private modalEl: HTMLElement | null = null;
  private selectedSourceId: string | null = null;

  public async open(): Promise<void> {
    this.close();

    let sources: Array<{ id: string; name: string; thumbnailDataUrl: string; appIconDataUrl: string | null }> = [];
    if (window.api?.getDesktopSources) {
      sources = await window.api.getDesktopSources();
    }

    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-backdrop';
    this.modalEl.innerHTML = `
      <div class="modal-card" style="max-width: 640px;">
        <div class="modal-header">
          <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
            <span class="material-symbols-outlined" style="color: var(--accent-primary);">screen_share</span>
            <span>Compartilhar Tela ou Janela</span>
          </div>
          <button id="modal-close" class="modal-close-btn">&times;</button>
        </div>

        ${sources.length > 0 ? `
          <div class="screen-sources-grid">
            ${sources.map((s) => `
              <div class="source-item" data-source-id="${s.id}">
                <img class="source-thumbnail" src="${s.thumbnailDataUrl}" alt="${s.name}">
                <div class="source-name" title="${s.name}">${s.name}</div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div style="padding: 20px; text-align: center; color: var(--text-muted);">
            Selecione uma tela para compartilhar na janela do navegador.
          </div>
        `}

        <div class="modal-footer">
          <button type="button" id="btn-cancel" class="btn btn-secondary">Cancelar</button>
          <button type="button" id="btn-share" class="btn btn-primary" ${sources.length > 0 ? 'disabled' : ''}>
            <span class="material-symbols-outlined md-16" style="margin-right: 4px;">present_to_all</span>
            Compartilhar Tela
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(this.modalEl);
    this.attachEvents(sources);
  }

  private attachEvents(sources: any[]): void {
    if (!this.modalEl) return;

    const btnClose = this.modalEl.querySelector('#modal-close');
    const btnCancel = this.modalEl.querySelector('#btn-cancel');
    const btnShare = this.modalEl.querySelector('#btn-share') as HTMLButtonElement;
    const sourceItems = this.modalEl.querySelectorAll('.source-item');

    btnClose?.addEventListener('click', () => this.close());
    btnCancel?.addEventListener('click', () => this.close());

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

    btnShare?.addEventListener('click', () => {
      this.startSharing();
    });
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
      this.close();
    } catch (err: any) {
      await showAlert({
        title: 'Erro ao compartilhar tela',
        message: `Não foi possível iniciar o compartilhamento de tela: ${err.message}`,
        variant: 'danger',
      });
    }
  }

  public close(): void {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
      this.selectedSourceId = null;
    }
  }
}

export const screenSharePickerModal = new ScreenSharePickerModal();
