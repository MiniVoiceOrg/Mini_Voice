import { escapeHtml } from '../../../utils/html';
import { getAvatarUrl } from '../../../utils/avatar';
import { serverStore } from '../../../stores/serverStore';
import { t } from '../../../i18n';
import { LIMITS } from '@monky/shared';
import logoUrl from '../../../assets/logo.png';

export class ServerGeneralTab {
  /**
   * Registered members, which is what the cap counts (#403).
   *
   * `members` holds one entry per live connection, so it would double-count a
   * person signed in from two devices (#309); `knownMembers` is the persisted
   * list and is only absent when talking to a server that predates it.
   */
  private getMemberCount(): number {
    const s = serverStore.serverDetails;
    if (!s) return 0;
    if (s.knownMembers) return s.knownMembers.length;
    return new Set(s.members.map((m) => m.id)).size;
  }

  public renderHtml(pendingIconBase64?: string | null): string {
    const s = serverStore.serverDetails;
    if (!s) return '';

    const memberCount = this.getMemberCount();
    const hasLimit = (s.maxUsers ?? LIMITS.MAX_USERS_UNLIMITED) > LIMITS.MAX_USERS_UNLIMITED;
    // The field starts from a sensible number even when the limit is off, so
    // turning the switch on never shows an empty or invalid box.
    const limitValue = hasLimit ? s.maxUsers : Math.max(memberCount, LIMITS.MAX_USERS_DEFAULT);

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
            <input id="input-server-name" type="text" value="${escapeHtml(s.name)}" required minlength="2" maxlength="50">
          </div>
        </div>
      </div>

      <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 14px; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
          <div>
            <label for="checkbox-limit-members" style="font-size: 13px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 6px; cursor: pointer; margin-bottom: 2px;">
              <span class="material-symbols-outlined md-18" style="color: var(--accent-primary);">group</span>
              <span>${t('serverSettings.memberLimitLabel')}</span>
            </label>
            <div style="font-size: 11px; color: var(--text-muted);">
              ${t('serverSettings.memberLimitDesc')}
            </div>
          </div>
          <label class="toggle-switch" aria-label="${t('serverSettings.memberLimitLabel')}">
            <input id="checkbox-limit-members" type="checkbox" ${hasLimit ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="form-group" id="max-users-group" style="margin-bottom: 0; margin-top: 12px;" ${hasLimit ? '' : 'hidden'}>
          <label style="margin-bottom: 4px; font-size: 12px;">${t('serverSettings.memberLimitValueLabel')}</label>
          <input id="input-max-users" type="number" min="1" step="1" value="${limitValue}">
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">
            ${t('serverSettings.memberLimitHint', { count: memberCount })}
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
          <div><strong>Membros:</strong> ${memberCount}</div>
          <div style="grid-column: span 2; font-size: 11px; color: var(--text-muted); word-break: break-all;"><strong>ID:</strong> ${s.id}</div>
        </div>
      </div>
    `;
  }

  /**
   * Shows the number box only while the limit is switched on (#403), and hands
   * back a detach function so the modal does not leak the listener on close.
   */
  public attach(root: HTMLElement): () => void {
    const toggle = root.querySelector('#checkbox-limit-members') as HTMLInputElement | null;
    const group = root.querySelector('#max-users-group') as HTMLElement | null;
    if (!toggle || !group) return () => {};

    const sync = () => {
      group.hidden = !toggle.checked;
    };
    toggle.addEventListener('change', sync);
    sync();

    return () => toggle.removeEventListener('change', sync);
  }
}
