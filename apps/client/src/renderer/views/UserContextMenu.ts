import { UserSummary } from '@monky/shared';
import { escapeHtml } from '../utils/html';
import { getAvatarUrl } from '../utils/avatar';
import { settingsStore } from '../stores/settingsStore';
import { serverStore } from '../stores/serverStore';
import { connectionStore } from '../stores/connectionStore';
import { webRtcManager } from '../core/WebRtcManager';
import { appEvents } from '../core/EventBus';

export class UserContextMenu {
  private menuEl: HTMLElement | null = null;
  private unbindGlobalListeners: Array<() => void> = [];

  constructor() {
    // Dismiss on network disconnect or server changes
    appEvents.on('network.disconnected', () => this.close());
    appEvents.on('voice.channel_changed', () => this.close());
  }

  public open(x: number, y: number, user: UserSummary): void {
    // Do not open for self
    if (
      user.id === serverStore.currentUser?.id ||
      user.clientId === connectionStore.clientId ||
      user.clientId === serverStore.currentUser?.clientId
    ) {
      return;
    }

    this.close();

    const currentVol = settingsStore.getUserVolume(user.clientId);
    const avatarSrc = getAvatarUrl(user.avatarUrl);

    this.menuEl = document.createElement('div');
    this.menuEl.className = 'user-context-menu';
    this.menuEl.innerHTML = `
      <div class="context-menu-header">
        <img class="context-menu-avatar" src="${avatarSrc}" alt="">
        <div class="context-menu-user-info">
          <span class="context-menu-nickname">${escapeHtml(user.nickname)}</span>
          <span class="context-menu-subtext">Configurações de Áudio</span>
        </div>
      </div>

      <div class="context-menu-divider"></div>

      <div class="context-menu-volume-section">
        <div class="context-menu-volume-header">
          <div class="context-menu-volume-title">
            <span id="ctx-volume-icon" class="material-symbols-outlined md-18" style="color: var(--accent-primary);">
              ${this.getVolumeIcon(currentVol)}
            </span>
            <span>Volume de Voz</span>
          </div>
          <span id="ctx-volume-badge" class="context-menu-volume-badge">${currentVol}%</span>
        </div>

        <div class="context-menu-slider-container">
          <input
            id="ctx-volume-slider"
            class="user-volume-slider"
            type="range"
            min="0"
            max="100"
            value="${currentVol}"
            step="1"
          >
        </div>

        <div class="context-menu-quick-btns">
          <button id="ctx-vol-0" class="btn-ctx-quick" title="Mutar áudio deste usuário">0% (Mudo)</button>
          <button id="ctx-vol-50" class="btn-ctx-quick" title="Definir volume em 50%">50%</button>
          <button id="ctx-vol-100" class="btn-ctx-quick active" title="Restaurar volume padrão (100%)">100%</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.menuEl);

    // Update initial slider background gradient fill
    this.updateSliderTrackFill(currentVol);
    this.updateActiveQuickButton(currentVol);

    // Calculate smart positioning within window boundaries
    const rect = this.menuEl.getBoundingClientRect();
    let posX = x;
    let posY = y;

    if (posX + rect.width > window.innerWidth - 12) {
      posX = window.innerWidth - rect.width - 12;
    }
    if (posY + rect.height > window.innerHeight - 12) {
      posY = window.innerHeight - rect.height - 12;
    }
    if (posX < 12) posX = 12;
    if (posY < 12) posY = 12;

    this.menuEl.style.left = `${posX}px`;
    this.menuEl.style.top = `${posY}px`;

    this.attachEvents(user);
  }

  private getVolumeIcon(volume: number): string {
    if (volume === 0) return 'volume_off';
    if (volume <= 50) return 'volume_down';
    return 'volume_up';
  }

  private updateSliderTrackFill(volume: number): void {
    const slider = this.menuEl?.querySelector('#ctx-volume-slider') as HTMLInputElement;
    if (slider) {
      const percentage = Math.max(0, Math.min(100, volume));
      slider.style.setProperty('--slider-fill', `${percentage}%`);
    }
  }

  private updateActiveQuickButton(volume: number): void {
    if (!this.menuEl) return;
    const btns = this.menuEl.querySelectorAll('.btn-ctx-quick');
    btns.forEach((b) => b.classList.remove('active'));

    if (volume === 0) {
      this.menuEl.querySelector('#ctx-vol-0')?.classList.add('active');
    } else if (volume === 50) {
      this.menuEl.querySelector('#ctx-vol-50')?.classList.add('active');
    } else if (volume === 100) {
      this.menuEl.querySelector('#ctx-vol-100')?.classList.add('active');
    }
  }

  private applyVolume(user: UserSummary, volume: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(volume)));
    const badge = this.menuEl?.querySelector('#ctx-volume-badge');
    const icon = this.menuEl?.querySelector('#ctx-volume-icon');
    const slider = this.menuEl?.querySelector('#ctx-volume-slider') as HTMLInputElement;

    if (badge) badge.textContent = `${clamped}%`;
    if (icon) icon.textContent = this.getVolumeIcon(clamped);
    if (slider && parseInt(slider.value, 10) !== clamped) {
      slider.value = clamped.toString();
    }

    this.updateSliderTrackFill(clamped);
    this.updateActiveQuickButton(clamped);

    settingsStore.setUserVolume(user.clientId, clamped);
    webRtcManager.setPeerVolumeByClientId(user.clientId, clamped);
  }

  private attachEvents(user: UserSummary): void {
    if (!this.menuEl) return;

    const slider = this.menuEl.querySelector('#ctx-volume-slider') as HTMLInputElement;
    const btn0 = this.menuEl.querySelector('#ctx-vol-0');
    const btn50 = this.menuEl.querySelector('#ctx-vol-50');
    const btn100 = this.menuEl.querySelector('#ctx-vol-100');

    slider?.addEventListener('input', () => {
      const val = parseInt(slider.value, 10);
      this.applyVolume(user, val);
    });

    btn0?.addEventListener('click', () => {
      this.applyVolume(user, 0);
    });

    btn50?.addEventListener('click', () => {
      this.applyVolume(user, 50);
    });

    btn100?.addEventListener('click', () => {
      this.applyVolume(user, 100);
    });

    // Dismiss listeners
    const handleOutsideClick = (e: MouseEvent | PointerEvent) => {
      if (this.menuEl && !this.menuEl.contains(e.target as Node)) {
        this.close();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
      }
    };

    const handleWindowResize = () => {
      this.close();
    };

    // Use setTimeout to avoid immediate trigger from the opening right click
    setTimeout(() => {
      document.addEventListener('pointerdown', handleOutsideClick, true);
      document.addEventListener('contextmenu', handleOutsideClick, true);
      window.addEventListener('keydown', handleKeyDown, true);
      window.addEventListener('resize', handleWindowResize);
    }, 10);

    this.unbindGlobalListeners.push(() => {
      document.removeEventListener('pointerdown', handleOutsideClick, true);
      document.removeEventListener('contextmenu', handleOutsideClick, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', handleWindowResize);
    });
  }

  public close(): void {
    this.unbindGlobalListeners.forEach((u) => u());
    this.unbindGlobalListeners = [];

    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;
    }
  }
}

export const userContextMenu = new UserContextMenu();
