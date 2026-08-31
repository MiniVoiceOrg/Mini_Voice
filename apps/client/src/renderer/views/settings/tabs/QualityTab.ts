import { QUALITY_PRESETS, QualityPresetType, QualityProfile } from '@monky/shared';
import { settingsStore } from '../../../stores/settingsStore';
import { webRtcManager } from '../../../core/WebRtcManager';
import { t } from '../../../i18n';

export class QualityTab {
  public renderHtml(): string {
    return `
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
          <option value="ULTRA" ${settingsStore.qualityPreset === 'ULTRA' ? 'selected' : ''}>${t('settings.presetUltra')}</option>
          <option value="CUSTOM" ${settingsStore.qualityPreset === 'CUSTOM' ? 'selected' : ''}>${t('settings.presetCustom')}</option>
        </select>
        <div id="preset-details" style="margin-top: 8px; padding: 10px 12px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
          ${this.getPresetDetailsHtml(settingsStore.qualityPreset)}
        </div>
        <small style="display: block; margin-top: 6px; color: var(--text-muted); font-size: 11px;">
          ${t('settings.qualityFootnote')}
        </small>
        <small style="display: block; margin-top: 4px; color: var(--accent-primary); font-size: 11px;">
          <span class="material-symbols-outlined" style="font-size: 14px; vertical-align: middle;">bolt</span>
          ${t('settings.qualityInstantApply')}
        </small>
      </div>
    `;
  }

  public getPresetDetailsHtml(preset: QualityPresetType): string {
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

  public attachEvents(container: HTMLElement): void {
    const selectPreset = container.querySelector<HTMLSelectElement>('#select-preset');
    const presetDetails = container.querySelector<HTMLElement>('#preset-details');

    selectPreset?.addEventListener('change', () => {
      const val = selectPreset.value as QualityPresetType;
      settingsStore.qualityPreset = val;
      settingsStore.save();
      webRtcManager.setQualityPreset(val);
      if (presetDetails) {
        presetDetails.innerHTML = this.getPresetDetailsHtml(val);
        if (val === 'CUSTOM') {
          this.attachCustomProfileListeners(container);
        }
      }
    });

    if (settingsStore.qualityPreset === 'CUSTOM') {
      this.attachCustomProfileListeners(container);
    }
  }

  private attachCustomProfileListeners(container: HTMLElement): void {
    const bind = <K extends keyof QualityProfile>(id: string, key: K) => {
      const input = container.querySelector<HTMLInputElement>(`#custom-${id}`);
      input?.addEventListener('change', () => {
        const val = parseInt(input.value, 10);
        if (!isNaN(val) && val > 0) {
          if (typeof settingsStore.customProfile[key] === 'number') {
            (settingsStore.customProfile[key] as number) = val;
          }
          settingsStore.save();
          webRtcManager.setQualityPreset('CUSTOM');
        }
      });
    };

    bind('audioBitrate', 'audioBitrateKbps');
    bind('cameraWidth', 'cameraWidth');
    bind('cameraHeight', 'cameraHeight');
    bind('cameraFps', 'cameraFps');
    bind('cameraBitrate', 'cameraBitrateKbps');
    bind('screenWidth', 'screenWidth');
    bind('screenHeight', 'screenHeight');
    bind('screenFps', 'screenFps');
    bind('screenBitrate', 'screenBitrateKbps');
  }
}
