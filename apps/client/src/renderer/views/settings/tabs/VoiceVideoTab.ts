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
  private unbindPttCapture: (() => void) | null = null;
  private isRecordingPtt = false;

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

      <!-- Input Mode Selector (#186) -->
      <div class="form-group" style="margin-top: 14px;">
        <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
          <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">keyboard_voice</span>
          ${t('settings.inputMode')}
        </label>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <label class="input-mode-card ${settingsStore.inputMode === 'voice_activity' ? 'active' : ''}" id="mode-card-vad" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: var(--bg-card); border: 1px solid ${settingsStore.inputMode === 'voice_activity' ? 'var(--accent-primary)' : 'var(--border-color)'}; border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s;">
            <input type="radio" name="input-mode" value="voice_activity" ${settingsStore.inputMode === 'voice_activity' ? 'checked' : ''} style="margin: 0; cursor: pointer;">
            <div>
              <div style="font-size: 12px; font-weight: 600; color: var(--text-primary);">${t('settings.inputModeVad')}</div>
            </div>
          </label>
          <label class="input-mode-card ${settingsStore.inputMode === 'push_to_talk' ? 'active' : ''}" id="mode-card-ptt" style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: var(--bg-card); border: 1px solid ${settingsStore.inputMode === 'push_to_talk' ? 'var(--accent-primary)' : 'var(--border-color)'}; border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s;">
            <input type="radio" name="input-mode" value="push_to_talk" ${settingsStore.inputMode === 'push_to_talk' ? 'checked' : ''} style="margin: 0; cursor: pointer;">
            <div>
              <div style="font-size: 12px; font-weight: 600; color: var(--text-primary);">${t('settings.inputModePtt')}</div>
            </div>
          </label>
        </div>
      </div>

      <!-- VAD Sensitivity Container -->
      <div id="container-vad-settings" class="form-group" style="display: ${settingsStore.inputMode === 'voice_activity' ? 'block' : 'none'};">
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

      <!-- PTT Configuration Container (#186) -->
      <div id="container-ptt-settings" style="display: ${settingsStore.inputMode === 'push_to_talk' ? 'block' : 'none'}; margin-bottom: 14px;">
        <!-- Shortcut Key Card -->
        <div class="form-group" style="padding: 10px 12px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); margin-bottom: 10px;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
            <div>
              <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px; font-weight: 600;">
                <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">keyboard</span>
                ${t('settings.pttShortcut')}
              </label>
              <div id="ptt-key-desc" style="font-size: 11px; color: var(--text-muted);">
                ${t('settings.pttRecordShortcut')}
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span id="ptt-key-badge" style="font-family: monospace; font-size: 12px; font-weight: 700; background: var(--bg-modifier-selected, rgba(255,255,255,0.08)); padding: 4px 10px; border-radius: 4px; border: 1px solid var(--border-color); color: var(--text-primary); min-width: 48px; text-align: center;">
                ${settingsStore.pttKey?.display || 'V'}
              </span>
              <button id="btn-record-ptt-key" class="btn btn-secondary" style="font-size: 11px; padding: 4px 10px; height: 28px;">
                ${t('settings.pttRecordShortcut')}
              </button>
            </div>
          </div>
        </div>

        <!-- Release Delay Slider -->
        <div class="form-group" style="margin-bottom: 10px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 0;">
              <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">timer</span>
              ${t('settings.pttReleaseDelay')}
            </label>
            <span id="ptt-delay-value" style="font-size: 11px; font-weight: 700; color: var(--accent-primary);">
              ${settingsStore.pttReleaseDelay} ms
            </span>
          </div>
          <input id="slider-ptt-delay" class="sb-slider" type="range" min="0" max="2000" step="50" value="${settingsStore.pttReleaseDelay}" style="--slider-progress: ${(Math.min(2000, Math.max(0, settingsStore.pttReleaseDelay)) / 2000) * 100}%; width: 100%;">
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
            ${t('settings.pttReleaseDelayDesc')}
          </div>
        </div>

        <!-- Sound Cue Toggle -->
        <div class="form-group" style="padding: 10px 12px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
            <div>
              <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px; cursor: pointer; font-weight: 600;" for="checkbox-ptt-sound">
                <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">volume_up</span>
                ${t('settings.pttSoundCue')}
              </label>
              <div style="font-size: 11px; color: var(--text-muted);">
                ${t('settings.pttSoundCueDesc')}
              </div>
            </div>
            <label class="toggle-switch" aria-label="${t('settings.pttSoundCue')}">
              <input id="checkbox-ptt-sound" type="checkbox" ${settingsStore.pttSoundCue ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
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

    // Input Mode Radio & Container toggles (#186)
    const radioInputModes = container.querySelectorAll<HTMLInputElement>('input[name="input-mode"]');
    const containerVad = container.querySelector<HTMLElement>('#container-vad-settings');
    const containerPtt = container.querySelector<HTMLElement>('#container-ptt-settings');
    const modeCardVad = container.querySelector<HTMLElement>('#mode-card-vad');
    const modeCardPtt = container.querySelector<HTMLElement>('#mode-card-ptt');

    radioInputModes.forEach((radio) => {
      radio.addEventListener('change', () => {
        const mode = radio.value as 'voice_activity' | 'push_to_talk';
        settingsStore.inputMode = mode;
        settingsStore.save();
        audioProcessor.syncPttConfig();
        audioProcessor.applyTrackEnabled();

        if (mode === 'voice_activity') {
          if (containerVad) containerVad.style.display = 'block';
          if (containerPtt) containerPtt.style.display = 'none';
          modeCardVad?.classList.add('active');
          if (modeCardVad) modeCardVad.style.borderColor = 'var(--accent-primary)';
          modeCardPtt?.classList.remove('active');
          if (modeCardPtt) modeCardPtt.style.borderColor = 'var(--border-color)';
        } else {
          if (containerVad) containerVad.style.display = 'none';
          if (containerPtt) containerPtt.style.display = 'block';
          modeCardVad?.classList.remove('active');
          if (modeCardVad) modeCardVad.style.borderColor = 'var(--border-color)';
          modeCardPtt?.classList.add('active');
          if (modeCardPtt) modeCardPtt.style.borderColor = 'var(--accent-primary)';
        }
      });
    });

    // PTT Release Delay Slider
    const sliderPttDelay = container.querySelector<HTMLInputElement>('#slider-ptt-delay');
    const pttDelayValue = container.querySelector<HTMLElement>('#ptt-delay-value');
    sliderPttDelay?.addEventListener('input', () => {
      const val = parseInt(sliderPttDelay.value, 10);
      sliderPttDelay.style.setProperty('--slider-progress', `${(Math.min(2000, Math.max(0, val)) / 2000) * 100}%`);
      if (pttDelayValue) pttDelayValue.textContent = `${val} ms`;
      settingsStore.pttReleaseDelay = val;
      settingsStore.save();
    });

    // PTT Sound Cue Checkbox
    const checkboxPttSound = container.querySelector<HTMLInputElement>('#checkbox-ptt-sound');
    checkboxPttSound?.addEventListener('change', () => {
      settingsStore.pttSoundCue = checkboxPttSound.checked;
      settingsStore.save();
    });

    // PTT Record Key Button
    const btnRecordPtt = container.querySelector<HTMLButtonElement>('#btn-record-ptt-key');
    const pttBadge = container.querySelector<HTMLElement>('#ptt-key-badge');
    const pttDesc = container.querySelector<HTMLElement>('#ptt-key-desc');

    const stopPttRecording = () => {
      this.isRecordingPtt = false;
      if (this.unbindPttCapture) {
        this.unbindPttCapture();
        this.unbindPttCapture = null;
      }
      if (window.api?.stopPttCapture) {
        window.api.stopPttCapture().catch(() => {});
      }
      if (btnRecordPtt) {
        btnRecordPtt.textContent = t('settings.pttRecordShortcut');
        btnRecordPtt.classList.remove('btn-primary');
      }
      if (pttDesc) {
        pttDesc.textContent = t('settings.pttRecordShortcut');
      }
      if (pttBadge) {
        pttBadge.textContent = settingsStore.pttKey?.display || 'V';
      }
    };

    btnRecordPtt?.addEventListener('click', () => {
      if (this.isRecordingPtt) {
        stopPttRecording();
        return;
      }

      this.isRecordingPtt = true;
      btnRecordPtt.textContent = t('settings.pttRecordingPrompt');
      btnRecordPtt.classList.add('btn-primary');
      if (pttDesc) {
        pttDesc.textContent = t('settings.pttRecordingPrompt');
      }

      if (window.api?.startPttCapture) {
        window.api.startPttCapture().catch(() => {});
      }

      const onCaptured = (binding: any) => {
        settingsStore.pttKey = binding;
        settingsStore.save();
        audioProcessor.syncPttConfig();
        stopPttRecording();
      };

      if (window.api?.onPttCaptured) {
        this.unbindPttCapture = window.api.onPttCaptured((binding) => {
          onCaptured(binding);
        });
      }

      const handleLocalCaptureKey = (e: KeyboardEvent) => {
        if (!this.isRecordingPtt) return;
        e.preventDefault();
        e.stopPropagation();
        window.removeEventListener('keydown', handleLocalCaptureKey, true);
        window.removeEventListener('mousedown', handleLocalCaptureMouse, true);

        const keyName = e.key === ' ' ? 'Space' : e.key;
        const display = e.code === 'Space' ? 'Espaço' : (e.key.length === 1 ? e.key.toUpperCase() : e.key);
        onCaptured({
          code: e.code,
          display,
          keyType: 'keyboard',
        });
      };

      const handleLocalCaptureMouse = (e: MouseEvent) => {
        if (!this.isRecordingPtt) return;
        e.preventDefault();
        e.stopPropagation();
        window.removeEventListener('keydown', handleLocalCaptureKey, true);
        window.removeEventListener('mousedown', handleLocalCaptureMouse, true);

        let button = e.button + 1;
        if (e.button === 1) button = 3;
        else if (e.button === 2) button = 2;
        const buttonNames: Record<number, string> = {
          1: 'Mouse 1 (Esquerdo)',
          2: 'Mouse 2 (Direito)',
          3: 'Mouse 3 (Scroll)',
          4: 'Mouse 4 (Lateral Traseiro)',
          5: 'Mouse 5 (Lateral Frontal)',
        };
        onCaptured({
          code: `Mouse${button}`,
          display: buttonNames[button] || `Mouse ${button}`,
          keyType: 'mouse',
          mouseButton: button,
        });
      };

      window.addEventListener('keydown', handleLocalCaptureKey, true);
      window.addEventListener('mousedown', handleLocalCaptureMouse, true);
    });

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

  public cleanup(): void {
    if (this.isRecordingPtt) {
      this.isRecordingPtt = false;
      if (this.unbindPttCapture) {
        this.unbindPttCapture();
        this.unbindPttCapture = null;
      }
      if (window.api?.stopPttCapture) {
        window.api.stopPttCapture().catch(() => {});
      }
    }
    this.stopVadMeter();
    this.stopCameraPreview();
  }
}
