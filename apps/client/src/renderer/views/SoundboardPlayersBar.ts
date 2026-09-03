import { appEvents } from '../core/EventBus';
import { soundboardService } from '../core/SoundboardService';
import { t } from '../i18n';
import { escapeHtml } from '../utils/html';

interface PlaybackProgressPayload {
  userId?: string;
  percent?: number;
}

/** Matches the `.sb-notice-bar.is-leaving` animation in theme.css. */
const EXIT_ANIMATION_MS = 160;

/**
 * Soundboard playback bars living in the sidebar, right where the screen-share
 * notice appears (#517). They used to be inside the soundboard modal, which
 * meant the only way to see what was playing — or to stop it — was to keep that
 * modal open. Bars queue up, one per person playing, and animate in and out.
 */
export class SoundboardPlayersBar {
  private slot: HTMLElement | null = null;
  private unbindEvents: Array<() => void> = [];
  private readonly leaving = new Set<string>();

  public mount(slot: HTMLElement): void {
    this.unmount();
    this.slot = slot;
    slot.addEventListener('click', this.handleClick);
    this.sync();

    const onStarted = () => this.sync();
    const onProgress = (payload: PlaybackProgressPayload) => this.updateProgress(payload);
    const onEnded = () => this.sync();

    appEvents.on('soundboard.playback_started', onStarted);
    appEvents.on('soundboard.playback_progress', onProgress);
    appEvents.on('soundboard.playback_ended', onEnded);

    this.unbindEvents.push(() => {
      appEvents.off('soundboard.playback_started', onStarted);
      appEvents.off('soundboard.playback_progress', onProgress);
      appEvents.off('soundboard.playback_ended', onEnded);
    });
  }

  public unmount(): void {
    this.slot?.removeEventListener('click', this.handleClick);
    this.unbindEvents.forEach((unbind) => unbind());
    this.unbindEvents = [];
    this.leaving.clear();
    this.slot = null;
  }

  private handleClick = (event: Event): void => {
    const button = (event.target as HTMLElement | null)?.closest('.sb-notice-stop-btn');
    const userId = button?.closest('.sb-notice-bar')?.getAttribute('data-userid');
    if (userId) soundboardService.stopSoundFromUi(userId);
  };

  /**
   * Reconciles the bars with what is actually playing instead of repainting the
   * slot: a full repaint would restart the entrance animation of every bar
   * whenever anyone else started a sound.
   */
  private sync(): void {
    if (!this.slot) return;

    const playbacks = soundboardService.getActivePlaybacks();
    const activeIds = new Set(playbacks.map((p) => p.userId));

    for (const bar of Array.from(this.slot.children) as HTMLElement[]) {
      const userId = bar.getAttribute('data-userid') || '';
      if (!activeIds.has(userId)) this.removeBar(bar, userId);
    }

    for (const playback of playbacks) {
      this.leaving.delete(playback.userId);
      const existing = this.slot.querySelector(`[data-userid="${CSS.escape(playback.userId)}"]`);
      if (existing) continue;

      const bar = document.createElement('div');
      bar.className = 'sb-notice-bar';
      bar.setAttribute('data-userid', playback.userId);
      bar.innerHTML = this.renderBarInnerHtml(playback.soundName, playback.userName);
      this.slot.appendChild(bar);
    }
  }

  private removeBar(bar: HTMLElement, userId: string): void {
    if (this.leaving.has(userId)) return;
    this.leaving.add(userId);
    bar.classList.add('is-leaving');
    window.setTimeout(() => {
      this.leaving.delete(userId);
      bar.remove();
    }, EXIT_ANIMATION_MS);
  }

  private updateProgress(payload: PlaybackProgressPayload): void {
    if (!this.slot || !payload?.userId) return;
    const bar = this.slot.querySelector(`[data-userid="${CSS.escape(payload.userId)}"]`);
    const fill = bar?.querySelector('.sb-notice-progress-fill') as HTMLElement | null;
    if (fill) fill.style.width = `${Math.min(100, Math.max(0, payload.percent || 0))}%`;
  }

  private renderBarInnerHtml(soundName: string, userName?: string): string {
    const label = userName ? `${soundName} · ${userName}` : soundName;
    return `
      <span class="material-symbols-outlined md-16 sb-notice-icon">volume_up</span>
      <div class="sb-notice-body">
        <span class="sb-notice-text" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
        <div class="sb-notice-progress-track">
          <div class="sb-notice-progress-fill"></div>
        </div>
      </div>
      <button type="button" class="sb-notice-stop-btn" title="${t('soundboard.stopPlayback')}" aria-label="${t('soundboard.stopPlayback')}">
        <span class="material-symbols-outlined md-16">stop</span>
      </button>
    `;
  }
}

export const soundboardPlayersBar = new SoundboardPlayersBar();
