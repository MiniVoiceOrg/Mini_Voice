/**
 * Shared helpers to give visual feedback on buttons while an async action runs
 * (#48). The loading state is driven purely by the `data-loading` attribute and
 * the `disabled` attribute, so it survives other handlers that rewrite the
 * button's innerHTML or className (e.g. icon/state updates). The spinner itself
 * is drawn via CSS (`button[data-loading="1"]::after`).
 */

export function setButtonLoading(btn: HTMLElement | null, loading: boolean): void {
  if (!btn) return;
  const el = btn as HTMLButtonElement;

  if (loading) {
    el.dataset.loading = '1';
    el.setAttribute('disabled', 'true');
  } else {
    delete el.dataset.loading;
    el.removeAttribute('disabled');
  }
}

export function isButtonLoading(btn: HTMLElement | null): boolean {
  return !!btn && (btn as HTMLButtonElement).dataset.loading === '1';
}
