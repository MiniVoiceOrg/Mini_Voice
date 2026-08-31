import { t } from '../i18n';
import { applyBackup, BACKUP_FILE_EXTENSION, BackupScope, collectBackup, parseBackup, scopesInBackup } from '../utils/backup';
import { showAlert, showConfirm } from './Dialog';

/**
 * Standalone backup of saved servers and app settings (#472), separate from the
 * identity export so it can be done at any time and with a different selection.
 */

function buildScopeDialog(params: {
  title: string;
  icon: string;
  intro: string;
  actionLabel: string;
  availableScopes: BackupScope[];
}): Promise<BackupScope[] | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.style.zIndex = '10003';
    backdrop.innerHTML = `
      <div class="modal-card dialog-card" role="dialog" aria-modal="true" style="max-width: 460px; width: min(92vw, 460px);">
        <div class="modal-header">
          <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
            <span class="material-symbols-outlined" style="color: var(--accent-primary);">${params.icon}</span>
            <span>${params.title}</span>
          </div>
          <button class="modal-close-btn" data-action="cancel">&times;</button>
        </div>
        <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.45; margin-bottom: 12px;">
          ${params.intro}
        </div>
        <div style="display: grid; gap: 8px; margin-bottom: 16px; font-size: 13px; color: var(--text-primary);">
          ${params.availableScopes
            .map(
              (scope) => `
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" data-scope="${scope}" checked>
              ${scope === 'servers' ? t('backup.scopeServers') : t('backup.scopeSettings')}
            </label>`
            )
            .join('')}
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button type="button" class="btn btn-secondary" data-action="cancel">${t('common.cancel')}</button>
          <button type="button" class="btn btn-primary" data-action="confirm">${params.actionLabel}</button>
        </div>
      </div>
    `;

    const cleanup = () => {
      document.removeEventListener('keydown', onKeyDown, true);
      backdrop.remove();
    };

    const settle = (scopes: BackupScope[] | null) => {
      cleanup();
      resolve(scopes);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        settle(null);
      }
    };

    backdrop.querySelectorAll('[data-action="cancel"]').forEach((element) => {
      element.addEventListener('click', () => settle(null));
    });

    backdrop.querySelector('[data-action="confirm"]')?.addEventListener('click', () => {
      const selected = Array.from(backdrop.querySelectorAll<HTMLInputElement>('input[data-scope]'))
        .filter((input) => input.checked)
        .map((input) => input.getAttribute('data-scope') as BackupScope);
      if (selected.length === 0) return;
      settle(selected);
    });

    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) settle(null);
    });
    document.addEventListener('keydown', onKeyDown, true);
    document.body.appendChild(backdrop);
  });
}

export async function showBackupExportDialog(): Promise<void> {
  const scopes = await buildScopeDialog({
    title: t('backup.exportTitle'),
    icon: 'download',
    intro: t('backup.exportIntro'),
    actionLabel: t('backup.exportAction'),
    availableScopes: ['servers', 'settings'],
  });
  if (!scopes) return;

  const contents = JSON.stringify(collectBackup(scopes), null, 2);
  const result = await window.api.saveBackupFile(contents, `monky-backup.${BACKUP_FILE_EXTENSION}`);
  if (result.success) {
    await showAlert({ title: t('backup.exportTitle'), message: t('backup.exportSuccess'), variant: 'success' });
  } else if (result.error) {
    await showAlert({ title: t('common.error'), message: result.error, variant: 'danger' });
  }
}

export async function showBackupImportDialog(): Promise<BackupScope[] | null> {
  const file = await window.api.openBackupFile();
  if (!file.success) {
    if (file.error) await showAlert({ title: t('common.error'), message: file.error, variant: 'danger' });
    return null;
  }

  let backup;
  try {
    backup = parseBackup(file.contents || '');
  } catch {
    await showAlert({ title: t('common.error'), message: t('backup.invalidFile'), variant: 'danger' });
    return null;
  }

  const available = scopesInBackup(backup);
  const scopes = await buildScopeDialog({
    title: t('backup.importTitle'),
    icon: 'upload',
    intro: t('backup.importIntro'),
    actionLabel: t('backup.importAction'),
    availableScopes: available,
  });
  if (!scopes) return null;

  // Importing replaces what is already stored, so it is worth one confirmation.
  const confirmed = await showConfirm({
    title: t('backup.importTitle'),
    message: t('backup.importConfirm'),
    confirmLabel: t('backup.importAction'),
    variant: 'warning',
  });
  if (!confirmed) return null;

  const applied = applyBackup(backup, scopes);
  await showAlert({ title: t('backup.importTitle'), message: t('backup.importSuccess'), variant: 'success' });
  return applied;
}
