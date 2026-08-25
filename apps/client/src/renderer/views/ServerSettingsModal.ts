import { LIMITS, MessageType, ServerUpdateSettingsPayload } from '@mini-voice/shared';
import logoUrl from '../assets/Logo.png';
import { escapeHtml } from '../utils/html';
import { enableBackdropClose } from '../utils/modal';
import { getAvatarUrl } from '../utils/avatar';
import { formatBytes } from '../utils/attachment';
import { networkClient } from '../core/NetworkClient';
import { serverStore } from '../stores/serverStore';
import { t } from '../i18n';
import { settingsStore, ChatSoundMode } from '../stores/settingsStore';

export class ServerSettingsModal {
  private modalEl: HTMLElement | null = null;
  private shouldRemovePassword = false;
  private pendingIconBase64: string | null | undefined = undefined;

  public open(): void {
    this.close();
    this.shouldRemovePassword = false;
    this.pendingIconBase64 = undefined;

    const s = serverStore.serverDetails;
    if (!s) return;

    const hasPass = !!s.hasPassword;

    // Attachment storage usage + configurable limits (#11).
    const storage = s.attachmentStorage;
    const usedBytes = storage?.usedBytes ?? 0;
    const maxTotalBytes = storage?.maxTotalBytes ?? LIMITS.MAX_ATTACHMENT_STORAGE_TOTAL_DEFAULT;
    const maxFileBytes = storage?.maxFileBytes ?? LIMITS.MAX_ATTACHMENT_FILE_SIZE_DEFAULT;
    const usedPct = maxTotalBytes > 0 ? Math.min(100, Math.round((usedBytes / maxTotalBytes) * 100)) : 0;
    const totalMb = Math.round(maxTotalBytes / (1024 * 1024));
    const fileMb = Math.round(maxFileBytes / (1024 * 1024));
    const barColor = usedPct >= 90 ? 'var(--danger)' : usedPct >= 70 ? '#f0b232' : 'var(--accent-primary)';

    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-backdrop';
    this.modalEl.innerHTML = `
      <div class="modal-card" style="max-width: 480px;">
        <div class="modal-header">
          <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
            <span class="material-symbols-outlined" style="color: var(--accent-primary);">settings</span>
            <span>${t('serverSettings.title')}</span>
          </div>
          <button id="modal-close" class="modal-close-btn">&times;</button>
        </div>

        <div id="server-settings-banner" class="error-banner"></div>

        <form id="form-server-settings">
          <div style="display: flex; gap: 16px; align-items: center; padding: 12px; background: var(--bg-tertiary); border-radius: var(--radius-md); margin-bottom: 16px; border: 1px solid var(--border-color);">
            <div id="server-icon-wrapper" class="settings-avatar-wrapper" style="border-radius: 12px; width: 56px; height: 56px; flex-shrink: 0;" title="${t('serverSettings.iconTitle')}">
              <img id="server-icon-preview" class="settings-avatar-img" style="border-radius: 10px; width: 56px; height: 56px; object-fit: cover;" src="${s.iconUrl ? getAvatarUrl(s.iconUrl) : logoUrl}" alt="${t('serverSettings.iconAlt')}">
              <div class="settings-avatar-overlay" style="border-radius: 10px;">
                <span class="material-symbols-outlined md-20">photo_camera</span>
              </div>
            </div>
            <div style="flex: 1; min-width: 0;">
              <div class="form-group" style="margin-bottom: 0;">
                <label style="margin-bottom: 4px;">${t('serverSettings.nameLabel')}</label>
                <input id="input-server-name" type="text" value="${escapeHtml(s.name)}" required minlength="2" maxlength="50">
              </div>
            </div>
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

          <div style="margin-top: 18px; border-top: 1px solid var(--border-color); padding-top: 16px;">
            <label style="font-weight: 700; font-size: 13px; color: var(--text-primary); display: block; margin-bottom: 8px;">
              ${t('serverSettings.storageSection')}
            </label>

            <div style="background: var(--bg-tertiary); padding: 12px 14px; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
              <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">
                <span>${t('serverSettings.storageUsed', { used: formatBytes(usedBytes), total: formatBytes(maxTotalBytes) })}</span>
                <span style="font-weight: 600; color: ${barColor};">${usedPct}%</span>
              </div>
              <div style="height: 8px; background: var(--bg-input); border-radius: 999px; overflow: hidden; margin-bottom: 4px;">
                <div style="height: 100%; width: ${usedPct}%; background: ${barColor}; border-radius: 999px; transition: width 0.3s;"></div>
              </div>
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px;">
                ${t('serverSettings.storageHint')}
              </div>

              <div style="display: flex; gap: 12px;">
                <div class="form-group" style="margin-bottom: 0; flex: 1;">
                  <label style="margin-bottom: 4px; font-size: 12px;">${t('serverSettings.limitPerFile')}</label>
                  <input id="input-attach-file-mb" type="number" min="1" step="1" value="${fileMb}">
                </div>
                <div class="form-group" style="margin-bottom: 0; flex: 1;">
                  <label style="margin-bottom: 4px; font-size: 12px;">${t('serverSettings.limitTotal')}</label>
                  <input id="input-attach-total-mb" type="number" min="1" step="1" value="${totalMb}">
                </div>
              </div>
            </div>
          </div>

          <div style="margin-top: 18px; border-top: 1px solid var(--border-color); padding-top: 16px;">
            <label style="font-weight: 700; font-size: 13px; color: var(--text-primary); display: block; margin-bottom: 8px;">
              ${t('serverSettings.notificationsSection')}
            </label>

            <div style="background: var(--bg-tertiary); padding: 10px 14px; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
              <label for="select-server-chat-sound" style="font-size: 13px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 6px; margin-bottom: 6px; cursor: pointer;">
                <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">notifications</span>
                <span>${t('serverSettings.chatSoundLabel')}</span>
              </label>
              <select id="select-server-chat-sound" style="width: 100%;">
                <option value="inherit">${t('chatSound.inheritGeneral')}</option>
                <option value="all">${t('chatSound.all')}</option>
                <option value="mentions">${t('chatSound.mentions')}</option>
                <option value="none">${t('chatSound.none')}</option>
              </select>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">
                ${t('serverSettings.chatSoundHint')}
              </div>
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
    const serverIconWrapper = this.modalEl.querySelector('#server-icon-wrapper');
    const form = this.modalEl.querySelector('#form-server-settings') as HTMLFormElement;
    const inputName = this.modalEl.querySelector('#input-server-name') as HTMLInputElement;
    const inputPass = this.modalEl.querySelector('#input-server-pass') as HTMLInputElement;
    const checkboxAllowSoundboard = this.modalEl.querySelector('#checkbox-allow-soundboard') as HTMLInputElement | null;
    const passHelpText = this.modalEl.querySelector('#pass-help-text') as HTMLElement | null;
    const statusDesc = this.modalEl.querySelector('#password-status-desc') as HTMLElement | null;

    btnClose?.addEventListener('click', () => this.close());
    enableBackdropClose(this.modalEl, () => this.close());
    btnCancel?.addEventListener('click', () => this.close());

    // Per-server chat-sound preference (#153). Local-only, so it persists on
    // change rather than waiting for the server-side "Salvar Alterações".
    const selectServerChatSound = this.modalEl.querySelector('#select-server-chat-sound') as HTMLSelectElement | null;
    const serverId = serverStore.serverDetails?.id;
    if (selectServerChatSound && serverId) {
      selectServerChatSound.value = settingsStore.getServerChatSoundOverride(serverId);
      selectServerChatSound.addEventListener('change', () => {
        settingsStore.setServerChatSoundOverride(serverId, selectServerChatSound.value as ChatSoundMode);
      });
    }

    serverIconWrapper?.addEventListener('click', async () => {
      const s = serverStore.serverDetails;
      const currentIcon = this.pendingIconBase64 !== undefined
        ? this.pendingIconBase64
        : (s?.iconUrl || null);
      const hasCustomIcon = !!currentIcon;

      const action = await this.showIconActionModal(hasCustomIcon);
      if (action === 'change') {
        const file = await window.api.selectImageDialog();
        if (file && file.base64) {
          this.pendingIconBase64 = file.base64;
          const preview = this.modalEl?.querySelector('#server-icon-preview') as HTMLImageElement | null;
          if (preview) preview.src = file.base64;
        }
      } else if (action === 'remove') {
        this.pendingIconBase64 = null;
        const preview = this.modalEl?.querySelector('#server-icon-preview') as HTMLImageElement | null;
        if (preview) preview.src = logoUrl;
      }
    });

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

      if (this.pendingIconBase64 !== undefined) {
        payload.iconBase64 = this.pendingIconBase64;
      }

      // Attachment storage limits, MB in the UI -> bytes on the wire (#11).
      const inputFileMb = this.modalEl?.querySelector('#input-attach-file-mb') as HTMLInputElement | null;
      const inputTotalMb = this.modalEl?.querySelector('#input-attach-total-mb') as HTMLInputElement | null;
      const fileMbVal = parseFloat(inputFileMb?.value ?? '');
      const totalMbVal = parseFloat(inputTotalMb?.value ?? '');
      if (Number.isFinite(fileMbVal) && fileMbVal > 0) {
        payload.maxAttachmentFileBytes = Math.round(fileMbVal * 1024 * 1024);
      }
      if (Number.isFinite(totalMbVal) && totalMbVal > 0) {
        payload.maxAttachmentStorageBytes = Math.round(totalMbVal * 1024 * 1024);
      }
      if (
        payload.maxAttachmentFileBytes &&
        payload.maxAttachmentStorageBytes &&
        payload.maxAttachmentFileBytes > payload.maxAttachmentStorageBytes
      ) {
        const banner = document.getElementById('server-settings-banner');
        if (banner) {
          banner.innerText = t('serverSettings.limitError');
          banner.classList.add('show');
        }
        return;
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

  private showIconActionModal(hasCustomIcon: boolean): Promise<'change' | 'remove' | null> {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.style.zIndex = '10001';
      backdrop.innerHTML = `
        <div class="modal-card dialog-card" role="dialog" aria-modal="true" style="max-width: 380px;">
          <div class="modal-header">
            <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
              <span class="material-symbols-outlined" style="color: var(--accent-primary);">photo_camera</span>
              <span>${t('serverSettings.photoDialogTitle')}</span>
            </div>
            <button class="modal-close-btn" data-action="cancel">&times;</button>
          </div>
          <div class="dialog-message" style="margin-bottom: 20px; white-space: normal;">${t('serverSettings.photoDialogPrompt')}</div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <button type="button" class="btn btn-primary" data-action="change" style="justify-content: center; gap: 8px; height: 38px;">
              <span class="material-symbols-outlined md-18">upload</span>
              <span>${t('settings.avatarChange')}</span>
            </button>
            ${
              hasCustomIcon
                ? `
            <button type="button" class="btn btn-danger" data-action="remove" style="justify-content: center; gap: 8px; height: 38px;">
              <span class="material-symbols-outlined md-18">delete</span>
              <span>${t('settings.avatarRemove')}</span>
            </button>
            `
                : ''
            }
            <button type="button" class="btn btn-secondary" data-action="cancel" style="justify-content: center; height: 38px;">${t('common.cancel')}</button>
          </div>
        </div>
      `;

      const settle = (result: 'change' | 'remove' | null) => {
        document.removeEventListener('keydown', onKeyDown, true);
        backdrop.remove();
        resolve(result);
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          settle(null);
        }
      };

      backdrop.querySelectorAll('[data-action="change"]').forEach((el) => {
        el.addEventListener('click', () => settle('change'));
      });
      backdrop.querySelectorAll('[data-action="remove"]').forEach((el) => {
        el.addEventListener('click', () => settle('remove'));
      });
      backdrop.querySelectorAll('[data-action="cancel"]').forEach((el) => {
        el.addEventListener('click', () => settle(null));
      });
      backdrop.addEventListener('mousedown', (e) => {
        if (e.target === backdrop) settle(null);
      });
      document.addEventListener('keydown', onKeyDown, true);

      document.body.appendChild(backdrop);
    });
  }

  public close(): void {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
      this.shouldRemovePassword = false;
      this.pendingIconBase64 = undefined;
    }
  }
}

export const serverSettingsModal = new ServerSettingsModal();
