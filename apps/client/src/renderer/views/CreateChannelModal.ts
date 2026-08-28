import { MessageType } from '@monky/shared';
import { networkClient } from '../core/NetworkClient';
import { t } from '../i18n';
import { enableBackdropClose } from '../utils/modal';
import {
  attachChannelPrivacyFields,
  readChannelPrivacyFields,
  renderChannelPrivacyFields,
  renderChannelTypeFields,
} from './channelFormFields';

export class CreateChannelModal {
  private modalEl: HTMLElement | null = null;
  private detachPrivacyFields: (() => void) | null = null;

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
          ${renderChannelTypeFields(defaultType)}

          <div class="form-group">
            <label>${t('channelModal.nameLabel')}</label>
            <input id="input-channel-name" type="text" placeholder="${t('channelModal.namePlaceholder')}" required minlength="2" maxlength="50">
          </div>

          ${renderChannelPrivacyFields({ isPrivate: false, allowedRoleIds: [] })}

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
    this.detachPrivacyFields = attachChannelPrivacyFields(this.modalEl);

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = inputName?.value.trim();
      const type = (this.modalEl?.querySelector('input[name="channel-type"]:checked') as HTMLInputElement)?.value as 'TEXT' | 'VOICE';

      if (!name || !this.modalEl) return;

      const privacy = readChannelPrivacyFields(this.modalEl);

      try {
        await networkClient.sendRequest(MessageType.CHANNEL_CREATE, {
          name,
          type,
          isPrivate: privacy.isPrivate,
          allowedRoleIds: privacy.allowedRoleIds,
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
    this.detachPrivacyFields?.();
    this.detachPrivacyFields = null;
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }
}

export const createChannelModal = new CreateChannelModal();
