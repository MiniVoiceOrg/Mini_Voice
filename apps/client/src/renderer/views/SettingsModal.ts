import { MessageType, QUALITY_PRESETS, QualityPresetType } from '@mini-voice/shared';
import { appEvents } from '../core/EventBus';
import { networkClient } from '../core/NetworkClient';
import { audioProcessor } from '../core/AudioProcessor';
import { serverStore } from '../stores/serverStore';
import { settingsStore } from '../stores/settingsStore';
import { voiceStore } from '../stores/voiceStore';
import { webRtcManager } from '../core/WebRtcManager';
import { videoService } from '../core/VideoService';
import { soundEffects } from '../core/SoundEffects';
import { connectionStore } from '../stores/connectionStore';
import { getAvatarUrl } from '../utils/avatar';
import { updateService } from '../core/UpdateService';

export class SettingsModal {
  private modalEl: HTMLElement | null = null;
  private previewStream: MediaStream | null = null;
  private previewOwned = false;
  private vadMeterStream: MediaStream | null = null;
  private vadMeterCtx: AudioContext | null = null;
  private vadMeterAnalyser: AnalyserNode | null = null;
  private vadMeterRAF: number | null = null;

  public async open(): Promise<void> {
    this.close();

    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-backdrop';
    this.modalEl.innerHTML = `
      <div class="modal-card" style="max-width: 580px; max-height: 90vh; overflow-y: auto;">
        <div class="modal-header">
          <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
            <span class="material-symbols-outlined" style="color: var(--accent-primary);">settings</span>
            <span>Configurações</span>
          </div>
          <button id="modal-close" class="modal-close-btn">&times;</button>
        </div>

        <div id="settings-error-banner" class="error-banner"></div>

        <!-- Nickname & Profile -->
        <div style="display: flex; gap: 16px; align-items: center; padding: 12px; background: var(--bg-card); border-radius: var(--radius-md); margin-bottom: 16px; border: 1px solid var(--border-color);">
          <img id="settings-avatar-preview" style="width: 52px; height: 52px; border-radius: 50%; object-fit: cover;" src="${serverStore.currentUser?.avatarUrl ? getAvatarUrl(serverStore.currentUser.avatarUrl) : (connectionStore.savedAvatarBase64 || getAvatarUrl(null))}">
          <div style="flex: 1;">
            <div class="form-group" style="margin-bottom: 0;">
              <label>Seu Nickname</label>
              <div style="display: flex; gap: 8px; margin-top: 4px;">
                <input id="settings-nickname-input" type="text" value="${serverStore.currentUser?.nickname || connectionStore.savedNickname || ''}" style="flex: 1;" maxlength="32">
                <button id="btn-save-nickname" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;">Salvar</button>
              </div>
            </div>
          </div>
          <button id="btn-change-avatar" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;">
            <span class="material-symbols-outlined md-16" style="margin-right: 4px;">photo_camera</span>
            Foto
          </button>
        </div>

        <!-- Device Header with Refresh Button -->
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; border-top: 1px solid var(--border-color); padding-top: 14px;">
          <span style="font-size: 13px; font-weight: 700; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.5px;">
            Dispositivos de Entrada e Saída
          </span>
          <button id="btn-refresh-devices" class="btn btn-secondary" style="font-size: 11px; padding: 3px 8px; height: 26px;" title="Buscar novos microfones e fones conectados">
            <span class="material-symbols-outlined md-14" style="margin-right: 4px;">refresh</span>
            Atualizar Lista
          </button>
        </div>

        <!-- Audio Inputs -->
        <div class="form-group">
          <label style="display: flex; align-items: center; gap: 6px;">
            <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">mic</span>
            Microfone
          </label>
          <select id="select-mic">
            <option value="">Carregando microfones...</option>
          </select>
        </div>

        <div class="form-group">
          <label style="display: flex; align-items: center; gap: 6px;">
            <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">tune</span>
            Sensibilidade de Voz (VAD)
          </label>
          <div style="display: flex; align-items: center; gap: 12px;">
            <input id="slider-vad" type="range" min="5" max="80" value="${settingsStore.vadSensitivity}" style="flex: 1;">
            <span id="vad-val" style="font-family: var(--font-mono); font-size: 12px; min-width: 30px;">${settingsStore.vadSensitivity}</span>
          </div>
          <div id="vad-meter" class="vad-meter" title="Nível do seu microfone">
            <div id="vad-meter-fill" class="vad-meter-fill"></div>
            <div id="vad-meter-threshold" class="vad-meter-threshold"></div>
          </div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Fale para ver o nível. Ajuste o slider (linha) logo acima de onde o nível fica em silêncio. Valores menores ativam com sussurros; maiores evitam ruídos de fundo.</div>
        </div>

        <!-- Audio Outputs -->
        <div class="form-group" id="group-speaker">
          <label style="display: flex; align-items: center; gap: 6px;">
            <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">headphones</span>
            Dispositivo de Saída (Alto-falante / Fone)
          </label>
          <select id="select-speaker">
            <option value="">Carregando dispositivos de saída...</option>
          </select>
        </div>

        <!-- Camera Inputs -->
        <div class="form-group" id="group-camera">
          <label style="display: flex; align-items: center; gap: 6px;">
            <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">videocam</span>
            Câmera de Vídeo
          </label>
          <select id="select-cam">
            <option value="">Carregando câmeras...</option>
          </select>
          <div style="margin-top: 8px;">
            <button id="btn-toggle-cam-preview" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;">
              <span class="material-symbols-outlined md-16" style="margin-right: 4px;">visibility</span>
              Testar / Pré-visualizar câmera
            </button>
          </div>
          <video id="settings-cam-preview" class="settings-cam-preview" autoplay playsinline muted style="display: none;"></video>
        </div>

        <!-- Quality Preset -->
        <div class="form-group" style="border-top: 1px solid var(--border-color); padding-top: 14px; margin-top: 10px;">
          <label style="display: flex; align-items: center; gap: 6px;">
            <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">speed</span>
            Perfil de Qualidade e Desempenho
            <span class="material-symbols-outlined md-16" style="color: var(--text-muted); cursor: help;" title="Afeta APENAS o que você transmite (sua voz, câmera e tela). A qualidade do que você recebe depende da configuração de cada pessoa. Perfis mais altos usam mais internet e CPU.">help</span>
          </label>
          <select id="select-preset">
            <option value="ECONOMIC" ${settingsStore.qualityPreset === 'ECONOMIC' ? 'selected' : ''}>Econômico — para internet lenta (menor resolução, prioriza estabilidade)</option>
            <option value="NORMAL" ${settingsStore.qualityPreset === 'NORMAL' ? 'selected' : ''}>Normal (recomendado) — bom equilíbrio entre qualidade e banda</option>
            <option value="HIGH" ${settingsStore.qualityPreset === 'HIGH' ? 'selected' : ''}>Alta Qualidade — para internet rápida (mais nitidez, usa mais banda e CPU)</option>
            <option value="GAMING" ${settingsStore.qualityPreset === 'GAMING' ? 'selected' : ''}>Gaming — tela fluida em 60 FPS para jogos (reduz a câmera)</option>
          </select>
          <small style="display: block; margin-top: 6px; color: var(--text-muted); font-size: 11px;">
            Afeta apenas o que <strong>você transmite</strong>. A qualidade que você recebe depende de cada pessoa.
          </small>
        </div>

        <!-- Updates -->
        <div class="form-group" style="border-top: 1px solid var(--border-color); padding-top: 14px; margin-top: 10px;">
          <label style="display: flex; align-items: center; gap: 6px;">
            <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">system_update</span>
            Atualizações
          </label>
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
            <div style="flex: 1;">
              <div style="font-size: 12px; color: var(--text-secondary);">
                Versão atual: <span id="settings-app-version" style="font-family: var(--font-mono);">…</span>
              </div>
              <div id="settings-update-status" style="font-size: 11px; color: var(--text-muted); margin-top: 2px;"></div>
            </div>
            <button id="btn-check-updates" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;">
              <span class="material-symbols-outlined md-16" style="margin-right: 4px;">refresh</span>
              Verificar atualizações
            </button>
          </div>
        </div>

        <div class="modal-footer" style="margin-top: 20px;">
          <button id="btn-settings-close" class="btn btn-primary">Pronto</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.modalEl);
    this.attachEvents();
    await this.refreshDevices();
    await this.loadAppVersion();
    this.startVadMeter();
  }

  private async loadAppVersion(): Promise<void> {
    if (!this.modalEl || !window.api?.getAppVersion) return;
    try {
      const version = await window.api.getAppVersion();
      const el = this.modalEl.querySelector('#settings-app-version');
      if (el) el.textContent = version;
    } catch {
      // Ignore — version display is non-critical.
    }
  }

  private async checkUpdates(): Promise<void> {
    const btn = this.modalEl?.querySelector('#btn-check-updates') as HTMLButtonElement | null;
    const status = this.modalEl?.querySelector('#settings-update-status') as HTMLElement | null;
    if (!btn || !status) return;

    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML =
      '<span class="material-symbols-outlined md-16" style="margin-right: 4px;">autorenew</span> Verificando...';

    const result = await updateService.checkManually();

    btn.disabled = false;
    btn.innerHTML = orig;

    if (result.status === 'available') {
      status.textContent = `Nova versão ${result.version} disponível! Veja o aviso no topo para atualizar.`;
      status.style.color = 'var(--accent-primary)';
    } else if (result.status === 'latest') {
      status.textContent = 'Você já está na versão mais recente.';
      status.style.color = 'var(--success)';
    } else {
      status.textContent = 'Não foi possível verificar agora. Tente novamente.';
      status.style.color = 'var(--danger)';
    }
  }

  private async refreshDevices(): Promise<void> {
    if (!this.modalEl) return;

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === 'audioinput');
      const audioOutputs = devices.filter((d) => d.kind === 'audiooutput');
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');

      const selectMic = this.modalEl.querySelector('#select-mic') as HTMLSelectElement;
      const selectSpeaker = this.modalEl.querySelector('#select-speaker') as HTMLSelectElement;
      const selectCam = this.modalEl.querySelector('#select-cam') as HTMLSelectElement;

      if (selectMic) {
        if (audioInputs.length === 0) {
          selectMic.innerHTML = '<option value="">Nenhum microfone detectado</option>';
        } else {
          selectMic.innerHTML = audioInputs
            .map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === settingsStore.selectedMicrophoneId ? 'selected' : ''}>${d.label || `Microfone ${i + 1}`}</option>`)
            .join('');
          if (!settingsStore.selectedMicrophoneId && audioInputs.length > 0) {
            settingsStore.selectedMicrophoneId = audioInputs[0].deviceId;
            settingsStore.save();
          }
        }
      }

      if (selectSpeaker) {
        if (audioOutputs.length === 0) {
          selectSpeaker.innerHTML = '<option value="">Alto-falante Padrão do Sistema</option>';
        } else {
          selectSpeaker.innerHTML = audioOutputs
            .map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === settingsStore.selectedSpeakerId ? 'selected' : ''}>${d.label || `Saída ${i + 1}`}</option>`)
            .join('');
          if (!settingsStore.selectedSpeakerId && audioOutputs.length > 0) {
            settingsStore.selectedSpeakerId = audioOutputs[0].deviceId;
            settingsStore.save();
          }
        }
      }

      if (selectCam) {
        if (videoInputs.length === 0) {
          selectCam.innerHTML = '<option value="">Nenhuma câmera detectada</option>';
        } else {
          selectCam.innerHTML = videoInputs
            .map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === settingsStore.selectedCameraId ? 'selected' : ''}>${d.label || `Câmera ${i + 1}`}</option>`)
            .join('');
          if (!settingsStore.selectedCameraId && videoInputs.length > 0) {
            settingsStore.selectedCameraId = videoInputs[0].deviceId;
            settingsStore.save();
          }
        }
      }
    } catch (e) {
      console.warn('[SettingsModal] Error enumerating devices:', e);
    }
  }

  private attachEvents(): void {
    if (!this.modalEl) return;

    const btnClose = this.modalEl.querySelector('#modal-close');
    const btnDone = this.modalEl.querySelector('#btn-settings-close');
    const btnRefresh = this.modalEl.querySelector('#btn-refresh-devices');
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

    const btnCheckUpdates = this.modalEl.querySelector('#btn-check-updates');
    btnCheckUpdates?.addEventListener('click', () => this.checkUpdates());

    btnRefresh?.addEventListener('click', async () => {
      const origText = btnRefresh.innerHTML;
      btnRefresh.innerHTML = '<span class="material-symbols-outlined md-14" style="margin-right: 4px;">autorenew</span> Atualizando...';
      await this.refreshDevices();
      setTimeout(() => {
        if (btnRefresh) btnRefresh.innerHTML = origText;
      }, 500);
    });

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

    selectSpeaker?.addEventListener('change', async () => {
      settingsStore.selectedSpeakerId = selectSpeaker.value;
      settingsStore.save();
      await webRtcManager.setSpeakerDeviceId(selectSpeaker.value);
      soundEffects.setSinkId(selectSpeaker.value);
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
      // If a local (owned) preview is active, restart it on the new device.
      if (this.previewStream && this.previewOwned) {
        await this.startCameraPreview(selectCam.value);
      }
    });

    const btnPreview = this.modalEl.querySelector('#btn-toggle-cam-preview');
    btnPreview?.addEventListener('click', async () => {
      if (this.previewStream) {
        this.stopCameraPreview();
      } else {
        await this.startCameraPreview(selectCam?.value || undefined);
      }
    });

    btnSaveNick?.addEventListener('click', async () => {
      const newNick = inputNick?.value.trim();
      if (!newNick) return;

      // Offline (not connected to a server): persist the nickname locally so it
      // is used on the next connection.
      if (!serverStore.currentUser) {
        connectionStore.saveUserProfile(newNick);
        btnSaveNick.textContent = 'Salvo!';
        setTimeout(() => {
          if (btnSaveNick) btnSaveNick.textContent = 'Salvar';
        }, 1500);
        return;
      }

      if (newNick === serverStore.currentUser?.nickname) return;

      try {
        await networkClient.sendRequest(MessageType.USER_CHANGE_NICKNAME, {
          newNickname: newNick,
        });
        if (serverStore.currentUser) {
          serverStore.currentUser.nickname = newNick;
          serverStore.updateCurrentUser(serverStore.currentUser);
        }
        connectionStore.saveUserProfile(newNick);
        btnSaveNick.textContent = 'Salvo!';
        setTimeout(() => {
          if (btnSaveNick) btnSaveNick.textContent = 'Salvar';
        }, 1500);
      } catch (err: any) {
        this.showError(err.message || 'Erro ao alterar nickname');
      }
    });

    btnChangeAvatar?.addEventListener('click', async () => {
      if (window.api?.selectImageDialog) {
        const file = await window.api.selectImageDialog();
        if (file) {
          // Offline: store the avatar locally only.
          if (!serverStore.currentUser) {
            const preview = document.getElementById('settings-avatar-preview') as HTMLImageElement;
            if (preview) preview.src = file.base64;
            connectionStore.saveUserProfile(connectionStore.savedNickname, file.base64);
            return;
          }
          try {
            await networkClient.sendRequest(MessageType.USER_UPDATE_AVATAR, {
              avatarBase64: file.base64,
              mimeType: 'image/png',
            });
            const preview = document.getElementById('settings-avatar-preview') as HTMLImageElement;
            if (preview) preview.src = file.base64;
            const currentNick = serverStore.currentUser?.nickname || connectionStore.savedNickname;
            connectionStore.saveUserProfile(currentNick, file.base64);
          } catch (err: any) {
            this.showError(err.message || 'Erro ao atualizar foto de perfil');
          }
        }
      }
    });
  }

  private async startCameraPreview(deviceId?: string): Promise<void> {
    const videoEl = document.getElementById('settings-cam-preview') as HTMLVideoElement | null;
    const btn = this.modalEl?.querySelector('#btn-toggle-cam-preview') as HTMLElement | null;
    if (!videoEl) return;

    // Stop any previously-owned preview stream before starting a new one.
    if (this.previewStream && this.previewOwned) {
      this.previewStream.getTracks().forEach((t) => t.stop());
      this.previewStream = null;
    }

    try {
      // Reuse the active in-call camera stream if the camera is already on to
      // avoid grabbing the device twice.
      const activeStream = voiceStore.isCameraOn ? videoService.getCameraStream() : null;
      if (activeStream) {
        this.previewStream = activeStream;
        this.previewOwned = false;
      } else {
        this.previewStream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
          audio: false,
        });
        this.previewOwned = true;
      }
      videoEl.srcObject = this.previewStream;
      videoEl.style.display = 'block';
      if (btn) {
        btn.innerHTML =
          '<span class="material-symbols-outlined md-16" style="margin-right: 4px;">visibility_off</span> Parar pré-visualização';
      }
    } catch (err: any) {
      this.showError(err?.message || 'Não foi possível acessar a câmera');
    }
  }

  private stopCameraPreview(): void {
    const videoEl = document.getElementById('settings-cam-preview') as HTMLVideoElement | null;
    const btn = this.modalEl?.querySelector('#btn-toggle-cam-preview') as HTMLElement | null;
    if (this.previewStream && this.previewOwned) {
      this.previewStream.getTracks().forEach((t) => t.stop());
    }
    this.previewStream = null;
    this.previewOwned = false;
    if (videoEl) {
      videoEl.srcObject = null;
      videoEl.style.display = 'none';
    }
    if (btn) {
      btn.innerHTML =
        '<span class="material-symbols-outlined md-16" style="margin-right: 4px;">visibility</span> Testar / Pré-visualizar câmera';
    }
  }

  private showError(msg: string): void {
    const banner = document.getElementById('settings-error-banner');
    if (banner) {
      banner.innerText = msg;
      banner.classList.add('show');
    }
  }

  private async startVadMeter(): Promise<void> {
    const fill = document.getElementById('vad-meter-fill') as HTMLElement | null;
    const marker = document.getElementById('vad-meter-threshold') as HTMLElement | null;
    if (!fill) return;

    const positionMarker = () => {
      if (marker) marker.style.left = `${(settingsStore.vadSensitivity / 80) * 100}%`;
    };
    positionMarker();

    const draw = () => {
      // Prefer the live in-call analyser; fall back to our own metering stream.
      let level = audioProcessor.getInputLevel();
      if (level < 0 && this.vadMeterAnalyser) {
        const buf = new Uint8Array(this.vadMeterAnalyser.frequencyBinCount);
        this.vadMeterAnalyser.getByteFrequencyData(buf);
        const bins = Math.min(36, buf.length);
        let sum = 0;
        for (let i = 0; i < bins; i++) sum += buf[i];
        level = sum / bins;
      }
      const pct = Math.max(0, Math.min(100, (Math.max(0, level) / 80) * 100));
      fill.style.width = `${pct}%`;
      // Green while below threshold, accent when it would trigger voice.
      fill.style.background =
        level >= settingsStore.vadSensitivity ? 'var(--accent-primary)' : 'var(--accent-online, #3ba55d)';
      positionMarker();
      this.vadMeterRAF = requestAnimationFrame(draw);
    };

    // If the mic isn't already active in a call, open a temporary metering stream.
    if (audioProcessor.getInputLevel() < 0) {
      try {
        this.vadMeterStream = await navigator.mediaDevices.getUserMedia({
          audio: settingsStore.selectedMicrophoneId
            ? { deviceId: { exact: settingsStore.selectedMicrophoneId } }
            : true,
          video: false,
        });
        const Ctor = window.AudioContext || (window as any).webkitAudioContext;
        this.vadMeterCtx = new Ctor();
        const source = this.vadMeterCtx!.createMediaStreamSource(this.vadMeterStream);
        this.vadMeterAnalyser = this.vadMeterCtx!.createAnalyser();
        this.vadMeterAnalyser.fftSize = 256;
        this.vadMeterAnalyser.smoothingTimeConstant = 0.25;
        source.connect(this.vadMeterAnalyser);
      } catch {
        // No mic available — the meter simply stays at zero.
      }
    }

    this.vadMeterRAF = requestAnimationFrame(draw);
  }

  private stopVadMeter(): void {
    if (this.vadMeterRAF !== null) {
      cancelAnimationFrame(this.vadMeterRAF);
      this.vadMeterRAF = null;
    }
    this.vadMeterAnalyser = null;
    if (this.vadMeterCtx && this.vadMeterCtx.state !== 'closed') {
      this.vadMeterCtx.close().catch(() => {});
    }
    this.vadMeterCtx = null;
    if (this.vadMeterStream) {
      this.vadMeterStream.getTracks().forEach((t) => t.stop());
      this.vadMeterStream = null;
    }
  }

  public close(): void {
    this.stopCameraPreview();
    this.stopVadMeter();
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }
}

export const settingsModal = new SettingsModal();
