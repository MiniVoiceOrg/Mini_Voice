import { escapeHtml } from '../utils/html';
import { soundboardService, SoundItem } from '../core/SoundboardService';
import { settingsStore } from '../stores/settingsStore';
import { serverStore } from '../stores/serverStore';
import { voiceStore } from '../stores/voiceStore';
import { appEvents } from '../core/EventBus';
import { t, tCount } from '../i18n';

export class SoundboardModal {
  private modalEl: HTMLElement | null = null;
  private unbindEvents: Array<() => void> = [];

  public async open(): Promise<void> {
    this.close();

    // Ensure sounds are loaded
    await soundboardService.loadSounds();
    const sounds = soundboardService.getSounds();
    const serverAllows = serverStore.serverDetails?.allowSoundboard !== false;

    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-backdrop';
    this.modalEl.innerHTML = `
      <div class="modal-card" style="max-width: 600px; max-height: 85vh; display: flex; flex-direction: column; padding: 0; overflow: hidden;">
        
        <!-- Header -->
        <div class="modal-header" style="padding: 16px 20px 12px; border-bottom: 1px solid var(--border-color);">
          <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
            <span class="material-symbols-outlined" style="color: var(--accent-primary);">music_note</span>
            <span>Soundboard</span>
            <span id="sb-sound-count" style="font-size: 11px; background: var(--bg-tertiary); padding: 2px 8px; border-radius: 12px; color: var(--text-muted); font-weight: 500;">
              ${tCount('soundboard.soundCount', sounds.length)}
            </span>
          </div>
          <button id="modal-close" class="modal-close-btn">&times;</button>
        </div>

        <!-- Quick Volume & Mute Toolbar -->
        <div style="padding: 10px 20px; background: var(--bg-secondary); border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between; gap: 16px;">
          <!-- Folder select & Change -->
          <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
            <button id="sb-btn-change-folder" class="btn btn-secondary" style="font-size: 11px; padding: 4px 10px; height: 28px; white-space: nowrap;">
              <span class="material-symbols-outlined md-14" style="margin-right: 4px;">folder_open</span>
              ${settingsStore.soundboardFolderPath ? t('soundboard.changeFolder') : t('soundboard.chooseFolder')}
            </button>
            <span id="sb-folder-path-label" style="font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${settingsStore.soundboardFolderPath || ''}">
              ${settingsStore.soundboardFolderPath ? escapeHtml(settingsStore.soundboardFolderPath) : t('soundboard.noFolderSelected')}
            </span>
          </div>

          <!-- Volume & Mute Controls -->
          <div style="display: flex; align-items: center; gap: 12px;">
            <button id="sb-btn-mute" class="btn btn-icon ${settingsStore.soundboardMuted ? 'danger-active' : ''}" style="width: 28px; height: 28px; padding: 0;" title="${settingsStore.soundboardMuted ? t('soundboard.unmuteTitle') : t('soundboard.muteTitle')}">
              <span class="material-symbols-outlined md-16">${settingsStore.soundboardMuted ? 'volume_off' : 'volume_up'}</span>
            </button>
            
            <div style="display: flex; align-items: center; gap: 6px;">
              <input id="sb-slider-volume" type="range" min="0" max="100" value="${settingsStore.soundboardVolume}" style="width: 80px; height: 4px;">
              <span id="sb-volume-label" style="font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); min-width: 28px;">${settingsStore.soundboardVolume}%</span>
            </div>
          </div>
        </div>

        <!-- Server disabled alert banner -->
        ${!serverAllows ? `
          <div style="margin: 12px 20px 0; padding: 8px 12px; background: rgba(237, 66, 69, 0.15); border: 1px solid rgba(237, 66, 69, 0.3); border-radius: var(--radius-md); color: var(--danger); font-size: 12px; display: flex; align-items: center; gap: 8px;">
            <span class="material-symbols-outlined md-16">block</span>
            <span>${t('soundboard.disabledByAdmin')}</span>
          </div>
        ` : ''}

        <!-- Voice channel warning if not in call -->
        ${!voiceStore.currentVoiceChannelId ? `
          <div style="margin: 12px 20px 0; padding: 8px 12px; background: rgba(240, 178, 50, 0.15); border: 1px solid rgba(240, 178, 50, 0.3); border-radius: var(--radius-md); color: #f0b232; font-size: 12px; display: flex; align-items: center; gap: 8px;">
            <span class="material-symbols-outlined md-16">info</span>
            <span>${t('soundboard.localPreviewOnly')}</span>
          </div>
        ` : ''}

        <!-- Sounds Grid Area -->
        <div id="sb-sounds-container" style="flex: 1; overflow-y: auto; padding: 16px 20px; min-height: 220px;">
          ${this.renderSoundsGrid(sounds)}
        </div>

        <!-- Footer -->
        <div class="modal-footer" style="padding: 12px 20px; border-top: 1px solid var(--border-color); background: var(--bg-card);">
          <div style="font-size: 11px; color: var(--text-muted); flex: 1;">
            ${t('soundboard.footerHint')}
          </div>
          <button type="button" id="sb-btn-close" class="btn btn-secondary" style="padding: 6px 16px; font-size: 12px;">${t('common.close')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.modalEl);
    this.attachEvents();

    const onSoundPlayed = (payload: any) => {
      this.highlightPlayedSound(payload.soundName);
    };
    appEvents.on('soundboard.played', onSoundPlayed);
    this.unbindEvents.push(() => appEvents.off('soundboard.played', onSoundPlayed));
  }

  private renderSoundsGrid(sounds: SoundItem[]): string {
    if (!settingsStore.soundboardFolderPath) {
      return `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 180px; text-align: center; color: var(--text-muted); gap: 12px;">
          <span class="material-symbols-outlined" style="font-size: 48px; color: var(--text-dim);">folder_special</span>
          <div>
            <div style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">${t('soundboard.emptyFolderTitle')}</div>
            <div style="font-size: 12px; max-width: 320px;">${t('soundboard.emptyFolderDesc')}</div>
          </div>
          <button type="button" id="sb-btn-select-folder-empty" class="btn btn-primary" style="font-size: 12px; padding: 8px 18px; margin-top: 6px;">
            <span class="material-symbols-outlined md-16" style="margin-right: 6px;">folder_open</span>
            ${t('soundboard.chooseFolderButton')}
          </button>
        </div>
      `;
    }

    if (sounds.length === 0) {
      return `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 180px; text-align: center; color: var(--text-muted); gap: 12px;">
          <span class="material-symbols-outlined" style="font-size: 48px; color: var(--text-dim);">audio_file</span>
          <div>
            <div style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">${t('soundboard.noAudioFilesTitle')}</div>
            <div style="font-size: 12px; max-width: 320px;">${t('soundboard.noAudioFilesDesc')}</div>
          </div>
          <button type="button" id="sb-btn-select-folder-empty" class="btn btn-secondary" style="font-size: 12px; padding: 6px 14px;">
            <span class="material-symbols-outlined md-16" style="margin-right: 6px;">folder_open</span>
            ${t('soundboard.changeFolderButton')}
          </button>
        </div>
      `;
    }

    return `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px;">
        ${sounds
          .map(
            (s) => `
          <button type="button" class="sb-sound-btn" data-filepath="${escapeHtml(s.filePath)}" data-soundname="${escapeHtml(s.name)}" title="${escapeHtml(s.name)} (${(s.sizeBytes / 1024).toFixed(0)} KB)" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 14px 8px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); color: var(--text-primary); cursor: pointer; transition: all 0.15s ease; text-align: center; outline: none;">
            <span class="material-symbols-outlined" style="color: var(--accent-primary); font-size: 26px;">play_circle</span>
            <span style="font-size: 12px; font-weight: 600; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; width: 100%; word-break: break-word;">
              ${escapeHtml(s.name)}
            </span>
          </button>
        `
          )
          .join('')}
      </div>
    `;
  }

  private attachEvents(): void {
    if (!this.modalEl) return;

    const btnClose = this.modalEl.querySelector('#modal-close');
    const btnFooterClose = this.modalEl.querySelector('#sb-btn-close');
    const btnChangeFolder = this.modalEl.querySelector('#sb-btn-change-folder');
    const btnSelectEmpty = this.modalEl.querySelector('#sb-btn-select-folder-empty');
    const btnMute = this.modalEl.querySelector('#sb-btn-mute');
    const sliderVol = this.modalEl.querySelector('#sb-slider-volume') as HTMLInputElement | null;
    const volLabel = this.modalEl.querySelector('#sb-volume-label');
    const container = this.modalEl.querySelector('#sb-sounds-container');

    const handleClose = () => this.close();
    btnClose?.addEventListener('click', handleClose);
    btnFooterClose?.addEventListener('click', handleClose);

    const handleChangeFolder = async () => {
      const folder = await soundboardService.selectFolder();
      if (folder) {
        await soundboardService.loadSounds();
        const sounds = soundboardService.getSounds();
        if (container) {
          container.innerHTML = this.renderSoundsGrid(sounds);
          this.attachSoundClickEvents();
        }
        const folderLabel = this.modalEl?.querySelector('#sb-folder-path-label');
        if (folderLabel) folderLabel.textContent = folder;
        const countBadge = this.modalEl?.querySelector('#sb-sound-count');
        if (countBadge) countBadge.textContent = tCount('soundboard.soundCount', sounds.length);
      }
    };

    btnChangeFolder?.addEventListener('click', handleChangeFolder);
    btnSelectEmpty?.addEventListener('click', handleChangeFolder);

    btnMute?.addEventListener('click', () => {
      settingsStore.soundboardMuted = !settingsStore.soundboardMuted;
      settingsStore.save();
      if (btnMute) {
        btnMute.className = `btn btn-icon ${settingsStore.soundboardMuted ? 'danger-active' : ''}`;
        btnMute.innerHTML = `<span class="material-symbols-outlined md-16">${settingsStore.soundboardMuted ? 'volume_off' : 'volume_up'}</span>`;
        btnMute.setAttribute('title', settingsStore.soundboardMuted ? t('soundboard.unmuteTitle') : t('soundboard.muteTitle'));
      }
    });

    sliderVol?.addEventListener('input', () => {
      const val = parseInt(sliderVol.value, 10);
      if (volLabel) volLabel.textContent = `${val}%`;
      settingsStore.soundboardVolume = val;
      settingsStore.save();
    });

    this.attachSoundClickEvents();
  }

  private attachSoundClickEvents(): void {
    if (!this.modalEl) return;
    const buttons = this.modalEl.querySelectorAll('.sb-sound-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const filePath = btn.getAttribute('data-filepath');
        if (!filePath) return;

        // Visual click feedback
        btn.classList.add('playing');
        btn.setAttribute('style', `${btn.getAttribute('style') || ''} transform: scale(0.95); border-color: var(--accent-primary); background: rgba(88, 101, 242, 0.15);`);
        setTimeout(() => {
          btn.setAttribute('style', (btn.getAttribute('style') || '').replace('transform: scale(0.95);', ''));
        }, 150);

        await soundboardService.playSound(filePath);
      });
    });
  }

  private highlightPlayedSound(soundName: string): void {
    if (!this.modalEl) return;
    const buttons = this.modalEl.querySelectorAll('.sb-sound-btn');
    buttons.forEach((btn) => {
      if (btn.getAttribute('data-soundname') === soundName) {
        btn.classList.add('playing-pulse');
        setTimeout(() => {
          btn.classList.remove('playing-pulse');
        }, 800);
      }
    });
  }

  public close(): void {
    this.unbindEvents.forEach((u) => u());
    this.unbindEvents = [];
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }
}

export const soundboardModal = new SoundboardModal();
