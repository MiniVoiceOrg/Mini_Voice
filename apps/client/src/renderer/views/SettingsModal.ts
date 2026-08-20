import { MessageType, QUALITY_PRESETS, QualityPresetType } from '@mini-voice/shared';
import { appEvents } from '../core/EventBus';
import { networkClient } from '../core/NetworkClient';
import { audioProcessor } from '../core/AudioProcessor';
import { serverStore } from '../stores/serverStore';
import { settingsStore } from '../stores/settingsStore';
import { voiceStore } from '../stores/voiceStore';
import { webRtcManager } from '../core/WebRtcManager';
import { videoService } from '../core/VideoService';
import { connectionStore } from '../stores/connectionStore';
import { getAvatarUrl } from '../utils/avatar';

export class SettingsModal {
  private modalEl: HTMLElement | null = null;

  public async open(): Promise<void> {
    this.close();

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((d) => d.kind === 'audioinput');
    const audioOutputs = devices.filter((d) => d.kind === 'audiooutput');
    const videoInputs = devices.filter((d) => d.kind === 'videoinput');

    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-backdrop';
    this.modalEl.innerHTML = `
      <div class="modal-card" style="max-width: 580px; max-height: 90vh; overflow-y: auto;">
        <div class="modal-header">
          <div class="modal-title">⚙️ Configurações</div>
          <button id="modal-close" class="modal-close-btn">&times;</button>
        </div>

        <div id="settings-error-banner" class="error-banner"></div>

        <!-- Nickname & Profile -->
        <div style="display: flex; gap: 16px; align-items: center; padding: 12px; background: var(--bg-card); border-radius: var(--radius-md);">
          <img id="settings-avatar-preview" style="width: 52px; height: 52px; border-radius: 50%; object-fit: cover;" src="${getAvatarUrl(serverStore.currentUser?.avatarUrl)}">
          <div style="flex: 1;">
            <div class="form-group" style="margin-bottom: 0;">
              <label>Alterar Nickname</label>
              <div style="display: flex; gap: 8px;">
                <input id="settings-nickname-input" type="text" value="${serverStore.currentUser?.nickname || ''}" style="flex: 1;" maxlength="32">
                <button id="btn-save-nickname" class="btn btn-secondary" style="font-size: 12px;">Salvar</button>
              </div>
            </div>
          </div>
          <button id="btn-change-avatar" class="btn btn-secondary" style="font-size: 12px;">Foto</button>
        </div>

        <!-- Audio Devices -->
        <div class="form-group">
          <label>Microfone</label>
          <select id="select-mic">
            ${audioInputs.map((d) => `<option value="${d.deviceId}" ${d.deviceId === settingsStore.selectedMicrophoneId ? 'selected' : ''}>${d.label || 'Microfone Padrão'}</option>`).join('')}
          </select>
        </div>

        <div class="form-group">
          <label>Sensibilidade de Voz (VAD)</label>
          <div style="display: flex; align-items: center; gap: 12px;">
            <input id="slider-vad" type="range" min="5" max="80" value="${settingsStore.vadSensitivity}" style="flex: 1;">
            <span id="vad-val" style="font-family: var(--font-mono); font-size: 12px; min-width: 30px;">${settingsStore.vadSensitivity}</span>
          </div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Valores menores ativam com sussurros, maiores evitam ruídos de fundo.</div>
        </div>

        ${audioOutputs.length > 0 ? `
          <div class="form-group">
            <label>Dispositivo de Saída (Alto-falante / Fone)</label>
            <select id="select-speaker">
              ${audioOutputs.map((d) => `<option value="${d.deviceId}" ${d.deviceId === settingsStore.selectedSpeakerId ? 'selected' : ''}>${d.label || 'Alto-falante Padrão'}</option>`).join('')}
            </select>
          </div>
        ` : ''}

        <!-- Camera Device -->
        ${videoInputs.length > 0 ? `
          <div class="form-group">
            <label>Câmera de Vídeo</label>
            <select id="select-cam">
              ${videoInputs.map((d) => `<option value="${d.deviceId}" ${d.deviceId === settingsStore.selectedCameraId ? 'selected' : ''}>${d.label || 'Câmera Padrão'}</option>`).join('')}
            </select>
          </div>
        ` : ''}

        <!-- Quality Preset -->
        <div class="form-group">
          <label>Perfil de Qualidade e Desempenho</label>
          <select id="select-preset">
            <option value="ECONOMIC" ${settingsStore.qualityPreset === 'ECONOMIC' ? 'selected' : ''}>Econômico (Voz 24k, Câmera 360p, Tela 480p) — Menor uso de banda</option>
            <option value="NORMAL" ${settingsStore.qualityPreset === 'NORMAL' ? 'selected' : ''}>Normal (Voz 32k, Câmera 480p, Tela 720p) — Padrão balanceado</option>
            <option value="HIGH" ${settingsStore.qualityPreset === 'HIGH' ? 'selected' : ''}>Alta Qualidade (Voz 48k, Câmera 720p, Tela 1080p)</option>
            <option value="GAMING" ${settingsStore.qualityPreset === 'GAMING' ? 'selected' : ''}>Gaming Mode (Voz 28k Prioritária, Câmera e Tela Reduzidas) — Sem lag em jogos</option>
          </select>
        </div>

        <div class="modal-footer">
          <button id="btn-settings-close" class="btn btn-primary">Pronto</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.modalEl);
    this.attachEvents();
  }

  private attachEvents(): void {
    if (!this.modalEl) return;

    const btnClose = this.modalEl.querySelector('#modal-close');
    const btnDone = this.modalEl.querySelector('#btn-settings-close');
    const btnSaveNick = this.modalEl.querySelector('#btn-save-nickname');
    const btnChangeAvatar = this.modalEl.querySelector('#btn-change-avatar');
    const inputNick = this.modalEl.querySelector('#settings-nickname-input') as HTMLInputElement;
    const selectMic = this.modalEl.querySelector('#select-mic') as HTMLSelectElement;
    const selectSpeaker = this.modalEl.querySelector('#select-speaker') as HTMLSelectElement;
    const selectCam = this.modalEl.querySelector('#select-cam') as HTMLSelectElement;
    const selectPreset = this.modalEl.querySelector('#select-preset') as HTMLSelectElement;
    const sliderVad = this.modalEl.querySelector('#slider-vad') as HTMLInputElement;
    const vadVal = this.modalEl.querySelector('#vad-val');

    btnClose?.addEventListener('click', () => this.close());
    btnDone?.addEventListener('click', () => this.close());

    sliderVad?.addEventListener('input', () => {
      const val = parseInt(sliderVad.value, 10);
      if (vadVal) vadVal.textContent = val.toString();
      settingsStore.vadSensitivity = val;
      audioProcessor.setVadThreshold(val);
      settingsStore.save();
    });

    selectPreset?.addEventListener('change', () => {
      const preset = selectPreset.value as QualityPresetType;
      settingsStore.qualityPreset = preset;
      settingsStore.save();
      videoService.setQualityPreset(preset);
      webRtcManager.setQualityPreset(preset);
    });

    selectMic?.addEventListener('change', async () => {
      settingsStore.selectedMicrophoneId = selectMic.value;
      settingsStore.save();
      try {
        const stream = await audioProcessor.startMicrophone(selectMic.value);
        const track = stream.getAudioTracks()[0];
        await webRtcManager.setLocalAudioTrack(track);
      } catch (err) {
        console.warn('Error switching microphone device:', err);
      }
    });

    selectSpeaker?.addEventListener('change', () => {
      settingsStore.selectedSpeakerId = selectSpeaker.value;
      settingsStore.save();
      webRtcManager.setSpeakerDeviceId(selectSpeaker.value);
    });

    selectCam?.addEventListener('change', async () => {
      settingsStore.selectedCameraId = selectCam.value;
      settingsStore.save();
      if (voiceStore.isCameraOn) {
        try {
          const stream = await videoService.startCamera(selectCam.value);
          const track = stream.getVideoTracks()[0];
          await webRtcManager.setLocalCameraTrack(track);
        } catch (err) {
          console.warn('Error switching camera device:', err);
        }
      }
    });

    btnSaveNick?.addEventListener('click', async () => {
      const newNick = inputNick?.value.trim();
      if (!newNick) return;
      this.hideError();

      try {
        await networkClient.sendRequest(MessageType.USER_CHANGE_NICKNAME, { newNickname: newNick });
        connectionStore.saveUserProfile(newNick);
      } catch (err: any) {
        this.showError(err.message || 'Erro ao alterar nickname');
      }
    });

    btnChangeAvatar?.addEventListener('click', async () => {
      if (window.api?.selectImageDialog) {
        const file = await window.api.selectImageDialog();
        if (file) {
          try {
            await networkClient.sendRequest(MessageType.USER_UPDATE_AVATAR, {
              avatarBase64: file.base64,
              mimeType: file.mimeType,
            });
            const preview = document.getElementById('settings-avatar-preview') as HTMLImageElement;
            if (preview) preview.src = file.base64;
            connectionStore.saveUserProfile(serverStore.currentUser?.nickname || '', file.base64);
          } catch (err: any) {
            this.showError(err.message || 'Erro ao enviar avatar');
          }
        }
      }
    });
  }

  private showError(msg: string): void {
    const banner = document.getElementById('settings-error-banner');
    if (banner) {
      banner.innerText = msg;
      banner.classList.add('show');
    }
  }

  private hideError(): void {
    const banner = document.getElementById('settings-error-banner');
    if (banner) {
      banner.innerText = '';
      banner.classList.remove('show');
    }
  }

  public close(): void {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }
}

export const settingsModal = new SettingsModal();
