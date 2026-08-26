import { escapeHtml } from '../../../utils/html';
import { getAvatarUrl } from '../../../utils/avatar';
import { serverStore } from '../../../stores/serverStore';
import { connectionStore } from '../../../stores/connectionStore';
import { getLanguage, setLanguage, SUPPORTED_LANGUAGES, t, SupportedLanguage } from '../../../i18n';
import { pickAndCropImage } from '../../ImageCropModal';
import { showIdentityExportDialog, showIdentityImportDialog } from '../../IdentityDialogs';
import { showAlert } from '../../Dialog';

export class AccountTab {
  public renderHtml(): string {
    return `
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
        ${t('settings.accountIntro')}
      </div>
      <!-- Nickname & Profile -->
      <div style="display: flex; gap: 16px; align-items: center; padding: 14px; background: var(--bg-card); border-radius: var(--radius-md); margin-bottom: 16px; border: 1px solid var(--border-color);">
        <div id="settings-avatar-wrapper" class="settings-avatar-wrapper" title="${t('settings.avatarTitle')}">
          <img id="settings-avatar-preview" class="settings-avatar-img" src="${serverStore.currentUser?.avatarUrl ? getAvatarUrl(serverStore.currentUser.avatarUrl) : (connectionStore.savedAvatarBase64 || getAvatarUrl(null))}" alt="Avatar">
          <div class="settings-avatar-overlay">
            <span class="material-symbols-outlined md-20">photo_camera</span>
          </div>
        </div>
        <div style="flex: 1;">
          <div class="form-group" style="margin-bottom: 0;">
            <label>${t('connection.nicknameLabel')}</label>
            <div style="display: flex; gap: 8px; margin-top: 6px;">
              <input id="settings-nickname-input" type="text" value="${serverStore.currentUser?.nickname || connectionStore.savedNickname || ''}" style="flex: 1;" maxlength="32">
              <button id="btn-save-nickname" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;">${t('common.save')}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Language (#16) -->
      <div class="form-group" style="border-top: 1px solid var(--border-color); padding-top: 14px; margin-top: 14px;">
        <label style="display: flex; align-items: center; gap: 6px;" for="select-language">
          <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">language</span>
          ${t('settings.languageSection')}
        </label>
        <select id="select-language">
          ${SUPPORTED_LANGUAGES.map(
            (lang) =>
              `<option value="${lang.code}" ${lang.code === getLanguage() ? 'selected' : ''}>${lang.label}</option>`
          ).join('')}
        </select>
        <small style="display: block; margin-top: 6px; color: var(--text-muted); font-size: 11px;">
          ${t('settings.languageHint')}
        </small>
      </div>

      <div class="form-group" style="border-top: 1px solid var(--border-color); padding-top: 14px; margin-top: 14px;">
        <label style="display: flex; align-items: center; gap: 6px;">
          <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">manage_accounts</span>
          ${t('identity.sectionTitle')}
        </label>
        <div style="padding: 12px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
          <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.45; margin-bottom: 10px;">
            ${connectionStore.hasIdentity ? t('identity.sectionReady') : t('identity.sectionMissing')}
          </div>
          <div style="display: grid; gap: 6px; margin-bottom: 12px;">
            <div style="font-size: 11px; color: var(--text-muted);">
              ${t('identity.clientIdLabel')}
              <div style="font-family: var(--font-mono); color: var(--text-primary); word-break: break-all;">${escapeHtml(connectionStore.clientId || '—')}</div>
            </div>
            <div style="font-size: 11px; color: var(--text-muted);">
              ${t('identity.publicKeyLabel')}
              <div style="font-family: var(--font-mono); color: var(--text-primary); word-break: break-all;">${escapeHtml(connectionStore.publicKey || '—')}</div>
            </div>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button type="button" id="btn-export-identity" class="btn btn-secondary" ${connectionStore.hasIdentity ? '' : 'disabled'}>
              <span class="material-symbols-outlined md-16" style="margin-right: 4px;">qr_code_2</span>
              ${t('identity.exportAction')}
            </button>
            <button type="button" id="btn-import-identity-settings" class="btn btn-secondary">
              <span class="material-symbols-outlined md-16" style="margin-right: 4px;">qr_code_scanner</span>
              ${t('identity.importAction')}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  public attachEvents(
    container: HTMLElement,
    callbacks: {
      onSaveNickname: (name: string) => Promise<void>;
      onAvatarChanged: (base64: string) => Promise<void>;
      onReloadModal: () => void;
      showError: (msg: string) => void;
    }
  ): void {
    const inputNickname = container.querySelector<HTMLInputElement>('#settings-nickname-input');
    const btnSaveNickname = container.querySelector<HTMLButtonElement>('#btn-save-nickname');
    const selectLanguage = container.querySelector<HTMLSelectElement>('#select-language');
    const avatarWrapper = container.querySelector<HTMLElement>('#settings-avatar-wrapper');
    const btnExportIdentity = container.querySelector<HTMLButtonElement>('#btn-export-identity');
    const btnImportIdentity = container.querySelector<HTMLButtonElement>('#btn-import-identity-settings');

    btnSaveNickname?.addEventListener('click', async () => {
      const nextNick = inputNickname?.value.trim();
      if (!nextNick) {
        callbacks.showError(t('protocolError.nicknameInvalid'));
        return;
      }
      await callbacks.onSaveNickname(nextNick);
    });

    avatarWrapper?.addEventListener('click', async () => {
      const croppedBase64 = await pickAndCropImage();
      if (croppedBase64) {
        await callbacks.onAvatarChanged(croppedBase64);
        const preview = container.querySelector<HTMLImageElement>('#settings-avatar-preview');
        if (preview) preview.src = croppedBase64;
      }
    });

    selectLanguage?.addEventListener('change', async () => {
      const newLang = selectLanguage.value as SupportedLanguage;
      setLanguage(newLang);
      if (window.api?.setLanguage) {
        await window.api.setLanguage(newLang);
      }
      callbacks.onReloadModal();
    });

    btnExportIdentity?.addEventListener('click', async () => {
      await showIdentityExportDialog(connectionStore.clientId || '');
    });

    btnImportIdentity?.addEventListener('click', async () => {
      const imported = await showIdentityImportDialog();
      if (imported) {
        connectionStore.clientId = imported.clientId;
        connectionStore.publicKey = imported.publicKey;
        connectionStore.hasIdentity = true;
        showAlert({ title: t('identity.importTitle'), message: t('identity.importSuccess') });
        callbacks.onReloadModal();
      }
    });
  }
}
