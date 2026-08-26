import { t } from '../i18n';

/** Side of the square crop preview, in CSS pixels. */
const VIEWPORT_PX = 320;
/** Side of the exported image, in pixels. */
const OUTPUT_PX = 512;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;

interface CropState {
  zoom: number;
  x: number;
  y: number;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load the selected image.'));
    image.src = dataUrl;
  });
}

/**
 * Square crop dialog with zoom and drag, used before an image becomes a profile
 * or server picture. Resolves with a `${OUTPUT_PX}x${OUTPUT_PX}` PNG data URL,
 * or `null` when the user cancels (#255).
 */
export async function openImageCropper(dataUrl: string): Promise<string | null> {
  let image: HTMLImageElement;
  try {
    image = await loadImage(dataUrl);
  } catch {
    return dataUrl;
  }

  return new Promise((resolve) => {
    // Scale at which the image just covers the square, so there are never gaps.
    const baseScale = Math.max(
      VIEWPORT_PX / image.naturalWidth,
      VIEWPORT_PX / image.naturalHeight
    );
    const state: CropState = { zoom: 1, x: 0, y: 0 };

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-card crop-modal-card" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div class="modal-title">${t('crop.title')}</div>
        </div>
        <div class="crop-hint">${t('crop.hint')}</div>
        <div class="crop-viewport" style="width: ${VIEWPORT_PX}px; height: ${VIEWPORT_PX}px;">
          <img class="crop-image" alt="" draggable="false">
          <div class="crop-mask"></div>
        </div>
        <div class="crop-zoom-row">
          <span class="material-symbols-outlined md-18">zoom_out</span>
          <input class="crop-zoom-slider" type="range" min="1" max="${MAX_ZOOM}" step="0.01" value="1">
          <span class="material-symbols-outlined md-18">zoom_in</span>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-action="cancel">${t('common.cancel')}</button>
          <button type="button" class="btn btn-primary" data-action="confirm">${t('crop.confirm')}</button>
        </div>
      </div>
    `;

    const imageEl = backdrop.querySelector('.crop-image') as HTMLImageElement;
    const viewport = backdrop.querySelector('.crop-viewport') as HTMLElement;
    const slider = backdrop.querySelector('.crop-zoom-slider') as HTMLInputElement;
    imageEl.src = dataUrl;

    const displayedWidth = () => image.naturalWidth * baseScale * state.zoom;
    const displayedHeight = () => image.naturalHeight * baseScale * state.zoom;

    const clamp = () => {
      const minX = VIEWPORT_PX - displayedWidth();
      const minY = VIEWPORT_PX - displayedHeight();
      state.x = Math.min(0, Math.max(minX, state.x));
      state.y = Math.min(0, Math.max(minY, state.y));
    };

    const apply = () => {
      clamp();
      imageEl.style.width = `${displayedWidth()}px`;
      imageEl.style.height = `${displayedHeight()}px`;
      imageEl.style.transform = `translate(${state.x}px, ${state.y}px)`;
    };

    const setZoom = (nextZoom: number, anchorX: number, anchorY: number) => {
      const previous = state.zoom;
      const zoom = Math.min(MAX_ZOOM, Math.max(1, nextZoom));
      if (zoom === previous) return;
      // Keep whatever sits under the anchor point in place while zooming.
      state.x = anchorX - ((anchorX - state.x) / previous) * zoom;
      state.y = anchorY - ((anchorY - state.y) / previous) * zoom;
      state.zoom = zoom;
      slider.value = String(zoom);
      apply();
    };

    // Start centered on the image.
    state.x = (VIEWPORT_PX - displayedWidth()) / 2;
    state.y = (VIEWPORT_PX - displayedHeight()) / 2;
    apply();

    let settled = false;
    const settle = (result: string | null) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeyDown, true);
      backdrop.remove();
      resolve(result);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        // Otherwise the modal that opened the cropper would close as well.
        e.stopPropagation();
        settle(null);
      }
    };

    const exportCrop = () => {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_PX;
      canvas.height = OUTPUT_PX;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        settle(dataUrl);
        return;
      }
      const scale = baseScale * state.zoom;
      const sourceSize = VIEWPORT_PX / scale;
      ctx.drawImage(
        image,
        -state.x / scale,
        -state.y / scale,
        sourceSize,
        sourceSize,
        0,
        0,
        OUTPUT_PX,
        OUTPUT_PX
      );
      settle(canvas.toDataURL('image/png'));
    };

    slider.addEventListener('input', () => {
      setZoom(Number(slider.value), VIEWPORT_PX / 2, VIEWPORT_PX / 2);
    });

    viewport.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      setZoom(
        state.zoom - Math.sign(e.deltaY) * ZOOM_STEP,
        e.clientX - rect.left,
        e.clientY - rect.top
      );
    }, { passive: false });

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;

    viewport.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      originX = state.x;
      originY = state.y;
      viewport.classList.add('is-dragging');
      viewport.setPointerCapture(e.pointerId);
    });

    viewport.addEventListener('pointermove', (e: PointerEvent) => {
      if (!dragging) return;
      state.x = originX + (e.clientX - startX);
      state.y = originY + (e.clientY - startY);
      apply();
    });

    const endDrag = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      viewport.classList.remove('is-dragging');
      if (viewport.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId);
    };
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);

    viewport.addEventListener('dblclick', () => {
      state.zoom = 1;
      slider.value = '1';
      state.x = (VIEWPORT_PX - displayedWidth()) / 2;
      state.y = (VIEWPORT_PX - displayedHeight()) / 2;
      apply();
    });

    backdrop.querySelector('[data-action="cancel"]')?.addEventListener('click', () => settle(null));
    backdrop.querySelector('[data-action="confirm"]')?.addEventListener('click', exportCrop);
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) settle(null);
    });
    document.addEventListener('keydown', onKeyDown, true);

    document.body.appendChild(backdrop);
  });
}

/**
 * Opens the image picker and lets the user frame the result before it is used
 * as a picture. Returns `null` when the picker or the crop is cancelled (#255).
 */
export async function pickAndCropImage(): Promise<string | null> {
  if (!window.api?.selectImageDialog) return null;
  const file = await window.api.selectImageDialog();
  if (!file?.base64) return null;
  return openImageCropper(file.base64);
}
