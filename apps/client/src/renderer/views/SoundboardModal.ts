import { escapeHtml } from '../utils/html';
import { soundboardService, SoundItem } from '../core/SoundboardService';
import { settingsStore } from '../stores/settingsStore';
import { serverStore } from '../stores/serverStore';
import { voiceStore } from '../stores/voiceStore';
import { appEvents } from '../core/EventBus';
import { formatKeyCombo } from '../utils/keybind';
import { showConfirm } from './Dialog';
import { enableBackdropClose } from '../utils/modal';

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export class SoundboardModal {
  private modalEl: HTMLElement | null = null;
  private unbindEvents: Array<() => void> = [];

  public async open(): Promise<void> {
    this.close();

    // Ensure sounds are loaded
    await soundboardService.loadSounds();
    const sounds = soundboardService.getSounds();
    const serverAllows = serverStore.serverDetails?.allowSoundboard !== false;
    const currentPlayback = soundboardService.getCurrentPlayback();

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
              ${sounds.length} ${sounds.length === 1 ? 'som' : 'sons'}
            </span>
            <div class="sb-help-badge" title="Formatos suportados: MP3, WAV, OGG, M4A, AAC, WEBM (máx. 3MB por som)" style="margin-left: 2px;">
              <span class="material-symbols-outlined md-16">help</span>
            </div>
          </div>
          <button id="modal-close" class="modal-close-btn">&times;</button>
        </div>

        <!-- Quick Volume & Mute Toolbar -->
        <div style="padding: 10px 20px; background: var(--bg-secondary); border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between; gap: 16px;">
          <!-- Folder select & Change -->
          <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
            <button id="sb-btn-change-folder" class="btn btn-secondary" style="font-size: 11px; padding: 4px 10px; height: 28px; white-space: nowrap;">
              <span class="material-symbols-outlined md-14" style="margin-right: 4px;">folder_open</span>
              ${settingsStore.soundboardFolderPath ? 'Trocar Pasta' : 'Escolher Pasta'}
            </button>
            <span id="sb-folder-path-label" style="font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${settingsStore.soundboardFolderPath || ''}">
              ${settingsStore.soundboardFolderPath ? escapeHtml(settingsStore.soundboardFolderPath) : 'Nenhuma pasta selecionada'}
            </span>
          </div>

          <!-- Volume & Mute Controls -->
          <div style="display: flex; align-items: center; gap: 12px;">
            <button id="sb-btn-mute" class="btn btn-icon ${settingsStore.soundboardMuted ? 'danger-active' : ''}" style="width: 28px; height: 28px; padding: 0;" title="${settingsStore.soundboardMuted ? 'Desmutar Soundboard' : 'Mutar Soundboard para você'}">
              <span class="material-symbols-outlined md-16">${settingsStore.soundboardMuted ? 'volume_off' : 'volume_up'}</span>
            </button>
            
            <div style="display: flex; align-items: center; gap: 8px;">
              <input id="sb-slider-volume" class="sb-slider" type="range" min="0" max="100" value="${settingsStore.soundboardVolume}" style="--slider-progress: ${settingsStore.soundboardVolume}%; width: 80px;">
              <span id="sb-volume-label" style="font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); min-width: 32px; text-align: right;">${settingsStore.soundboardVolume}%</span>
            </div>
          </div>
        </div>

        <!-- Active Sound Playback Mini Player -->
        <div id="sb-player-container" style="display: ${currentPlayback.isPlaying ? 'block' : 'none'};">
          <div style="padding: 8px 20px; background: rgba(88, 101, 242, 0.1); border-bottom: 1px solid rgba(88, 101, 242, 0.25); display: flex; align-items: center; gap: 12px;">
            <span class="material-symbols-outlined md-18" style="color: var(--accent-primary); animation: pulse 1.5s infinite;">graphic_eq</span>
            
            <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <span id="sb-player-sound-name" style="font-size: 12px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${currentPlayback.soundName ? escapeHtml(currentPlayback.soundName) : 'Tocando áudio...'}
                </span>
                <div style="font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); white-space: nowrap;">
                  <span id="sb-player-current-time">${formatTime(currentPlayback.currentTime)}</span>
                  <span>/</span>
                  <span id="sb-player-total-time">${formatTime(currentPlayback.duration)}</span>
                </div>
              </div>
              
              <!-- Progress Bar -->
              <div id="sb-player-progress-bar" style="width: 100%; height: 4px; background: rgba(255, 255, 255, 0.1); border-radius: 2px; overflow: hidden; position: relative;">
                <div id="sb-player-progress-fill" style="width: ${currentPlayback.duration > 0 ? (currentPlayback.currentTime / currentPlayback.duration) * 100 : 0}%; height: 100%; background: var(--accent-primary); border-radius: 2px; transition: width 0.1s linear;"></div>
              </div>
            </div>

            <button id="sb-player-btn-stop" class="btn btn-secondary" style="font-size: 11px; padding: 4px 8px; height: 26px; display: flex; align-items: center; gap: 4px; color: var(--danger); border-color: rgba(237, 66, 69, 0.3);" title="Parar reprodução de som">
              <span class="material-symbols-outlined md-14">stop</span>
              <span>Parar</span>
            </button>
          </div>
        </div>

        <!-- Server disabled alert banner -->
        ${!serverAllows ? `
          <div style="margin: 12px 20px 0; padding: 8px 12px; background: rgba(237, 66, 69, 0.15); border: 1px solid rgba(237, 66, 69, 0.3); border-radius: var(--radius-md); color: var(--danger); font-size: 12px; display: flex; align-items: center; gap: 8px;">
            <span class="material-symbols-outlined md-16">block</span>
            <span>A reprodução de soundboard está desabilitada neste servidor pelo administrador.</span>
          </div>
        ` : ''}

        <!-- Voice channel warning if not in call -->
        ${!voiceStore.currentVoiceChannelId ? `
          <div style="margin: 12px 20px 0; padding: 8px 12px; background: rgba(240, 178, 50, 0.15); border: 1px solid rgba(240, 178, 50, 0.3); border-radius: var(--radius-md); color: #f0b232; font-size: 12px; display: flex; align-items: center; gap: 8px;">
            <span class="material-symbols-outlined md-16">info</span>
            <span>Você não está em um canal de voz. Os sons serão tocados apenas como prévia local.</span>
          </div>
        ` : ''}

        <!-- Sounds Grid Area -->
        <div id="sb-sounds-container" style="flex: 1; overflow-y: auto; padding: 16px 20px; min-height: 220px;">
          ${this.renderSoundsGrid(sounds, currentPlayback.soundName)}
        </div>

        <!-- Footer -->
        <div class="modal-footer" style="padding: 12px 20px; border-top: 1px solid var(--border-color); background: var(--bg-card);">
          <div style="font-size: 11px; color: var(--text-muted); flex: 1;">
            Clique no som para tocar ou configure <strong>atalhos globais</strong> para acionar mesmo dentro de jogos!
          </div>
          <button type="button" id="sb-btn-close" class="btn btn-secondary" style="padding: 6px 16px; font-size: 12px;">Fechar</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.modalEl);
    this.attachEvents();
    this.setupPlaybackListeners();
  }

  private renderSoundsGrid(sounds: SoundItem[], activeSoundName: string | null = null): string {
    if (!settingsStore.soundboardFolderPath) {
      return `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 180px; text-align: center; color: var(--text-muted); gap: 12px;">
          <span class="material-symbols-outlined" style="font-size: 48px; color: var(--text-dim);">folder_special</span>
          <div>
            <div style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">Nenhuma pasta de sons selecionada</div>
            <div style="font-size: 12px; max-width: 340px;">Escolha uma pasta no seu computador com arquivos MP3, WAV, OGG, M4A, AAC ou WEBM para usar no seu soundboard!</div>
          </div>
          <button type="button" id="sb-btn-select-folder-empty" class="btn btn-primary" style="font-size: 12px; padding: 8px 18px; margin-top: 6px;">
            <span class="material-symbols-outlined md-16" style="margin-right: 6px;">folder_open</span>
            Escolher Pasta de Sons
          </button>
        </div>
      `;
    }

    if (sounds.length === 0) {
      return `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 180px; text-align: center; color: var(--text-muted); gap: 12px;">
          <span class="material-symbols-outlined" style="font-size: 48px; color: var(--text-dim);">audio_file</span>
          <div>
            <div style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">Nenhum arquivo de áudio encontrado</div>
            <div style="font-size: 12px; max-width: 340px;">A pasta selecionada não contém arquivos de áudio compatíveis (.mp3, .wav, .ogg, .m4a, .aac, .webm de até 3MB).</div>
          </div>
          <button type="button" id="sb-btn-select-folder-empty" class="btn btn-secondary" style="font-size: 12px; padding: 6px 14px;">
            <span class="material-symbols-outlined md-16" style="margin-right: 6px;">folder_open</span>
            Trocar de Pasta
          </button>
        </div>
      `;
    }

    const shortcuts = settingsStore.soundboardShortcuts || {};

    return `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px;">
        ${sounds
          .map((s) => {
            const isPlaying = activeSoundName === s.name;
            const shortcut = shortcuts[s.name];

            return `
              <div class="sb-sound-card ${isPlaying ? 'is-playing' : ''}" style="display: flex; flex-direction: column; background: var(--bg-card); border: 1px solid ${isPlaying ? 'var(--accent-primary)' : 'var(--border-color)'}; border-radius: var(--radius-md); overflow: hidden; transition: all 0.15s ease; position: relative;">
                <!-- Play Sound Button -->
                <button type="button" class="sb-sound-btn" data-filepath="${escapeHtml(s.filePath)}" data-soundname="${escapeHtml(s.name)}" title="Tocar ${escapeHtml(s.name)} (${(s.sizeBytes / 1024).toFixed(0)} KB)" style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 12px 8px 6px; background: transparent; border: none; color: var(--text-primary); cursor: pointer; text-align: center; outline: none; width: 100%;">
                  <span class="material-symbols-outlined sb-sound-icon" style="color: var(--accent-primary); font-size: 26px;">${isPlaying ? 'volume_up' : 'play_circle'}</span>
                  <span style="font-size: 12px; font-weight: 600; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; width: 100%; word-break: break-word;">
                    ${escapeHtml(s.name)}
                  </span>
                </button>
                
                <!-- Shortcut Badge or Add Shortcut Button -->
                <div style="padding: 4px 6px 8px; display: flex; align-items: center; justify-content: center;">
                  ${shortcut && shortcut.display ? `
                    <div class="sb-shortcut-badge" data-soundname="${escapeHtml(s.name)}" title="Atalho global: ${escapeHtml(shortcut.display)} (Clique para alterar)" style="display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px; background: rgba(88, 101, 242, 0.15); border: 1px solid rgba(88, 101, 242, 0.4); border-radius: 4px; font-family: var(--font-mono); font-size: 10px; color: #ffffff; cursor: pointer; max-width: 100%;">
                      <span class="material-symbols-outlined" style="font-size: 11px; color: var(--accent-primary);">keyboard</span>
                      <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70px;">${escapeHtml(shortcut.display)}</span>
                      <button type="button" class="sb-btn-remove-shortcut" data-soundname="${escapeHtml(s.name)}" title="Remover atalho" style="background: none; border: none; color: var(--text-muted); cursor: pointer; display: inline-flex; align-items: center; padding: 0; margin-left: 2px;">
                        <span class="material-symbols-outlined" style="font-size: 12px;">close</span>
                      </button>
                    </div>
                  ` : `
                    <button type="button" class="sb-btn-add-shortcut" data-soundname="${escapeHtml(s.name)}" title="Adicionar atalho de teclado para este som" style="display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px; background: transparent; border: 1px dashed var(--border-color); border-radius: 4px; font-size: 10px; color: var(--text-muted); cursor: pointer; transition: all 0.15s ease;">
                      <span class="material-symbols-outlined" style="font-size: 11px;">keyboard</span>
                      <span>Atalho</span>
                    </button>
                  `}
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;
  }

  private refreshGrid(): void {
    if (!this.modalEl) return;
    const container = this.modalEl.querySelector('#sb-sounds-container');
    if (container) {
      const sounds = soundboardService.getSounds();
      const currentPlayback = soundboardService.getCurrentPlayback();
      container.innerHTML = this.renderSoundsGrid(sounds, currentPlayback.soundName);
      this.attachSoundClickEvents();
    }
  }

  private async openKeyCaptureModal(soundName: string): Promise<void> {
    soundboardService.setCapturingKey(true);
    await soundboardService.pauseShortcuts();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.style.zIndex = '10000';
    backdrop.innerHTML = `
      <div class="modal-card" style="width: 380px; max-width: 90vw; text-align: center; animation: modalIn 0.15s ease;" role="dialog" aria-modal="true">
        <div class="modal-header" style="justify-content: center; position: relative;">
          <div class="modal-title" style="display: flex; align-items: center; gap: 8px; font-size: 15px;">
            <span class="material-symbols-outlined" style="color: var(--accent-primary);">keyboard</span>
            <span>Configurar Atalho</span>
          </div>
          <button id="sb-keybind-modal-close" class="modal-close-btn" style="position: absolute; right: 16px; top: 16px;">&times;</button>
        </div>
        <div style="padding: 16px 20px 20px;">
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 16px; word-break: break-word;">
            Pressione a tecla ou combinação para o som <strong style="color: var(--text-primary);">${escapeHtml(soundName)}</strong>
          </div>
          <div id="sb-keybind-box" style="padding: 24px 16px; background: var(--bg-input); border: 2px dashed var(--accent-primary); border-radius: var(--radius-md); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 0 16px rgba(88, 101, 242, 0.25);">
            <span class="material-symbols-outlined" style="font-size: 32px; color: var(--accent-primary); animation: pulse 1.5s infinite;">keyboard</span>
            <div style="font-size: 14px; font-weight: 600; color: var(--text-primary);">Aguardando tecla...</div>
            <div style="font-size: 11px; color: var(--text-muted);">Exemplos: F1 a F12, NumPad 1, Ctrl + Alt + 1</div>
          </div>
        </div>
        <div class="modal-footer" style="justify-content: space-between; padding: 12px 20px;">
          <button type="button" id="sb-keybind-btn-clear" class="btn btn-secondary" style="font-size: 12px; color: var(--danger);">Remover Atalho</button>
          <button type="button" id="sb-keybind-btn-cancel" class="btn btn-secondary" style="font-size: 12px;">Cancelar (Esc)</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    let isClosed = false;
    const cleanup = async () => {
      if (isClosed) return;
      isClosed = true;
      window.removeEventListener('keydown', handleKeyDown, true);
      backdrop.remove();
      soundboardService.setCapturingKey(false);
      await soundboardService.syncShortcuts();
    };

    const handleKeyDown = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        await cleanup();
        return;
      }

      const combo = formatKeyCombo(e);
      if (!combo) return; // Lone modifier key, keep listening

      await cleanup();

      // Check if this shortcut is already in use by another sound
      const existingConflict = Object.entries(settingsStore.soundboardShortcuts || {}).find(
        ([name, data]) => data && data.accelerator === combo.accelerator && name !== soundName
      );

      if (existingConflict) {
        const [conflictSoundName] = existingConflict;
        const confirm = await showConfirm({
          title: 'Atalho em uso',
          message: `O atalho "${combo.display}" já está associado ao som "${conflictSoundName}". Deseja substituir?`,
          confirmLabel: 'Substituir',
          cancelLabel: 'Cancelar',
          variant: 'warning',
        });

        if (!confirm) {
          await soundboardService.syncShortcuts();
          return; // Cancelled by user
        }

        // Remove from old sound
        delete settingsStore.soundboardShortcuts[conflictSoundName];
      }

      // Assign to current sound
      if (!settingsStore.soundboardShortcuts) {
        settingsStore.soundboardShortcuts = {};
      }
      settingsStore.soundboardShortcuts[soundName] = combo;
      settingsStore.save();
      await soundboardService.syncShortcuts();

      this.refreshGrid();
    };

    backdrop.querySelector('#sb-keybind-modal-close')?.addEventListener('click', () => cleanup());
    backdrop.querySelector('#sb-keybind-btn-cancel')?.addEventListener('click', () => cleanup());
    backdrop.querySelector('#sb-keybind-btn-clear')?.addEventListener('click', async () => {
      await cleanup();
      if (settingsStore.soundboardShortcuts) {
        delete settingsStore.soundboardShortcuts[soundName];
        settingsStore.save();
        await soundboardService.syncShortcuts();
        this.refreshGrid();
      }
    });

    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) cleanup();
    });

    window.addEventListener('keydown', handleKeyDown, true);
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
    const btnStop = this.modalEl.querySelector('#sb-player-btn-stop');

    const handleClose = () => this.close();
    btnClose?.addEventListener('click', handleClose);
    btnFooterClose?.addEventListener('click', handleClose);
    enableBackdropClose(this.modalEl, handleClose);

    const handleChangeFolder = async () => {
      const folder = await soundboardService.selectFolder();
      if (folder) {
        await soundboardService.loadSounds();
        const sounds = soundboardService.getSounds();
        this.refreshGrid();
        const folderLabel = this.modalEl?.querySelector('#sb-folder-path-label');
        if (folderLabel) folderLabel.textContent = folder;
        const countBadge = this.modalEl?.querySelector('#sb-sound-count');
        if (countBadge) countBadge.textContent = `${sounds.length} ${sounds.length === 1 ? 'som' : 'sons'}`;
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
        btnMute.setAttribute('title', settingsStore.soundboardMuted ? 'Desmutar Soundboard' : 'Mutar Soundboard para você');
      }
    });

    sliderVol?.addEventListener('input', () => {
      const val = parseInt(sliderVol.value, 10);
      if (volLabel) volLabel.textContent = `${val}%`;
      sliderVol.style.setProperty('--slider-progress', `${val}%`);
      settingsStore.soundboardVolume = val;
      settingsStore.save();
    });

    btnStop?.addEventListener('click', () => {
      soundboardService.stopSound();
    });

    this.attachSoundClickEvents();
  }

  private attachSoundClickEvents(): void {
    if (!this.modalEl) return;
    
    // Play sound click
    const buttons = this.modalEl.querySelectorAll('.sb-sound-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const filePath = btn.getAttribute('data-filepath');
        if (!filePath) return;
        await soundboardService.playSound(filePath);
      });
    });

    // Add / edit shortcut click
    const shortcutTriggers = this.modalEl.querySelectorAll('.sb-btn-add-shortcut, .sb-shortcut-badge');
    shortcutTriggers.forEach((trigger) => {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const soundName = trigger.getAttribute('data-soundname');
        if (soundName) this.openKeyCaptureModal(soundName);
      });
    });

    // Remove shortcut click
    const removeButtons = this.modalEl.querySelectorAll('.sb-btn-remove-shortcut');
    removeButtons.forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const soundName = btn.getAttribute('data-soundname');
        if (soundName && settingsStore.soundboardShortcuts) {
          delete settingsStore.soundboardShortcuts[soundName];
          settingsStore.save();
          await soundboardService.syncShortcuts();
          this.refreshGrid();
        }
      });
    });
  }

  private setupPlaybackListeners(): void {
    // 1. Playback started
    const onPlaybackStarted = (payload: { soundName: string; duration: number; userName?: string }) => {
      if (!this.modalEl) return;

      const playerContainer = this.modalEl.querySelector('#sb-player-container') as HTMLElement | null;
      const soundNameEl = this.modalEl.querySelector('#sb-player-sound-name');
      const progressFill = this.modalEl.querySelector('#sb-player-progress-fill') as HTMLElement | null;
      const currentTimeEl = this.modalEl.querySelector('#sb-player-current-time');
      const totalTimeEl = this.modalEl.querySelector('#sb-player-total-time');

      if (playerContainer) playerContainer.style.display = 'block';
      if (soundNameEl) {
        const activeCount = soundboardService.getActivePlaybacks().length;
        if (activeCount > 1) {
          soundNameEl.textContent = `${payload.soundName} (+${activeCount - 1} outros sons)`;
          soundNameEl.setAttribute('title', `${payload.soundName} (+${activeCount - 1} outros sons em reprodução)`);
        } else {
          const userSuffix = payload.userName ? ` (${payload.userName})` : '';
          soundNameEl.textContent = `${payload.soundName}${userSuffix}`;
          soundNameEl.setAttribute('title', `${payload.soundName}${userSuffix}`);
        }
      }
      if (progressFill) progressFill.style.width = '0%';
      if (currentTimeEl) currentTimeEl.textContent = '0:00';
      if (totalTimeEl) totalTimeEl.textContent = formatTime(payload.duration);

      // Highlight active sound buttons
      this.updateActiveButtons();
    };

    // 2. Playback progress
    const onPlaybackProgress = (payload: { soundName: string; currentTime: number; duration: number; percent: number }) => {
      if (!this.modalEl) return;

      const progressFill = this.modalEl.querySelector('#sb-player-progress-fill') as HTMLElement | null;
      const currentTimeEl = this.modalEl.querySelector('#sb-player-current-time');
      const totalTimeEl = this.modalEl.querySelector('#sb-player-total-time');

      if (progressFill) progressFill.style.width = `${payload.percent}%`;
      if (currentTimeEl) currentTimeEl.textContent = formatTime(payload.currentTime);
      if (totalTimeEl) totalTimeEl.textContent = formatTime(payload.duration);
    };

    // 3. Playback ended / stopped
    const onPlaybackEnded = () => {
      if (!this.modalEl) return;

      const activePlaybacks = soundboardService.getActivePlaybacks();
      if (activePlaybacks.length === 0) {
        const playerContainer = this.modalEl.querySelector('#sb-player-container') as HTMLElement | null;
        if (playerContainer) playerContainer.style.display = 'none';
        this.clearActiveButtons();
      } else {
        const playerContainer = this.modalEl.querySelector('#sb-player-container') as HTMLElement | null;
        const soundNameEl = this.modalEl.querySelector('#sb-player-sound-name');
        if (playerContainer) playerContainer.style.display = 'block';
        if (soundNameEl) {
          const latest = activePlaybacks[activePlaybacks.length - 1];
          if (activePlaybacks.length > 1) {
            soundNameEl.textContent = `${latest.soundName} (+${activePlaybacks.length - 1} outros sons)`;
          } else {
            const userSuffix = latest.userName ? ` (${latest.userName})` : '';
            soundNameEl.textContent = `${latest.soundName}${userSuffix}`;
          }
        }
        this.updateActiveButtons();
      }
    };

    // 4. Highlight incoming sound trigger
    const onSoundPlayed = (payload: any) => {
      this.highlightPlayedSound(payload.soundName);
    };

    appEvents.on('soundboard.playback_started', onPlaybackStarted);
    appEvents.on('soundboard.playback_progress', onPlaybackProgress);
    appEvents.on('soundboard.playback_ended', onPlaybackEnded);
    appEvents.on('soundboard.played', onSoundPlayed);

    this.unbindEvents.push(() => {
      appEvents.off('soundboard.playback_started', onPlaybackStarted);
      appEvents.off('soundboard.playback_progress', onPlaybackProgress);
      appEvents.off('soundboard.playback_ended', onPlaybackEnded);
      appEvents.off('soundboard.played', onSoundPlayed);
    });
  }

  private updateActiveButtons(): void {
    if (!this.modalEl) return;
    const playingNames = soundboardService.getPlayingSoundNames();
    const buttons = this.modalEl.querySelectorAll('.sb-sound-btn');
    buttons.forEach((btn) => {
      const soundName = btn.getAttribute('data-soundname');
      const icon = btn.querySelector('.sb-sound-icon');
      if (soundName && playingNames.has(soundName)) {
        btn.classList.add('is-playing');
        if (icon) icon.textContent = 'volume_up';
      } else {
        btn.classList.remove('is-playing');
        if (icon) icon.textContent = 'play_circle';
      }
    });
  }

  private clearActiveButtons(): void {
    if (!this.modalEl) return;
    const buttons = this.modalEl.querySelectorAll('.sb-sound-btn');
    buttons.forEach((btn) => {
      btn.classList.remove('is-playing');
      const icon = btn.querySelector('.sb-sound-icon');
      if (icon) icon.textContent = 'play_circle';
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
