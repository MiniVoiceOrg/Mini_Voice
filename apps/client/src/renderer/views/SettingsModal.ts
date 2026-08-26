import { MessageType, QUALITY_PRESETS, QualityPresetType, DEFAULT_CUSTOM_PROFILE, QualityProfile } from '@monky/shared';
import { appEvents } from '../core/EventBus';
import { networkClient } from '../core/NetworkClient';
import { escapeHtml } from '../utils/html';
import { audioProcessor } from '../core/AudioProcessor';
import { serverStore } from '../stores/serverStore';
import { settingsStore } from '../stores/settingsStore';
import { voiceStore } from '../stores/voiceStore';
import { webRtcManager } from '../core/WebRtcManager';
import { videoService } from '../core/VideoService';
import { soundEffects, getSoundLabels, SoundEffectType } from '../core/SoundEffects';
import { connectionStore } from '../stores/connectionStore';
import { getAvatarUrl } from '../utils/avatar';
import { updateService } from '../core/UpdateService';
import { soundboardService } from '../core/SoundboardService';
import { getLanguage, setLanguage, SUPPORTED_LANGUAGES, t, tCount, type SupportedLanguage } from '../i18n';
import { showAlert } from './Dialog';
import { showIdentityExportDialog, showIdentityImportDialog } from './IdentityDialogs';

const IDEAS_URL = 'https://github.com/MonkyOrg/Monky/discussions/categories/ideias';
const NEW_IDEA_URL = 'https://github.com/MonkyOrg/Monky/discussions/new?category=ideias';
const NEW_ISSUE_URL = 'https://github.com/MonkyOrg/Monky/issues/new/choose';

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
    this.modalEl.className = 'modal-backdrop modal-backdrop--settings';
    this.modalEl.innerHTML = `
      <div class="modal-card settings-modal-card">
        <!-- Sidebar Navigation -->
        <div class="settings-sidebar">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: var(--text-muted); padding: 4px 10px 8px;">
            ${t('connection.settingsTitle')}
          </div>
          <button type="button" class="settings-tab-btn active" data-tab="account">
            <span class="material-symbols-outlined md-18">person</span>
            <span>${t('settings.tabAccount')}</span>
          </button>
          <button type="button" class="settings-tab-btn" data-tab="voice_video">
            <span class="material-symbols-outlined md-18">mic</span>
            <span>${t('settings.tabVoiceVideo')}</span>
          </button>
          <button type="button" class="settings-tab-btn" data-tab="soundboard">
            <span class="material-symbols-outlined md-18">music_note</span>
            <span>${t('settings.tabSoundboard')}</span>
          </button>
          <button type="button" class="settings-tab-btn" data-tab="notifications">
            <span class="material-symbols-outlined md-18">notifications</span>
            <span>${t('settings.tabNotifications')}</span>
          </button>
          <button type="button" class="settings-tab-btn" data-tab="quality">
            <span class="material-symbols-outlined md-18">speed</span>
            <span>${t('settings.tabQuality')}</span>
          </button>
          <div style="height: 1px; background: var(--border-color); margin: 6px 4px;"></div>
          <button type="button" class="settings-tab-btn" data-tab="about">
            <span class="material-symbols-outlined md-18">info</span>
            <span>${t('settings.tabAbout')}</span>
          </button>
        </div>

        <!-- Main Content Area -->
        <div class="settings-main-container">
          <!-- Top Header -->
          <div class="settings-content-header">
            <button id="modal-close" class="settings-back-btn" title="${t('common.back')} (ESC)">
              <span class="material-symbols-outlined md-18">close</span>
              <span class="esc-hint">ESC</span>
            </button>
            <div id="settings-current-tab-title" style="font-size: 16px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
              <span class="material-symbols-outlined" style="color: var(--accent-primary);">person</span>
              <span>${t('settings.tabAccount')}</span>
            </div>
            <div></div>
          </div>

          <!-- Body Scroll Container -->
          <div class="settings-content-body">
            <div id="settings-error-banner" class="error-banner"></div>

            <!-- Tab: account -->
            <div class="settings-tab-panel" id="tab-panel-account">
              <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
                ${t('settings.accountIntro')}
              </div>
              <!-- Nickname & Profile -->
              <div style="display: flex; gap: 16px; align-items: center; padding: 14px; background: var(--bg-card); border-radius: var(--radius-md); margin-bottom: 16px; border: 1px solid var(--border-color);">
                <div id="settings-avatar-wrapper" class="settings-avatar-wrapper" title="${t('settings.avatarTitle')}">
                  <img id="settings-avatar-preview" class="settings-avatar-img" src="${serverStore.currentUser?.avatarUrl ? getAvatarUrl(serverStore.currentUser.avatarUrl) : (connectionStore.savedAvatarBase64 || getAvatarUrl(null))}" alt="Avatar">
                  <div class="settings-avatar-overlay">
                    <span class="material-symbols-outlined md-20">photo_camera</span>
                  </div>
                </div>
                <div style="flex: 1;">
                  <div class="form-group" style="margin-bottom: 0;">
                    <label>${t('connection.nicknameLabel')}</label>
                    <div style="display: flex; gap: 8px; margin-top: 6px;">
                      <input id="settings-nickname-input" type="text" value="${serverStore.currentUser?.nickname || connectionStore.savedNickname || ''}" style="flex: 1;" maxlength="32">
                      <button id="btn-save-nickname" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;">${t('common.save')}</button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Language (#16) -->
              <div class="form-group" style="border-top: 1px solid var(--border-color); padding-top: 14px; margin-top: 14px;">
                <label style="display: flex; align-items: center; gap: 6px;" for="select-language">
                  <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">language</span>
                  ${t('settings.languageSection')}
                </label>
                <select id="select-language">
                  ${SUPPORTED_LANGUAGES.map(
                    (lang) =>
                      `<option value="${lang.code}" ${lang.code === getLanguage() ? 'selected' : ''}>${lang.label}</option>`
                  ).join('')}
                </select>
                <small style="display: block; margin-top: 6px; color: var(--text-muted); font-size: 11px;">
                  ${t('settings.languageHint')}
                </small>
              </div>

              <div class="form-group" style="border-top: 1px solid var(--border-color); padding-top: 14px; margin-top: 14px;">
                <label style="display: flex; align-items: center; gap: 6px;">
                  <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">manage_accounts</span>
                  ${t('identity.sectionTitle')}
                </label>
                <div style="padding: 12px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
                  <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.45; margin-bottom: 10px;">
                    ${connectionStore.hasIdentity ? t('identity.sectionReady') : t('identity.sectionMissing')}
                  </div>
                  <div style="display: grid; gap: 6px; margin-bottom: 12px;">
                    <div style="font-size: 11px; color: var(--text-muted);">
                      ${t('identity.clientIdLabel')}
                      <div style="font-family: var(--font-mono); color: var(--text-primary); word-break: break-all;">${escapeHtml(connectionStore.clientId || '—')}</div>
                    </div>
                    <div style="font-size: 11px; color: var(--text-muted);">
                      ${t('identity.publicKeyLabel')}
                      <div style="font-family: var(--font-mono); color: var(--text-primary); word-break: break-all;">${escapeHtml(connectionStore.publicKey || '—')}</div>
                    </div>
                  </div>
                  <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button type="button" id="btn-export-identity" class="btn btn-secondary" ${connectionStore.hasIdentity ? '' : 'disabled'}>
                      <span class="material-symbols-outlined md-16" style="margin-right: 4px;">qr_code_2</span>
                      ${t('identity.exportAction')}
                    </button>
                    <button type="button" id="btn-import-identity-settings" class="btn btn-secondary">
                      <span class="material-symbols-outlined md-16" style="margin-right: 4px;">qr_code_scanner</span>
                      ${t('identity.importAction')}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Tab: voice_video -->
            <div class="settings-tab-panel" id="tab-panel-voice_video" style="display: none;">
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
            </div>

            <!-- Tab: soundboard -->
            <div class="settings-tab-panel" id="tab-panel-soundboard" style="display: none;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                <span style="font-size: 13px; font-weight: 700; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">
                  <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">music_note</span>
                  ${t('settings.soundboardSection')}
                </span>
              </div>

              <div class="form-group" style="margin-bottom: 12px;">
                <label>${t('settings.soundFolder')}</label>
                <div style="display: flex; gap: 8px; align-items: center;">
                  <input id="input-soundboard-path" type="text" readonly value="${settingsStore.soundboardFolderPath || ''}" placeholder="${t('settings.noFolderPlaceholder')}" style="flex: 1; font-size: 12px; cursor: pointer;">
                  <button type="button" id="btn-select-soundboard-folder" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px; white-space: nowrap;">
                    <span class="material-symbols-outlined md-14" style="margin-right: 4px;">folder_open</span>
                    ${t('soundboard.chooseFolder')}
                  </button>
                </div>
                <div id="soundboard-folder-info" style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                  ${settingsStore.soundboardFolderPath ? tCount('settings.soundsFound', soundboardService.getSounds().length) : t('settings.soundFormatsHint')}
                </div>
              </div>

              <div class="form-group" style="margin-bottom: 12px;">
                <label style="display: flex; align-items: center; justify-content: space-between;">
                  <span>${t('settings.soundboardVolume')}</span>
                  <span id="soundboard-vol-val" style="font-family: var(--font-mono); font-size: 12px;">${settingsStore.soundboardVolume}%</span>
                </label>
                <input id="slider-soundboard-vol" class="sb-slider" type="range" min="0" max="100" value="${settingsStore.soundboardVolume}" style="--slider-progress: ${settingsStore.soundboardVolume}%; width: 100%;">
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                  ${t('settings.soundboardVolumeDesc')}
                </div>
              </div>

              <div class="form-group" style="padding: 10px 12px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                  <div>
                    <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px; cursor: pointer; font-weight: 600;" for="checkbox-soundboard-mute">
                      <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">volume_off</span>
                      ${t('settings.soundboardMute')}
                    </label>
                    <div style="font-size: 11px; color: var(--text-muted);">
                      ${t('settings.soundboardMuteDesc')}
                    </div>
                  </div>
                  <label class="toggle-switch" aria-label="${t('settings.soundboardMute')}">
                    <input id="checkbox-soundboard-mute" type="checkbox" ${settingsStore.soundboardMuted ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
            </div>

            <!-- Tab: notifications -->
            <div class="settings-tab-panel" id="tab-panel-notifications" style="display: none;">
              <!-- Chat Notifications -->
              <div class="form-group" style="margin-bottom: 16px;">
                <label style="display: flex; align-items: center; gap: 6px;">
                  <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">chat</span>
                  ${t('settings.chatNotifications')}
                </label>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                  ${t('settings.chatNotificationsDesc')}
                </div>
                <div class="form-group" style="padding: 10px 12px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); margin-top: 8px; margin-bottom: 10px;">
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                    <div>
                      <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px; cursor: pointer; font-weight: 600;" for="checkbox-chat-sound">
                        <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">notifications_active</span>
                        Tocar som ao receber mensagens
                      </label>
                      <div style="font-size: 11px; color: var(--text-muted);">
                        Reproduz um breve som quando uma nova mensagem de outra pessoa chega em qualquer canal de texto.
                      </div>
                    </div>
                    <label class="toggle-switch" aria-label="Tocar som ao receber mensagens">
                      <input id="checkbox-chat-sound" type="checkbox" ${settingsStore.chatMessageSoundEnabled ? 'checked' : ''}>
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                </div>
                <div class="form-group" style="padding: 10px 12px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); margin-bottom: 0;">
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                    <div>
                      <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px; cursor: pointer; font-weight: 600;" for="checkbox-chat-sound-mentions">
                        <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">alternate_email</span>
                        ${t('settings.chatSoundMentionsOnly')}
                      </label>
                      <div style="font-size: 11px; color: var(--text-muted);">
                        Toca o som somente quando seu apelido for citado na mensagem (ex.: @seu_apelido).
                      </div>
                    </div>
                    <label class="toggle-switch" aria-label="${t('settings.chatSoundMentionsOnly')}">
                      <input id="checkbox-chat-sound-mentions" type="checkbox" ${settingsStore.chatMessageSoundMentionsOnly ? 'checked' : ''}>
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                </div>
              </div>

              <!-- Custom Sounds -->
              <div class="form-group" style="border-top: 1px solid var(--border-color); padding-top: 14px;">
                <label style="display: flex; align-items: center; gap: 6px;">
                  <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">music_note</span>
                  ${t('settings.customSounds')}
                </label>
                <div id="custom-sounds-list" style="display: flex; flex-direction: column; gap: 6px; margin-top: 6px;">
                  ${this.getCustomSoundsHtml()}
                </div>
                <button id="btn-reset-all-sounds" class="btn btn-secondary" style="margin-top: 8px; font-size: 11px; padding: 4px 10px;">
                  <span class="material-symbols-outlined md-14" style="margin-right: 4px;">restart_alt</span>
                  ${t('settings.resetAllSounds')}
                </button>
              </div>
            </div>

            <!-- Tab: quality -->
            <div class="settings-tab-panel" id="tab-panel-quality" style="display: none;">
              <!-- Quality Preset -->
              <div class="form-group">
                <label style="display: flex; align-items: center; gap: 6px;">
                  <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">speed</span>
                  ${t('settings.qualitySection')}
                  <span class="material-symbols-outlined md-16" style="color: var(--text-muted); cursor: help;" title="${t('settings.qualityHelp')}">help</span>
                </label>
                <select id="select-preset">
                  <option value="ECONOMIC" ${settingsStore.qualityPreset === 'ECONOMIC' ? 'selected' : ''}>${t('settings.presetEconomic')}</option>
                  <option value="NORMAL" ${settingsStore.qualityPreset === 'NORMAL' ? 'selected' : ''}>${t('settings.presetNormal')}</option>
                  <option value="HIGH" ${settingsStore.qualityPreset === 'HIGH' ? 'selected' : ''}>${t('settings.presetHigh')}</option>
                  <option value="GAMING" ${settingsStore.qualityPreset === 'GAMING' ? 'selected' : ''}>${t('settings.presetGaming')}</option>
                  <option value="CUSTOM" ${settingsStore.qualityPreset === 'CUSTOM' ? 'selected' : ''}>${t('settings.presetCustom')}</option>
                </select>
                <div id="preset-details" style="margin-top: 8px; padding: 10px 12px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
                  ${this.getPresetDetailsHtml(settingsStore.qualityPreset)}
                </div>
                <small style="display: block; margin-top: 6px; color: var(--text-muted); font-size: 11px;">
                  ${t('settings.qualityFootnote')}
                </small>
              </div>
            </div>

            <!-- Tab: about -->
            <div class="settings-tab-panel" id="tab-panel-about" style="display: none;">
              <!-- Updates -->
              <div class="form-group" style="margin-bottom: 16px;">
                <label style="display: flex; align-items: center; gap: 6px;">
                  <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">system_update</span>
                  ${t('settings.updatesSection')}
                </label>
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                  <div style="flex: 1;">
                    <div style="font-size: 12px; color: var(--text-secondary);">
                      ${t('settings.currentVersion')} <span id="settings-app-version" style="font-family: var(--font-mono);">…</span>
                    </div>
                    <div id="settings-update-status" style="font-size: 11px; color: var(--text-muted); margin-top: 2px;"></div>
                  </div>
                  <button id="btn-check-updates" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;">
                    <span class="material-symbols-outlined md-16" style="margin-right: 4px;">refresh</span>
                    ${t('settings.checkUpdates')}
                  </button>
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border-color);">
                  <div>
                    <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px; cursor: pointer; font-weight: 600;" for="checkbox-update-beta">
                      <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">science</span>
                      ${t('settings.betaChannel')}
                    </label>
                    <div style="font-size: 11px; color: var(--text-muted);">
                      ${t('settings.betaChannelDesc')}
                    </div>
                  </div>
                  <label class="toggle-switch" aria-label="${t('settings.betaChannel')}">
                    <input id="checkbox-update-beta" type="checkbox" ${settingsStore.updateBetaChannel ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                  </label>
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border-color);">
                  <div>
                    <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px; cursor: pointer; font-weight: 600;" for="checkbox-auto-start">
                      <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">power_settings_new</span>
                      ${t('settings.autoStart')}
                    </label>
                    <div style="font-size: 11px; color: var(--text-muted);">
                      ${t('settings.autoStartDesc')}
                    </div>
                  </div>
                  <label class="toggle-switch" aria-label="${t('settings.autoStart')}">
                    <input id="checkbox-auto-start" type="checkbox">
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>

              <!-- Community -->
              <div class="form-group" style="border-top: 1px solid var(--border-color); padding-top: 14px;">
                <label style="display: flex; align-items: center; gap: 6px;">
                  <span class="material-symbols-outlined md-16" style="color: var(--accent-primary);">forum</span>
                  ${t('settings.communitySection')}
                </label>
                <small style="display: block; margin-bottom: 8px; color: var(--text-muted); font-size: 11px;">
                  ${t('settings.communityDesc')}
                </small>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                  <button id="btn-suggest-idea" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;">
                    <span class="material-symbols-outlined md-16" style="margin-right: 4px;">lightbulb</span>
                    ${t('settings.suggestIdea')}
                  </button>
                  <button id="btn-vote-ideas" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;">
                    <span class="material-symbols-outlined md-16" style="margin-right: 4px;">how_to_vote</span>
                    ${t('settings.voteIdeas')}
                  </button>
                  <button id="btn-report-bug" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;">
                    <span class="material-symbols-outlined md-16" style="margin-right: 4px;">bug_report</span>
                    ${t('settings.reportBug')}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="modal-footer" style="padding: 12px 24px; border-top: 1px solid var(--border-color); margin: 0; background: var(--bg-secondary);">
            <button id="btn-settings-close" class="btn btn-primary">${t('common.done')}</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.modalEl);
    this.attachEvents();
    await this.refreshDevices();
    await this.loadAppVersion();
    this.startVadMeter();
  }

  private getPresetDetailsHtml(preset: QualityPresetType): string {
    const p: QualityProfile = preset === 'CUSTOM' ? settingsStore.customProfile : QUALITY_PRESETS[preset];
    const totalMbps = Math.round((p.audioBitrateKbps + p.cameraBitrateKbps + p.screenBitrateKbps) / 100) / 10;

    if (preset === 'CUSTOM') {
      const inp = (id: string, label: string, val: number, unit: string) =>
        `<div style="display: flex; align-items: center; gap: 6px;">
          <label style="color: var(--text-secondary); min-width: 55px; font-size: 11px;">${label}</label>
          <input id="custom-${id}" type="number" value="${val}" style="width: 70px; padding: 3px 6px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary); font-size: 12px;" />
          <span style="font-size: 11px; color: var(--text-muted);">${unit}</span>
        </div>`;

      return `
        <div style="font-size: 12px;">
          <div style="margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.06);">
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
              <span class="material-symbols-outlined" style="font-size: 16px; color: var(--accent-primary);">mic</span>
              <strong style="color: var(--text-secondary);">${t('settings.audio')}</strong>
            </div>
            ${inp('audioBitrate', t('settings.bitrate'), p.audioBitrateKbps, 'kbps')}
          </div>
          <div style="margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.06);">
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
              <span class="material-symbols-outlined" style="font-size: 16px; color: var(--accent-primary);">videocam</span>
              <strong style="color: var(--text-secondary);">${t('settings.cameraShort')}</strong>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
              ${inp('cameraWidth', t('settings.width'), p.cameraWidth, 'px')}
              ${inp('cameraHeight', t('settings.height'), p.cameraHeight, 'px')}
              ${inp('cameraFps', 'FPS', p.cameraFps, '')}
              ${inp('cameraBitrate', t('settings.bitrate'), p.cameraBitrateKbps, 'kbps')}
            </div>
          </div>
          <div style="margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.06);">
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
              <span class="material-symbols-outlined" style="font-size: 16px; color: var(--accent-primary);">screen_share</span>
              <strong style="color: var(--text-secondary);">${t('settings.screen')}</strong>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
              ${inp('screenWidth', t('settings.width'), p.screenWidth, 'px')}
              ${inp('screenHeight', t('settings.height'), p.screenHeight, 'px')}
              ${inp('screenFps', 'FPS', p.screenFps, '')}
              ${inp('screenBitrate', t('settings.bitrate'), p.screenBitrateKbps, 'kbps')}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 11px;">
            <span class="material-symbols-outlined" style="font-size: 16px;">speed</span>
            ${t('settings.maxBandwidth', { value: totalMbps })}
          </div>
        </div>
        <p style="margin: 8px 0 0; font-size: 11px; color: var(--text-muted);">
          ${t('settings.bitrateCeilingNote')}
        </p>
      `;
    }

    const row = (icon: string, label: string, value: string) => `
      <div style="display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.04);">
        <span class="material-symbols-outlined" style="font-size: 16px; color: var(--accent-primary); flex-shrink: 0;">${icon}</span>
        <span style="color: var(--text-secondary); min-width: 70px;">${label}</span>
        <span style="color: var(--text-primary); font-weight: 500;">${value}</span>
      </div>`;

    return `
      <div style="font-size: 12px; line-height: 1.5;">
        ${row('mic', t('settings.audio'), `${p.audioBitrateKbps} kbps`)}
        ${row('videocam', t('settings.cameraShort'), `${p.cameraWidth}×${p.cameraHeight} &nbsp;│&nbsp; ${p.cameraFps} fps &nbsp;│&nbsp; ${p.cameraBitrateKbps} kbps`)}
        ${row('screen_share', t('settings.screen'), `${p.screenWidth}×${p.screenHeight} &nbsp;│&nbsp; ${p.screenFps} fps &nbsp;│&nbsp; ${p.screenBitrateKbps} kbps`)}
        ${row('speed', t('settings.maxBandwidthLabel'), `~${totalMbps} Mbps`)}
      </div>
      <p style="margin: 8px 0 0; font-size: 11px; color: var(--text-muted);">
        ${t('settings.bitrateCeilingNote')}
      </p>
    `;
  }

  private getCustomSoundsHtml(): string {
    const labels = getSoundLabels();
    const keys = Object.keys(labels) as SoundEffectType[];
    return keys.map((key) => {
      const label = labels[key];
      const isCustom = !!settingsStore.customSounds[key];
      return `
        <div style="display: flex; align-items: center; gap: 8px; padding: 4px 0;">
          <span style="flex: 1; font-size: 12px; color: var(--text-secondary);">${label}</span>
          ${isCustom ? `<span style="font-size: 10px; color: var(--accent-primary);">${t('settings.customBadge')}</span>` : ''}
          <button class="btn-sound-preview btn btn-secondary" data-sound-key="${key}" style="font-size: 10px; padding: 2px 8px;" title="${t('settings.playSound')}">
            <span class="material-symbols-outlined md-14">play_arrow</span>
          </button>
          <button class="btn-sound-change btn btn-secondary" data-sound-key="${key}" style="font-size: 10px; padding: 2px 8px;" title="${t('settings.changeSound')}">
            <span class="material-symbols-outlined md-14">folder_open</span>
          </button>
          ${isCustom ? `<button class="btn-sound-reset btn btn-secondary" data-sound-key="${key}" style="font-size: 10px; padding: 2px 8px;" title="${t('settings.resetSound')}">
            <span class="material-symbols-outlined md-14">restart_alt</span>
          </button>` : ''}
        </div>`;
    }).join('');
  }

  private attachCustomSoundsListeners(): void {
    if (!this.modalEl) return;

    this.modalEl.querySelectorAll('.btn-sound-preview').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-sound-key') as SoundEffectType;
        if (key) soundEffects.play(key);
      });
    });

    this.modalEl.querySelectorAll('.btn-sound-change').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const key = btn.getAttribute('data-sound-key') as SoundEffectType;
        if (!key || !window.api?.selectSoundFile) return;
        const dataUrl = await window.api.selectSoundFile();
        if (dataUrl) {
          settingsStore.customSounds[key] = dataUrl;
          settingsStore.save();
          soundEffects.reloadSound(key, dataUrl);
          const list = this.modalEl?.querySelector('#custom-sounds-list');
          if (list) {
            list.innerHTML = this.getCustomSoundsHtml();
            this.attachCustomSoundsListeners();
          }
        }
      });
    });

    this.modalEl.querySelectorAll('.btn-sound-reset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-sound-key') as SoundEffectType;
        if (!key) return;
        delete settingsStore.customSounds[key];
        settingsStore.save();
        soundEffects.reloadSound(key);
        const list = this.modalEl?.querySelector('#custom-sounds-list');
        if (list) {
          list.innerHTML = this.getCustomSoundsHtml();
          this.attachCustomSoundsListeners();
        }
      });
    });

    this.modalEl.querySelector('#btn-reset-all-sounds')?.addEventListener('click', () => {
      settingsStore.customSounds = {};
      settingsStore.save();
      soundEffects.loadAll();
      const list = this.modalEl?.querySelector('#custom-sounds-list');
      if (list) {
        list.innerHTML = this.getCustomSoundsHtml();
        this.attachCustomSoundsListeners();
      }
    });
  }

  private attachCustomProfileListeners(): void {
    if (!this.modalEl) return;
    const map: Record<string, keyof QualityProfile> = {
      'custom-audioBitrate': 'audioBitrateKbps',
      'custom-cameraWidth': 'cameraWidth',
      'custom-cameraHeight': 'cameraHeight',
      'custom-cameraFps': 'cameraFps',
      'custom-cameraBitrate': 'cameraBitrateKbps',
      'custom-screenWidth': 'screenWidth',
      'custom-screenHeight': 'screenHeight',
      'custom-screenFps': 'screenFps',
      'custom-screenBitrate': 'screenBitrateKbps',
    };
    for (const [id, key] of Object.entries(map)) {
      const el = this.modalEl.querySelector(`#${id}`) as HTMLInputElement | null;
      el?.addEventListener('change', () => {
        const val = Math.max(1, parseInt(el.value, 10) || 1);
        (settingsStore.customProfile as any)[key] = val;
        settingsStore.save();
        videoService.setQualityPreset('CUSTOM');
        webRtcManager.setQualityPreset('CUSTOM');
      });
    }
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
      `<span class="material-symbols-outlined md-16" style="margin-right: 4px;">autorenew</span> ${t('settings.checking')}`;

    const result = await updateService.checkManually();

    btn.disabled = false;
    btn.innerHTML = orig;

    if (result.status === 'available') {
      status.textContent = t('settings.updateAvailable', { version: result.version ?? '' });
      status.style.color = 'var(--accent-primary)';
    } else if (result.status === 'latest') {
      status.textContent = t('settings.upToDate');
      status.style.color = 'var(--success)';
    } else {
      status.textContent = t('settings.updateCheckFailed');
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
          selectMic.innerHTML = `<option value="">${t('settings.noMicDetected')}</option>`;
        } else {
          selectMic.innerHTML = audioInputs
            .map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === settingsStore.selectedMicrophoneId ? 'selected' : ''}>${d.label || t('settings.micFallback', { index: i + 1 })}</option>`)
            .join('');
          if (!settingsStore.selectedMicrophoneId && audioInputs.length > 0) {
            settingsStore.selectedMicrophoneId = audioInputs[0].deviceId;
            settingsStore.save();
          }
        }
      }

      if (selectSpeaker) {
        if (audioOutputs.length === 0) {
          selectSpeaker.innerHTML = `<option value="">${t('settings.defaultSpeaker')}</option>`;
        } else {
          selectSpeaker.innerHTML = audioOutputs
            .map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === settingsStore.selectedSpeakerId ? 'selected' : ''}>${d.label || t('settings.outputFallback', { index: i + 1 })}</option>`)
            .join('');
          if (!settingsStore.selectedSpeakerId && audioOutputs.length > 0) {
            settingsStore.selectedSpeakerId = audioOutputs[0].deviceId;
            settingsStore.save();
          }
        }
      }

      if (selectCam) {
        if (videoInputs.length === 0) {
          selectCam.innerHTML = `<option value="">${t('settings.noCameraDetected')}</option>`;
        } else {
          selectCam.innerHTML = videoInputs
            .map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === settingsStore.selectedCameraId ? 'selected' : ''}>${d.label || t('settings.cameraFallback', { index: i + 1 })}</option>`)
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

    // Tab switching navigation (#163)
    const tabButtons = this.modalEl.querySelectorAll('.settings-tab-btn');
    const tabPanels = this.modalEl.querySelectorAll('.settings-tab-panel');
    const tabTitleEl = this.modalEl.querySelector('#settings-current-tab-title');

    const tabTitles: Record<string, { icon: string; label: string }> = {
      account: { icon: 'person', label: t('settings.tabAccount') },
      voice_video: { icon: 'mic', label: t('settings.tabVoiceVideo') },
      soundboard: { icon: 'music_note', label: t('settings.tabSoundboard') },
      notifications: { icon: 'notifications', label: t('settings.tabNotifications') },
      quality: { icon: 'speed', label: t('settings.tabQualityLong') },
      about: { icon: 'info', label: t('settings.tabAboutLong') },
    };

    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tabKey = btn.getAttribute('data-tab');
        if (!tabKey) return;

        tabButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        tabPanels.forEach((panel) => {
          if (panel.id === `tab-panel-${tabKey}`) {
            (panel as HTMLElement).style.display = 'block';
          } else {
            (panel as HTMLElement).style.display = 'none';
          }
        });

        if (tabTitleEl && tabTitles[tabKey]) {
          tabTitleEl.innerHTML = `
            <span class="material-symbols-outlined" style="color: var(--accent-primary);">${tabTitles[tabKey].icon}</span>
            <span>${tabTitles[tabKey].label}</span>
          `;
        }
      });
    });

    const btnClose = this.modalEl.querySelector('#modal-close');
    const btnDone = this.modalEl.querySelector('#btn-settings-close');
    const btnRefresh = this.modalEl.querySelector('#btn-refresh-devices');
    const btnSaveNick = this.modalEl.querySelector('#btn-save-nickname');
    const btnExportIdentity = this.modalEl.querySelector('#btn-export-identity') as HTMLButtonElement | null;
    const btnImportIdentity = this.modalEl.querySelector('#btn-import-identity-settings') as HTMLButtonElement | null;
    const inputNick = this.modalEl.querySelector('#settings-nickname-input') as HTMLInputElement;
    const selectMic = this.modalEl.querySelector('#select-mic') as HTMLSelectElement;
    const selectSpeaker = this.modalEl.querySelector('#select-speaker') as HTMLSelectElement;
    const selectCam = this.modalEl.querySelector('#select-cam') as HTMLSelectElement;
    const selectPreset = this.modalEl.querySelector('#select-preset') as HTMLSelectElement;
    const sliderVad = this.modalEl.querySelector('#slider-vad') as HTMLInputElement;
    const vadVal = this.modalEl.querySelector('#vad-val');
    const checkboxScreenTelemetry = this.modalEl.querySelector('#checkbox-screen-telemetry') as HTMLInputElement | null;
    const selectScreenTelemetryPosition = this.modalEl.querySelector('#select-screen-telemetry-position') as HTMLSelectElement | null;
    const selectScreenTelemetryMode = this.modalEl.querySelector('#select-screen-telemetry-mode') as HTMLSelectElement | null;

    btnClose?.addEventListener('click', () => this.close());
    btnDone?.addEventListener('click', () => this.close());

    // Close on ESC key (#243)
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { this.close(); }
    };
    window.addEventListener('keydown', handleEsc);
    // Store for cleanup in close()
    (this.modalEl as any)._escHandler = handleEsc;

    const btnCheckUpdates = this.modalEl.querySelector('#btn-check-updates');
    btnCheckUpdates?.addEventListener('click', () => this.checkUpdates());

    const checkboxUpdateBeta = this.modalEl.querySelector('#checkbox-update-beta') as HTMLInputElement | null;
    checkboxUpdateBeta?.addEventListener('change', async () => {
      settingsStore.updateBetaChannel = checkboxUpdateBeta.checked;
      settingsStore.save();
      try {
        await window.api?.setUpdateChannel?.(settingsStore.updateBetaChannel);
      } catch {
        // Non-fatal: the channel is re-applied on next app start.
      }
      // Re-check immediately so the user sees the outcome for the new channel.
      this.checkUpdates();
    });

    // Auto-start with OS (#245)
    const checkboxAutoStart = this.modalEl.querySelector('#checkbox-auto-start') as HTMLInputElement | null;
    if (checkboxAutoStart && window.api?.getAutoStart) {
      window.api.getAutoStart().then((enabled) => { checkboxAutoStart.checked = enabled; });
      checkboxAutoStart.addEventListener('change', () => {
        window.api?.setAutoStart?.(checkboxAutoStart.checked);
      });
    }

    const btnSuggestIdea = this.modalEl.querySelector('#btn-suggest-idea');
    const btnVoteIdeas = this.modalEl.querySelector('#btn-vote-ideas');
    const btnReportBug = this.modalEl.querySelector('#btn-report-bug');

    btnSuggestIdea?.addEventListener('click', () => window.api?.openExternal(NEW_IDEA_URL));
    btnVoteIdeas?.addEventListener('click', () => window.api?.openExternal(IDEAS_URL));
    btnReportBug?.addEventListener('click', () => window.api?.openExternal(NEW_ISSUE_URL));

    btnExportIdentity?.addEventListener('click', async () => {
      await showIdentityExportDialog(connectionStore.clientId);
    });

    btnImportIdentity?.addEventListener('click', async () => {
      const identity = await showIdentityImportDialog();
      if (!identity) return;
      connectionStore.setIdentity(identity);
      await showAlert({
        title: t('identity.importTitle'),
        message: t('identity.importSuccess'),
        variant: 'success',
      });
      await this.open();
    });

    // Language switch (#16): persists the choice, re-renders every open view
    // (through `i18n.language_changed`) and reopens this modal already
    // translated, keeping the user where they were.
    const selectLanguage = this.modalEl.querySelector('#select-language') as HTMLSelectElement | null;
    selectLanguage?.addEventListener('change', () => {
      const language = selectLanguage.value as SupportedLanguage;
      if (language === getLanguage()) return;
      setLanguage(language);
      void this.open();
    });

    btnRefresh?.addEventListener('click', async () => {
      const origText = btnRefresh.innerHTML;
      btnRefresh.innerHTML = `<span class="material-symbols-outlined md-14" style="margin-right: 4px;">autorenew</span> ${t('settings.refreshing')}`;
      await this.refreshDevices();
      setTimeout(() => {
        if (btnRefresh) btnRefresh.innerHTML = origText;
      }, 500);
    });

    sliderVad?.addEventListener('input', () => {
      const val = parseInt(sliderVad.value, 10);
      if (vadVal) vadVal.textContent = val.toString();
      sliderVad.style.setProperty('--slider-progress', `${(val / 160) * 100}%`);
      settingsStore.vadSensitivity = val;
      audioProcessor.setVadThreshold(val);
      settingsStore.save();
    });

    const checkboxRnnoise = this.modalEl.querySelector('#checkbox-rnnoise') as HTMLInputElement | null;
    checkboxRnnoise?.addEventListener('change', async () => {
      const enabled = !!checkboxRnnoise.checked;
      settingsStore.noiseSuppressionEnabled = enabled;
      settingsStore.save();
      await audioProcessor.setNoiseSuppression(enabled);
    });

    const inputSoundboardPath = this.modalEl.querySelector('#input-soundboard-path') as HTMLInputElement | null;
    const btnSelectSoundboardFolder = this.modalEl.querySelector('#btn-select-soundboard-folder');
    const soundboardFolderInfo = this.modalEl.querySelector('#soundboard-folder-info');
    const sliderSoundboardVol = this.modalEl.querySelector('#slider-soundboard-vol') as HTMLInputElement | null;
    const soundboardVolVal = this.modalEl.querySelector('#soundboard-vol-val');
    const checkboxSoundboardMute = this.modalEl.querySelector('#checkbox-soundboard-mute') as HTMLInputElement | null;

    btnSelectSoundboardFolder?.addEventListener('click', async () => {
      const folder = await soundboardService.selectFolder();
      if (folder && inputSoundboardPath) {
        inputSoundboardPath.value = folder;
        const count = soundboardService.getSounds().length;
        if (soundboardFolderInfo) {
          soundboardFolderInfo.textContent = `${count} sons encontrados nesta pasta.`;
        }
      }
    });

    sliderSoundboardVol?.addEventListener('input', () => {
      const val = parseInt(sliderSoundboardVol.value, 10);
      if (soundboardVolVal) soundboardVolVal.textContent = `${val}%`;
      sliderSoundboardVol.style.setProperty('--slider-progress', `${val}%`);
      settingsStore.soundboardVolume = val;
      settingsStore.save();
    });

    checkboxSoundboardMute?.addEventListener('change', () => {
      const muted = !!checkboxSoundboardMute.checked;
      settingsStore.soundboardMuted = muted;
      settingsStore.save();
    });

    const syncScreenTelemetryControls = () => {
      const enabled = !!checkboxScreenTelemetry?.checked;
      if (selectScreenTelemetryPosition) selectScreenTelemetryPosition.disabled = !enabled;
      if (selectScreenTelemetryMode) selectScreenTelemetryMode.disabled = !enabled;
    };

    checkboxScreenTelemetry?.addEventListener('change', () => {
      settingsStore.screenShareTelemetryEnabled = !!checkboxScreenTelemetry.checked;
      settingsStore.save();
      syncScreenTelemetryControls();
    });

    selectScreenTelemetryPosition?.addEventListener('change', () => {
      const position = selectScreenTelemetryPosition.value as typeof settingsStore.screenShareTelemetryPosition;
      settingsStore.screenShareTelemetryPosition = position;
      settingsStore.save();
    });

    selectScreenTelemetryMode?.addEventListener('change', () => {
      const mode = selectScreenTelemetryMode.value as typeof settingsStore.screenShareTelemetryMode;
      settingsStore.screenShareTelemetryMode = mode;
      settingsStore.save();
    });

    syncScreenTelemetryControls();

    const checkboxChatSound = this.modalEl.querySelector('#checkbox-chat-sound') as HTMLInputElement | null;
    const checkboxChatSoundMentions = this.modalEl.querySelector('#checkbox-chat-sound-mentions') as HTMLInputElement | null;

    const syncChatSoundControls = () => {
      if (checkboxChatSoundMentions) checkboxChatSoundMentions.disabled = !checkboxChatSound?.checked;
    };

    checkboxChatSound?.addEventListener('change', () => {
      settingsStore.chatMessageSoundEnabled = !!checkboxChatSound.checked;
      settingsStore.save();
      syncChatSoundControls();
    });

    checkboxChatSoundMentions?.addEventListener('change', () => {
      settingsStore.chatMessageSoundMentionsOnly = !!checkboxChatSoundMentions.checked;
      settingsStore.save();
    });

    syncChatSoundControls();

    selectPreset?.addEventListener('change', () => {
      const preset = selectPreset.value as QualityPresetType;
      settingsStore.qualityPreset = preset;
      settingsStore.save();
      videoService.setQualityPreset(preset);
      webRtcManager.setQualityPreset(preset);
      const details = this.modalEl?.querySelector('#preset-details') as HTMLElement | null;
      if (details) {
        details.innerHTML = this.getPresetDetailsHtml(preset);
        if (preset === 'CUSTOM') this.attachCustomProfileListeners();
      }
    });

    if (settingsStore.qualityPreset === 'CUSTOM') {
      this.attachCustomProfileListeners();
    }

    this.attachCustomSoundsListeners();

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
        btnSaveNick.textContent = t('settings.saved');
        setTimeout(() => {
          if (btnSaveNick) btnSaveNick.textContent = t('common.save');
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
        btnSaveNick.textContent = t('settings.saved');
        setTimeout(() => {
          if (btnSaveNick) btnSaveNick.textContent = t('common.save');
        }, 1500);
      } catch (err: any) {
        this.showError(err.message || t('settings.nicknameError'));
      }
    });

    const avatarWrapper = this.modalEl.querySelector('#settings-avatar-wrapper');
    avatarWrapper?.addEventListener('click', async () => {
      const hasCustomAvatar = !!(serverStore.currentUser?.avatarUrl || connectionStore.savedAvatarBase64);
      const action = await this.showAvatarActionModal(hasCustomAvatar);
      if (!action) return;

      if (action === 'change') {
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
              this.showError(err.message || t('settings.avatarError'));
            }
          }
        }
      } else if (action === 'remove') {
        // Offline: clear avatar locally
        if (!serverStore.currentUser) {
          const preview = document.getElementById('settings-avatar-preview') as HTMLImageElement;
          if (preview) preview.src = getAvatarUrl(null);
          connectionStore.saveUserProfile(connectionStore.savedNickname, null);
          return;
        }
        try {
          await networkClient.sendRequest(MessageType.USER_UPDATE_AVATAR, {
            avatarBase64: null,
          });
          const preview = document.getElementById('settings-avatar-preview') as HTMLImageElement;
          if (preview) preview.src = getAvatarUrl(null);
          if (serverStore.currentUser) serverStore.currentUser.avatarUrl = null;
          const currentNick = serverStore.currentUser?.nickname || connectionStore.savedNickname;
          connectionStore.saveUserProfile(currentNick, null);
        } catch (err: any) {
          this.showError(err.message || t('settings.avatarRemoveError'));
        }
      }
    });
  }

  private showAvatarActionModal(hasCustomAvatar: boolean): Promise<'change' | 'remove' | null> {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.style.zIndex = '10001';
      backdrop.innerHTML = `
        <div class="modal-card dialog-card" role="dialog" aria-modal="true" style="max-width: 380px;">
          <div class="modal-header">
            <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
              <span class="material-symbols-outlined" style="color: var(--accent-primary);">photo_camera</span>
              <span>${t('settings.avatarDialogTitle')}</span>
            </div>
            <button class="modal-close-btn" data-action="cancel">&times;</button>
          </div>
          <div class="dialog-message" style="margin-bottom: 20px; white-space: normal;">${t('settings.avatarDialogPrompt')}</div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <button type="button" class="btn btn-primary" data-action="change" style="justify-content: center; gap: 8px; height: 38px;">
              <span class="material-symbols-outlined md-18">upload</span>
              <span>${t('settings.avatarChange')}</span>
            </button>
            ${
              hasCustomAvatar
                ? `
            <button type="button" class="btn btn-danger" data-action="remove" style="justify-content: center; gap: 8px; height: 38px;">
              <span class="material-symbols-outlined md-18">delete</span>
              <span>${t('settings.avatarRemove')}</span>
            </button>`
                : ''
            }
            <button type="button" class="btn btn-secondary" data-action="cancel" style="justify-content: center; height: 38px;">
              <span>${t('common.cancel')}</span>
            </button>
          </div>
        </div>
      `;

      let settled = false;
      const settle = (action: 'change' | 'remove' | null) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeyDown, true);
        backdrop.remove();
        resolve(action);
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          settle(null);
        }
      };

      backdrop.querySelector('[data-action="change"]')?.addEventListener('click', () => settle('change'));
      backdrop.querySelector('[data-action="remove"]')?.addEventListener('click', () => settle('remove'));
      backdrop.querySelectorAll('[data-action="cancel"]').forEach((el) => {
        el.addEventListener('click', () => settle(null));
      });
      backdrop.addEventListener('mousedown', (e) => {
        if (e.target === backdrop) settle(null);
      });
      document.addEventListener('keydown', onKeyDown, true);

      document.body.appendChild(backdrop);
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
          `<span class="material-symbols-outlined md-16" style="margin-right: 4px;">visibility_off</span> ${t('settings.stopPreview')}`;
      }
    } catch (err: any) {
      this.showError(err?.message || t('settings.cameraAccessError'));
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
        `<span class="material-symbols-outlined md-16" style="margin-right: 4px;">visibility</span> ${t('settings.previewCamera')}`;
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

    const MAX_VAD_SCALE = 160;

    const positionMarker = () => {
      if (marker) marker.style.left = `${Math.min(100, (settingsStore.vadSensitivity / MAX_VAD_SCALE) * 100)}%`;
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
      const pct = Math.max(0, Math.min(100, (Math.max(0, level) / MAX_VAD_SCALE) * 100));
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
      const handler = (this.modalEl as any)._escHandler;
      if (handler) window.removeEventListener('keydown', handler);
      this.modalEl.remove();
      this.modalEl = null;
    }
  }
}

export const settingsModal = new SettingsModal();
