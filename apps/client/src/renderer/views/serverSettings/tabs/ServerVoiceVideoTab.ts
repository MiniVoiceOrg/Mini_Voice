import { serverStore } from '../../../stores/serverStore';
import { t } from '../../../i18n';

export class ServerVoiceVideoTab {
  public renderHtml(): string {
    const s = serverStore.serverDetails;
    if (!s) return '';

    return `
      <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-card); padding: 12px 14px; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
        <div>
          <label for="checkbox-allow-soundboard" style="font-size: 13px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 6px; cursor: pointer; margin-bottom: 2px;">
            <span class="material-symbols-outlined md-18" style="color: var(--accent-primary);">music_note</span>
            <span>${t('serverSettings.allowSoundboard')}</span>
          </label>
          <div style="font-size: 11px; color: var(--text-muted);">
            ${t('serverSettings.allowSoundboardDesc')}
          </div>
        </div>
        <label class="toggle-switch" aria-label="${t('serverSettings.allowSoundboard')}">
          <input id="checkbox-allow-soundboard" type="checkbox" ${s.allowSoundboard !== false ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
    `;
  }
}
