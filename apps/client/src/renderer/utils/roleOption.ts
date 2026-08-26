import type { Role } from '@monky/shared';
import { escapeHtml } from './html';

/**
 * Shared markup for a role pick option: a dot with the role color, the role
 * name and a styled checkbox, used by every place where roles are assigned to
 * a member (#275).
 */
export function renderRoleOption(role: Role, assigned: boolean): string {
  const dotStyle = role.color ? ` style="--role-color: ${escapeHtml(role.color)};"` : '';
  return `
    <span class="role-option">
      <span class="role-option-dot"${dotStyle}></span>
      <span class="role-option-name">${escapeHtml(role.name)}</span>
      <span class="role-option-check${assigned ? ' checked' : ''}">
        <span class="material-symbols-outlined">check</span>
      </span>
    </span>
  `;
}
