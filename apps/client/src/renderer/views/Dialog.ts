import { escapeHtml } from '../utils/html';

type DialogVariant = 'info' | 'warning' | 'danger' | 'success';

interface AlertOptions {
  title?: string;
  message: string;
  okLabel?: string;
  variant?: DialogVariant;
}

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: DialogVariant;
}

const VARIANT_ICON: Record<DialogVariant, { icon: string; color: string }> = {
  info: { icon: 'info', color: 'var(--accent-primary)' },
  warning: { icon: 'warning', color: 'var(--warning)' },
  danger: { icon: 'error', color: 'var(--danger)' },
  success: { icon: 'check_circle', color: 'var(--success)' },
};

function buildDialog(params: {
  title: string;
  message: string;
  variant: DialogVariant;
  showCancel: boolean;
  confirmLabel: string;
  cancelLabel: string;
  confirmClass: string;
  onResolve: (confirmed: boolean) => void;
}): void {
  const { icon, color } = VARIANT_ICON[params.variant];

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card dialog-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
          <span class="material-symbols-outlined" style="color: ${color};">${icon}</span>
          <span>${escapeHtml(params.title)}</span>
        </div>
      </div>
      <div class="dialog-message">${escapeHtml(params.message)}</div>
      <div class="modal-footer">
        ${
          params.showCancel
            ? `<button type="button" class="btn btn-secondary" data-action="cancel">${escapeHtml(params.cancelLabel)}</button>`
            : ''
        }
        <button type="button" class="btn ${params.confirmClass}" data-action="confirm">${escapeHtml(params.confirmLabel)}</button>
      </div>
    </div>
  `;

  let settled = false;
  const settle = (confirmed: boolean): void => {
    if (settled) return;
    settled = true;
    document.removeEventListener('keydown', onKeyDown, true);
    backdrop.remove();
    params.onResolve(confirmed);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      settle(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      settle(true);
    }
  };

  backdrop.querySelector('[data-action="confirm"]')?.addEventListener('click', () => settle(true));
  backdrop.querySelector('[data-action="cancel"]')?.addEventListener('click', () => settle(false));
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) settle(false);
  });
  document.addEventListener('keydown', onKeyDown, true);

  document.body.appendChild(backdrop);
  (backdrop.querySelector('[data-action="confirm"]') as HTMLButtonElement | null)?.focus();
}

/** Replacement for window.alert — resolves when the user dismisses the dialog. */
export function showAlert(options: AlertOptions): Promise<void> {
  return new Promise((resolve) => {
    buildDialog({
      title: options.title ?? 'Aviso',
      message: options.message,
      variant: options.variant ?? 'info',
      showCancel: false,
      confirmLabel: options.okLabel ?? 'OK',
      cancelLabel: '',
      confirmClass: options.variant === 'danger' ? 'btn-danger' : 'btn-primary',
      onResolve: () => resolve(),
    });
  });
}

/** Replacement for window.confirm — resolves true (confirmed) or false (cancelled). */
export function showConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    buildDialog({
      title: options.title ?? 'Confirmação',
      message: options.message,
      variant: options.variant ?? 'warning',
      showCancel: true,
      confirmLabel: options.confirmLabel ?? 'Confirmar',
      cancelLabel: options.cancelLabel ?? 'Cancelar',
      confirmClass: options.variant === 'danger' ? 'btn-danger' : 'btn-primary',
      onResolve: (confirmed) => resolve(confirmed),
    });
  });
}
