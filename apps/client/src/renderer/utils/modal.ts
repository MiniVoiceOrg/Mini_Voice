/**
 * Dismisses a modal when the user clicks directly on its backdrop (outside the
 * card). Uses `mousedown` with an exact-target check — matching Dialog.ts — so
 * a text selection or drag that starts inside the card and releases over the
 * backdrop does not accidentally close the modal (#145).
 */
export function enableBackdropClose(backdropEl: HTMLElement | null, onClose: () => void): void {
  if (!backdropEl) return;
  backdropEl.addEventListener('mousedown', (e) => {
    if (e.target === backdropEl) onClose();
  });
}
