import { serverStore } from '../stores/serverStore';
import { t } from '../i18n';
import { escapeHtml } from '../utils/html';

/**
 * The privacy section shared by the create and edit channel modals (#384).
 *
 * It lives on its own so both dialogs stay in sync: a channel created private
 * and one edited into privacy must offer exactly the same choices, and the Admin
 * role is deliberately absent from the list in both because administrators
 * already reach every channel through ADMINISTRATOR.
 */

export interface ChannelPrivacySelection {
  isPrivate: boolean;
  allowedRoleIds: string[];
}

export function renderChannelPrivacyFields(selection: ChannelPrivacySelection): string {
  const roles = serverStore.getVisibleRoles();
  const selected = new Set(selection.allowedRoleIds);

  const roleList = roles.length
    ? roles
        .map(
          (role) => `
            <label class="channel-role-option">
              <input type="checkbox" class="channel-role-checkbox" value="${escapeHtml(role.id)}" ${
                selected.has(role.id) ? 'checked' : ''
              }>
              <span class="channel-role-dot" style="background: ${escapeHtml(role.color || 'var(--text-muted)')};"></span>
              <span class="channel-role-name">${escapeHtml(role.name)}</span>
            </label>`
        )
        .join('')
    : `<div class="channel-role-empty">${t('channelModal.noRoles')}</div>`;

  return `
    <div class="form-group">
      <label class="channel-privacy-toggle">
        <input type="checkbox" id="input-channel-private" ${selection.isPrivate ? 'checked' : ''}>
        <span class="material-symbols-outlined md-16">lock</span>
        <span>${t('channelModal.privateLabel')}</span>
      </label>
      <div class="channel-privacy-hint">${t('channelModal.privateHint')}</div>
    </div>

    <div class="form-group" id="channel-roles-group" ${selection.isPrivate ? '' : 'hidden'}>
      <label>${t('channelModal.allowedRolesLabel')}</label>
      <div class="channel-role-list">${roleList}</div>
      <div class="channel-privacy-hint">${t('channelModal.allowedRolesHint')}</div>
    </div>
  `;
}

/** Shows or hides the role picker as the privacy checkbox is toggled. */
export function attachChannelPrivacyFields(root: HTMLElement): () => void {
  const toggle = root.querySelector('#input-channel-private') as HTMLInputElement | null;
  const rolesGroup = root.querySelector('#channel-roles-group') as HTMLElement | null;
  if (!toggle || !rolesGroup) return () => {};

  const sync = () => {
    rolesGroup.hidden = !toggle.checked;
  };
  toggle.addEventListener('change', sync);
  sync();

  // Returned so the caller can detach on close and avoid leaking the listener.
  return () => toggle.removeEventListener('change', sync);
}

export function readChannelPrivacyFields(root: HTMLElement): ChannelPrivacySelection {
  const toggle = root.querySelector('#input-channel-private') as HTMLInputElement | null;
  const isPrivate = !!toggle?.checked;
  if (!isPrivate) return { isPrivate: false, allowedRoleIds: [] };

  const checked = Array.from(
    root.querySelectorAll('.channel-role-checkbox:checked')
  ) as HTMLInputElement[];

  return { isPrivate: true, allowedRoleIds: checked.map((input) => input.value) };
}
