import { MessageType, ServerUpdateSettingsPayload } from '@mini-voice/shared';
import { escapeHtml } from '../utils/html';
import { networkClient } from '../core/NetworkClient';
import { serverStore } from '../stores/serverStore';
import { t } from '../i18n';

export class ServerSettingsModal {
  private modalEl: HTMLElement | null = null;
  private shouldRemovePassword = false;

  public open(): void {
    this.close();
    this.shouldRemovePassword = false;

    const s = serverStore.serverDetails;
    if (!s) return;

    const hasPass = !!s.hasPassword;

    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-backdrop';
    this.modalEl.innerHTML = `
      <div class="modal-card" style="max-width: 460px;">
        <div class="modal-header">
          <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
            <span class="material-symbols-outlined" style="color: var(--accent-primary);">settings</span>
            <span>${t('serverSettings.title')}</span>
          </div>
          <button id="modal-close" class="modal-close-btn">&times;</button>
        </div>

        <div id="server-settings-banner" class="error-banner"></div>

        <form id="form-server-settings">
          <div class="form-group">
            <label>${t('serverSettings.nameLabel')}</label>
            <input id="input-server-name" type="text" value="${escapeHtml(s.name)}" required minlength="2" maxlength="50">
          </div>

          <div style="margin-top: 18px; border-top: 1px solid var(--border-color); padding-top: 16px;">
            <label style="font-weight: 700; font-size: 13px; color: var(--text-primary); display: block; margin-bottom: 8px;">
              ${t('serverSettings.securitySection')}
            </label>

            <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-tertiary); padding: 10px 14px; border-radius: var(--radius-md); margin-bottom: 12px; border: 1px solid var(--border-color);">
              <div>
                <div style="font-size: 13px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                  <span class="material-symbols-outlined md-16" style="color: ${hasPass ? '#f0b232' : '#23a55a'};">${hasPass ? 'lock' : 'lock_open'}</span>
                  <span>${hasPass ? t('serverSettings.statusProtected') : t('serverSettings.statusOpen')}</span>
                </div>
                <div id="password-status-desc" style="font-size: 11px; color: var(--text-muted); margin-top: 2px; margin-left: 22px;">
                  ${hasPass ? t('serverSettings.statusProtectedDesc') : t('serverSettings.statusOpenDesc')}
                </div>
              </div>

              ${hasPass ? `
                <button type="button" id="btn-remove-pass" class="btn btn-secondary" style="font-size: 11px; padding: 4px 10px; color: var(--danger); border-color: rgba(237, 66, 69, 0.4);">
                  ${t('serverSettings.removePassword')}
                </button>
              ` : ''}
            </div>

            <div class="form-group" style="margin-bottom: 4px;">
              <label id="label-password-field">${hasPass ? t('serverSettings.changePasswordLabel') : t('serverSettings.setPasswordLabel')}</label>
              <input id="input-server-pass" type="password" placeholder="${hasPass ? t('serverSettings.changePasswordPlaceholder') : t('serverSettings.setPasswordPlaceholder')}">
            </div>
            <div id="pass-help-text" style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
              ${t('serverSettings.passwordHelp')}
            </div>
          </div>

          <div style="margin-top: 18px; border-top: 1px solid var(--border-color); padding-top: 16px;">
            <label style="font-weight: 700; font-size: 13px; color: var(--text-primary); display: block; margin-bottom: 8px;">
              ${t('serverSettings.voiceSection')}
            </label>

            <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-tertiary); padding: 10px 14px; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
              <div>
                <label for="checkbox-allow-soundboard" style="font-size: 13px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 6px; cursor: pointer; margin-bottom: 2px;">
                  <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">music_note</span>
                  <span>${t('serverSettings.allowSoundboard')}</span>
                </label>
                <div style="font-size: 11px; color: var(--text-muted);">
                  ${t('serverSettings.allowSoundboardDesc')}
                </div>
              </div>
              <input id="checkbox-allow-soundboard" type="checkbox" ${s.allowSoundboard !== false ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--accent-primary);">
            </div>
          </div>

          <div class="modal-footer" style="margin-top: 24px;">
            <button type="button" id="btn-cancel" class="btn btn-secondary">${t('common.cancel')}</button>
            <button type="submit" id="btn-save" class="btn btn-primary">${t('serverSettings.save')}</button>
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
    const btnRemovePass = this.modalEl.querySelector('#btn-remove-pass') as HTMLButtonElement;
    const form = this.modalEl.querySelector('#form-server-settings') as HTMLFormElement;
    const inputName = this.modalEl.querySelector('#input-server-name') as HTMLInputElement;
    const inputPass = this.modalEl.querySelector('#input-server-pass') as HTMLInputElement;
    const checkboxAllowSoundboard = this.modalEl.querySelector('#checkbox-allow-soundboard') as HTMLInputElement | null;
    const passHelpText = this.modalEl.querySelector('#pass-help-text') as HTMLElement | null;
    const statusDesc = this.modalEl.querySelector('#password-status-desc') as HTMLElement | null;

    btnClose?.addEventListener('click', () => this.close());
    btnCancel?.addEventListener('click', () => this.close());

    btnRemovePass?.addEventListener('click', () => {
      this.shouldRemovePassword = true;
      if (inputPass) {
        inputPass.value = '';
        inputPass.placeholder = t('serverSettings.passwordWillBeRemoved');
      }
      if (passHelpText) {
        passHelpText.innerHTML = `<span style="color: var(--danger); font-weight: 600;">${t('serverSettings.passwordRemovalWarning')}</span>`;
      }
      if (statusDesc) {
        statusDesc.innerText = t('serverSettings.markedForRemoval');
      }
      btnRemovePass.style.display = 'none';
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = inputName?.value.trim();
      const passVal = inputPass?.value;
      const allowSoundboard = checkboxAllowSoundboard ? checkboxAllowSoundboard.checked : true;

      if (!name) return;

      const payload: ServerUpdateSettingsPayload = {
        name,
        allowSoundboard,
      };

      if (this.shouldRemovePassword) {
        payload.password = null;
      } else if (passVal && passVal.trim().length > 0) {
        payload.password = passVal;
      }

      const btnSave = this.modalEl?.querySelector('#btn-save') as HTMLButtonElement;
      if (btnSave) {
        btnSave.disabled = true;
        btnSave.innerText = t('serverSettings.saving');
      }

      try {
        await networkClient.sendRequest(MessageType.SERVER_UPDATE_SETTINGS, payload);
        this.close();
      } catch (err: any) {
        const banner = document.getElementById('server-settings-banner');
        if (banner) {
          banner.innerText = err.message || t('serverSettings.saveError');
          banner.classList.add('show');
        }
        if (btnSave) {
          btnSave.disabled = false;
          btnSave.innerText = t('serverSettings.save');
        }
      }
    });
  }

  public close(): void {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
      this.shouldRemovePassword = false;
    }
  }
}

export const serverSettingsModal = new ServerSettingsModal();
