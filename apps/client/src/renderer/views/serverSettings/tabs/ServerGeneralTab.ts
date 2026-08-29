import { escapeHtml } from '../../../utils/html';
import { getAvatarUrl } from '../../../utils/avatar';
import { serverStore } from '../../../stores/serverStore';
import { t } from '../../../i18n';
import logoUrl from '../../../assets/logo.png';

export class ServerGeneralTab {
  public renderHtml(pendingIconBase64?: string | null): string {
    const s = serverStore.serverDetails;
    if (!s) return '';

    const iconSrc = pendingIconBase64 !== undefined
      ? (pendingIconBase64 ? getAvatarUrl(pendingIconBase64) : logoUrl)
      : (s.iconUrl ? getAvatarUrl(s.iconUrl) : logoUrl);

    return `
      <div style="display: flex; gap: 16px; align-items: center; padding: 14px; background: var(--bg-card); border-radius: var(--radius-md); margin-bottom: 16px; border: 1px solid var(--border-color);">
        <div id="server-icon-wrapper" class="settings-avatar-wrapper" style="border-radius: 12px; width: 64px; height: 64px; flex-shrink: 0;" title="${t('serverSettings.iconTitle')}">
          <img id="server-icon-preview" class="settings-avatar-img" style="border-radius: 10px; width: 64px; height: 64px; object-fit: cover;" src="${iconSrc}" alt="${t('serverSettings.iconAlt')}">
          <div class="settings-avatar-overlay" style="border-radius: 10px;">
            <span class="material-symbols-outlined md-20">photo_camera</span>
          </div>
        </div>
        <div style="flex: 1; min-width: 0;">
          <div class="form-group" style="margin-bottom: 0;">
            <label style="margin-bottom: 4px;">${t('serverSettings.nameLabel')}</label>
            <div class="input-with-emoji-container">
              <input id="input-server-name" type="text" value="${escapeHtml(s.name)}" required minlength="2" maxlength="50" style="padding-right: 36px;">
              <button type="button" id="btn-emoji-server-name" class="btn-input-emoji" title="${t('chat.emojiPickerTitle')}">
                <span class="material-symbols-outlined md-18">mood</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 14px;">
        <div style="font-size: 13px; font-weight: 700; color: var(--text-primary); margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
          <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">info</span>
          <span>${t('serverSettings.generalInfo')}</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; font-size: 12px; color: var(--text-secondary);">
          <div><strong>Canais:</strong> ${s.channels.length}</div>
          <div><strong>Membros:</strong> ${s.members.length}</div>
          <div style="grid-column: span 2; font-size: 11px; color: var(--text-muted); word-break: break-all;"><strong>ID:</strong> ${s.id}</div>
        </div>
      </div>
    `;
  }
}
