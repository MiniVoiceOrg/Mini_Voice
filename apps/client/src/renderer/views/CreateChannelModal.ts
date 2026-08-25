import { MessageType } from '@monky/shared';
import { networkClient } from '../core/NetworkClient';
import { t } from '../i18n';
import { enableBackdropClose } from '../utils/modal';

export class CreateChannelModal {
  private modalEl: HTMLElement | null = null;

  public open(defaultType: 'TEXT' | 'VOICE' = 'TEXT'): void {
    this.close();

    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-backdrop';
    this.modalEl.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <div class="modal-title">${t('channelModal.title')}</div>
          <button id="modal-close" class="modal-close-btn">&times;</button>
        </div>

        <div id="channel-error-banner" class="error-banner"></div>

        <form id="form-create-channel">
          <div class="form-group">
            <label>${t('channelModal.typeLabel')}</label>
            <div style="display: flex; gap: 12px; margin-top: 4px;">
              <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; text-transform: none; color: var(--text-primary);">
                <input type="radio" name="channel-type" value="TEXT" ${defaultType === 'TEXT' ? 'checked' : ''}>
                <span class="material-symbols-outlined md-16" style="color: var(--text-muted);">tag</span>
                <span>${t('channelModal.typeText')}</span>
              </label>
              <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; text-transform: none; color: var(--text-primary);">
                <input type="radio" name="channel-type" value="VOICE" ${defaultType === 'VOICE' ? 'checked' : ''}>
                <span class="material-symbols-outlined md-16" style="color: var(--success);">volume_up</span>
                <span>${t('channelModal.typeVoice')}</span>
              </label>
            </div>
          </div>

          <div class="form-group">
            <label>${t('channelModal.nameLabel')}</label>
            <input id="input-channel-name" type="text" placeholder="${t('channelModal.namePlaceholder')}" required minlength="2" maxlength="50">
          </div>

          <div class="modal-footer">
            <button type="button" id="btn-cancel" class="btn btn-secondary">${t('common.cancel')}</button>
            <button type="submit" id="btn-create" class="btn btn-primary">${t('channelModal.submit')}</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(this.modalEl);
    this.attachEvents();
  }

  private attachEvents(): void {
    if (!this.modalEl) return;

    const btnClose = this.modalEl.querySelector('#modal-close');
    const btnCancel = this.modalEl.querySelector('#btn-cancel');
    const form = this.modalEl.querySelector('#form-create-channel') as HTMLFormElement;
    const inputName = this.modalEl.querySelector('#input-channel-name') as HTMLInputElement;

    btnClose?.addEventListener('click', () => this.close());
    btnCancel?.addEventListener('click', () => this.close());
    enableBackdropClose(this.modalEl, () => this.close());

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = inputName?.value.trim();
      const type = (this.modalEl?.querySelector('input[name="channel-type"]:checked') as HTMLInputElement)?.value as 'TEXT' | 'VOICE';

      if (!name) return;

      try {
        await networkClient.sendRequest(MessageType.CHANNEL_CREATE, {
          name,
          type,
        });
        this.close();
      } catch (err: any) {
        const banner = document.getElementById('channel-error-banner');
        if (banner) {
          banner.innerText = err.message || t('channelModal.error');
          banner.classList.add('show');
        }
      }
    });
  }

  public close(): void {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }
}

export const createChannelModal = new CreateChannelModal();
