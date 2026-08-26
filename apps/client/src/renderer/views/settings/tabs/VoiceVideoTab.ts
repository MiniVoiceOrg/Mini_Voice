import { settingsStore } from '../../../stores/settingsStore';
import { audioProcessor } from '../../../core/AudioProcessor';
import { videoService } from '../../../core/VideoService';
import { t } from '../../../i18n';

export class VoiceVideoTab {
  private previewStream: MediaStream | null = null;
  private previewOwned = false;
  private vadMeterStream: MediaStream | null = null;
  private vadMeterCtx: AudioContext | null = null;
  private vadMeterAnalyser: AnalyserNode | null = null;
  private vadMeterRAF: number | null = null;

  public renderHtml(): string {
    return `
      <!-- Device Header with Refresh Button -->
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        <span style="font-size: 13px; font-weight: 700; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.5px;">
          ${t('settings.devicesSection')}
        </span>
        <button id="btn-refresh-devices" class="btn btn-secondary" style="font-size: 11px; padding: 3px 8px; height: 26px;" title="${t('settings.refreshDevicesTitle')}">
          <span class="material-symbols-outlined md-14" style="margin-right: 4px;">refresh</span>
          ${t('settings.refreshDevices')}
        </button>
      </div>

      <!-- Audio Inputs -->
      <div class="form-group">
        <label style="display: flex; align-items: center; gap: 6px;">
          <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">mic</span>
          ${t('settings.microphone')}
        </label>
        <select id="select-mic">
          <option value="">${t('settings.loadingMics')}</option>
        </select>
      </div>

      <div class="form-group">
        <label style="display: flex; align-items: center; gap: 6px;">
          <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">tune</span>
          ${t('settings.vadLabel')}
        </label>
        <div style="display: flex; align-items: center; gap: 12px;">
          <input id="slider-vad" class="sb-slider" type="range" min="0" max="160" value="${settingsStore.vadSensitivity}" style="--slider-progress: ${(Math.min(160, Math.max(0, settingsStore.vadSensitivity)) / 160) * 100}%; flex: 1;">
        </div>
        <div id="vad-meter" class="vad-meter" title="${t('settings.vadMeterTitle')}">
          <div id="vad-meter-fill" class="vad-meter-fill"></div>
          <div id="vad-meter-threshold" class="vad-meter-threshold"></div>
        </div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${t('settings.vadHint')}</div>
      </div>

      <!-- RNNoise Noise Suppression -->
      <div class="form-group" style="padding: 10px 12px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
          <div>
            <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px; cursor: pointer; font-weight: 600;" for="checkbox-rnnoise">
              <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">graphic_eq</span>
              ${t('settings.rnnoiseLabel')}
            </label>
            <div style="font-size: 11px; color: var(--text-muted);">
              ${t('settings.rnnoiseDesc')}
            </div>
          </div>
          <label class="toggle-switch" aria-label="${t('settings.rnnoiseLabel')}">
            <input id="checkbox-rnnoise" type="checkbox" ${settingsStore.noiseSuppressionEnabled ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <!-- Audio Outputs -->
      <div class="form-group" id="group-speaker">
        <label style="display: flex; align-items: center; gap: 6px;">
          <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">headphones</span>
          ${t('settings.outputDevice')}
        </label>
        <select id="select-speaker">
          <option value="">${t('settings.loadingOutputs')}</option>
        </select>
      </div>

      <!-- Camera Inputs -->
      <div class="form-group" id="group-camera" style="border-top: 1px solid var(--border-color); padding-top: 14px; margin-top: 14px;">
        <label style="display: flex; align-items: center; gap: 6px;">
          <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">videocam</span>
          ${t('settings.camera')}
        </label>
        <select id="select-cam">
          <option value="">${t('settings.loadingCameras')}</option>
        </select>
        <div style="margin-top: 8px;">
          <button id="btn-toggle-cam-preview" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;">
            <span class="material-symbols-outlined md-16" style="margin-right: 4px;">visibility</span>
            ${t('settings.previewCamera')}
          </button>
        </div>
        <video id="settings-cam-preview" class="settings-cam-preview" autoplay playsinline muted style="display: none;"></video>
      </div>

      <!-- Screen Share -->
      <div style="border-top: 1px solid var(--border-color); padding-top: 14px; margin-top: 14px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
          <span style="font-size: 13px; font-weight: 700; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">
            <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">screen_share</span>
            ${t('settings.screenShareSection')}
          </span>
        </div>

        <div class="form-group" style="padding: 10px 12px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); margin-bottom: 12px;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
            <div>
              <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px; cursor: pointer; font-weight: 600;" for="checkbox-screen-telemetry">
                <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">monitoring</span>
                ${t('settings.telemetryLabel')}
              </label>
              <div style="font-size: 11px; color: var(--text-muted);">
                ${t('settings.telemetryDesc')}
              </div>
            </div>
            <label class="toggle-switch" aria-label="${t('settings.telemetryLabel')}">
              <input id="checkbox-screen-telemetry" type="checkbox" ${settingsStore.screenShareTelemetryEnabled ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div class="form-group" style="margin-bottom: 12px;">
          <label for="select-screen-telemetry-position">${t('settings.telemetryPosition')}</label>
          <select id="select-screen-telemetry-position">
            <option value="top-right" ${settingsStore.screenShareTelemetryPosition === 'top-right' ? 'selected' : ''}>${t('settings.positionTopRight')}</option>
            <option value="top-left" ${settingsStore.screenShareTelemetryPosition === 'top-left' ? 'selected' : ''}>${t('settings.positionTopLeft')}</option>
            <option value="bottom-right" ${settingsStore.screenShareTelemetryPosition === 'bottom-right' ? 'selected' : ''}>${t('settings.positionBottomRight')}</option>
            <option value="bottom-left" ${settingsStore.screenShareTelemetryPosition === 'bottom-left' ? 'selected' : ''}>${t('settings.positionBottomLeft')}</option>
          </select>
        </div>

        <div class="form-group" style="margin-bottom: 0;">
          <label for="select-screen-telemetry-mode">${t('settings.telemetryMode')}</label>
          <select id="select-screen-telemetry-mode">
            <option value="simple" ${settingsStore.screenShareTelemetryMode === 'simple' ? 'selected' : ''}>${t('settings.telemetryModeSimple')}</option>
            <option value="complete" ${settingsStore.screenShareTelemetryMode === 'complete' ? 'selected' : ''}>${t('settings.telemetryModeComplete')}</option>
          </select>
        </div>
      </div>
    `;
  }

  public attachEvents(container: HTMLElement): void {
    const selectMic = container.querySelector<HTMLSelectElement>('#select-mic');
    const selectSpeaker = container.querySelector<HTMLSelectElement>('#select-speaker');
    const selectCam = container.querySelector<HTMLSelectElement>('#select-cam');
    const sliderVad = container.querySelector<HTMLInputElement>('#slider-vad');
    const checkboxRnnoise = container.querySelector<HTMLInputElement>('#checkbox-rnnoise');
    const btnToggleCamPreview = container.querySelector<HTMLButtonElement>('#btn-toggle-cam-preview');
    const btnRefreshDevices = container.querySelector<HTMLButtonElement>('#btn-refresh-devices');
    const checkboxScreenTelemetry = container.querySelector<HTMLInputElement>('#checkbox-screen-telemetry');
    const selectScreenTelemetryPos = container.querySelector<HTMLSelectElement>('#select-screen-telemetry-position');
    const selectScreenTelemetryMode = container.querySelector<HTMLSelectElement>('#select-screen-telemetry-mode');

    selectMic?.addEventListener('change', async () => {
      settingsStore.selectedMicrophoneId = selectMic.value;
      settingsStore.save();
      this.restartVadMeter();
    });

    selectSpeaker?.addEventListener('change', () => {
      settingsStore.selectedSpeakerId = selectSpeaker.value;
      settingsStore.save();
    });

    selectCam?.addEventListener('change', () => {
      settingsStore.selectedCameraId = selectCam.value;
      settingsStore.save();
      if (this.previewStream) {
        this.startCameraPreview(container);
      }
    });

    sliderVad?.addEventListener('input', () => {
      const val = parseInt(sliderVad.value, 10);
      sliderVad.style.setProperty('--slider-progress', `${(Math.min(160, Math.max(0, val)) / 160) * 100}%`);
      settingsStore.vadSensitivity = val;
      settingsStore.save();
      audioProcessor.setVadThreshold(val);
      this.updateVadThresholdLine(container, val);
    });

    checkboxRnnoise?.addEventListener('change', async () => {
      const enabled = checkboxRnnoise.checked;
      settingsStore.noiseSuppressionEnabled = enabled;
      settingsStore.save();
      await audioProcessor.setNoiseSuppression(enabled);
    });

    btnToggleCamPreview?.addEventListener('click', () => {
      if (this.previewStream) {
        this.stopCameraPreview(container);
      } else {
        this.startCameraPreview(container);
      }
    });

    btnRefreshDevices?.addEventListener('click', async () => {
      await this.refreshDevices(container);
    });

    checkboxScreenTelemetry?.addEventListener('change', () => {
      settingsStore.screenShareTelemetryEnabled = checkboxScreenTelemetry.checked;
      settingsStore.save();
    });

    selectScreenTelemetryPos?.addEventListener('change', () => {
      settingsStore.screenShareTelemetryPosition = selectScreenTelemetryPos.value as any;
      settingsStore.save();
    });

    selectScreenTelemetryMode?.addEventListener('change', () => {
      settingsStore.screenShareTelemetryMode = selectScreenTelemetryMode.value as any;
      settingsStore.save();
    });

    this.updateVadThresholdLine(container, settingsStore.vadSensitivity);
  }

  public async refreshDevices(container: HTMLElement): Promise<void> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const selectMic = container.querySelector<HTMLSelectElement>('#select-mic');
      const selectSpeaker = container.querySelector<HTMLSelectElement>('#select-speaker');
      const selectCam = container.querySelector<HTMLSelectElement>('#select-cam');

      const mics = devices.filter((d) => d.kind === 'audioinput');
      const speakers = devices.filter((d) => d.kind === 'audiooutput');
      const cams = devices.filter((d) => d.kind === 'videoinput');

      if (selectMic) {
        selectMic.innerHTML = mics
          .map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === settingsStore.selectedMicrophoneId ? 'selected' : ''}>${d.label || `${t('settings.microphone')} ${i + 1}`}</option>`)
          .join('') || `<option value="">${t('settings.noMicDetected')}</option>`;
      }

      if (selectSpeaker) {
        selectSpeaker.innerHTML = speakers
          .map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === settingsStore.selectedSpeakerId ? 'selected' : ''}>${d.label || `${t('settings.outputDevice')} ${i + 1}`}</option>`)
          .join('') || `<option value="">${t('settings.defaultSpeaker')}</option>`;
      }

      if (selectCam) {
        selectCam.innerHTML = cams
          .map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === settingsStore.selectedCameraId ? 'selected' : ''}>${d.label || `${t('settings.camera')} ${i + 1}`}</option>`)
          .join('') || `<option value="">${t('settings.noCameraDetected')}</option>`;
      }
    } catch (e) {
      console.warn('[VoiceVideoTab] Error enumerating devices:', e);
    }
  }

  private updateVadThresholdLine(container: HTMLElement, threshold: number): void {
    const line = container.querySelector<HTMLElement>('#vad-meter-threshold');
    if (line) {
      const pct = Math.min(100, Math.max(0, (threshold / 160) * 100));
      line.style.left = `${pct}%`;
    }
  }

  public startVadMeter(container: HTMLElement): void {
    this.stopVadMeter();

    const runMeterLoop = (analyser: AnalyserNode) => {
      const fill = container.querySelector<HTMLElement>('#vad-meter-fill');
      const meter = container.querySelector<HTMLElement>('#vad-meter');
      if (!fill || !meter) return;

      const bufferLength = analyser.frequencyBinCount;
      const buffer = new Uint8Array(bufferLength);
      const speechBins = Math.min(36, bufferLength);

      const loop = () => {
        analyser.getByteFrequencyData(buffer);
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < speechBins; i++) {
          const val = buffer[i];
          sum += val;
          if (val > peak) peak = val;
        }
        const average = sum / speechBins;
        const targetAvg = Math.max(16, settingsStore.vadSensitivity * 0.8);
        const targetPeak = Math.max(42, settingsStore.vadSensitivity * 1.8);
        const isActive = (average > targetAvg && peak > targetPeak) || average > targetAvg * 1.4;

        const meterLevel = Math.min(100, (peak / 255) * 100);
        fill.style.width = `${meterLevel}%`;
        fill.classList.toggle('active', isActive);

        this.vadMeterRAF = requestAnimationFrame(loop);
      };
      this.vadMeterRAF = requestAnimationFrame(loop);
    };

    const micStream = audioProcessor.getLocalAudioStream();
    if (micStream && micStream.active && micStream.getAudioTracks().length > 0) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        this.vadMeterCtx = new AudioCtx();
        const src = this.vadMeterCtx.createMediaStreamSource(micStream);
        this.vadMeterAnalyser = this.vadMeterCtx.createAnalyser();
        this.vadMeterAnalyser.fftSize = 256;
        src.connect(this.vadMeterAnalyser);
        runMeterLoop(this.vadMeterAnalyser);
        return;
      } catch {}
    }

    const deviceId = settingsStore.selectedMicrophoneId || undefined;
    navigator.mediaDevices
      ?.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true, video: false })
      .then((stream) => {
        this.vadMeterStream = stream;
        try {
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          this.vadMeterCtx = new AudioCtx();
          const src = this.vadMeterCtx.createMediaStreamSource(stream);
          this.vadMeterAnalyser = this.vadMeterCtx.createAnalyser();
          this.vadMeterAnalyser.fftSize = 256;
          src.connect(this.vadMeterAnalyser);
          runMeterLoop(this.vadMeterAnalyser);
        } catch {}
      })
      .catch(() => {});
  }

  private restartVadMeter(container?: HTMLElement): void {
    const parent = container || document.getElementById('tab-panel-voice_video');
    if (parent) {
      this.startVadMeter(parent);
    }
  }

  public stopVadMeter(): void {
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

  private async startCameraPreview(container: HTMLElement): Promise<void> {
    this.stopCameraPreview(container);
    const video = container.querySelector<HTMLVideoElement>('#settings-cam-preview');
    const btn = container.querySelector<HTMLButtonElement>('#btn-toggle-cam-preview');
    if (!video) return;

    try {
      const liveStream = videoService.getCameraStream();
      if (liveStream && liveStream.active) {
        this.previewStream = liveStream;
        this.previewOwned = false;
      } else {
        const deviceId = settingsStore.selectedCameraId || undefined;
        this.previewStream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
          audio: false,
        });
        this.previewOwned = true;
      }

      video.srcObject = this.previewStream;
      video.style.display = 'block';
      if (btn) {
        btn.innerHTML = `<span class="material-symbols-outlined md-16" style="margin-right: 4px;">visibility_off</span>${t('settings.stopPreview')}`;
      }
    } catch (e) {
      console.warn('[VoiceVideoTab] Could not start camera preview:', e);
    }
  }

  public stopCameraPreview(container?: HTMLElement): void {
    const parent = container || document.getElementById('tab-panel-voice_video');
    const video = parent?.querySelector<HTMLVideoElement>('#settings-cam-preview');
    const btn = parent?.querySelector<HTMLButtonElement>('#btn-toggle-cam-preview');

    if (this.previewStream && this.previewOwned) {
      this.previewStream.getTracks().forEach((t) => t.stop());
    }
    this.previewStream = null;
    this.previewOwned = false;

    if (video) {
      video.srcObject = null;
      video.style.display = 'none';
    }
    if (btn) {
      btn.innerHTML = `<span class="material-symbols-outlined md-16" style="margin-right: 4px;">visibility</span>${t('settings.previewCamera')}`;
    }
  }
}
