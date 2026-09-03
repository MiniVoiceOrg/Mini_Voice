import { escapeHtml } from '../utils/html';
import { t } from '../i18n';
import { settingsStore } from '../stores/settingsStore';

const DISMISSED_KEY = 'monky_dismissed_update';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const INSTALLED_BANNER_MS = 15000;
const RELEASES_URL = 'https://github.com/MonkyOrg/Monky/releases/latest';

interface BannerAction {
  label: string;
  primary?: boolean;
  dismiss?: boolean;
  onClick: () => void;
}

/**
 * Handles the in-app auto-update flow.
 *
 * - Windows: uses electron-updater (download + install + relaunch on click).
 * - macOS: downloads the matching .dmg, opens it and closes the app, since
 *   macOS refuses to replace a bundle that is still running (#377). The user
 *   drags the new version into Applications and reopens it.
 *
 * Checks run on startup and hourly, showing a dismissible banner.
 */
class UpdateService {
  private banner: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;
  private actionsEl: HTMLElement | null = null;
  private latestVersion = '';
  private bannerKind = '';
  private listenersBound = false;
  private unbindUpdateEvents: Array<() => void> = [];

  public async init(): Promise<void> {
    if (!window.api?.checkForUpdates) {
      return;
    }

    // Tell the main process which channel (stable/beta) to use before the first
    // check runs, so detection and downloads honour the user's preference.
    try {
      await window.api.setUpdateChannel?.(settingsStore.updateBetaChannel);
    } catch {
      // Non-fatal: defaults to the stable channel.
    }

    this.bindUpdateEvents();
    void this.reportLastInstall();

    setTimeout(() => this.check(), 4000);
    setInterval(() => this.check(), CHECK_INTERVAL_MS);
  }

  /**
   * Confirms the install that ran while the app was closed (#498). Without it
   * the app just reappears and the user has to dig into Settings to find out
   * whether the update actually landed.
   */
  private async reportLastInstall(): Promise<void> {
    try {
      const outcome = await window.api.getUpdateOutcome?.();
      if (!outcome) return;

      if (outcome.status === 'failed') {
        this.setText(t('update.installFailed', { version: escapeHtml(outcome.version) }));
        this.setActions([
          {
            label: t('update.downloadManually'),
            primary: true,
            onClick: () => window.api.openExternal(RELEASES_URL),
          },
          { label: '×', dismiss: true, onClick: () => this.dismiss() },
        ]);
        return;
      }

      this.setText(t('update.installed', { version: escapeHtml(outcome.version) }));
      this.setActions([
        {
          label: t('update.whatsNew'),
          primary: true,
          onClick: () => window.api.openExternal(RELEASES_URL),
        },
        { label: '×', dismiss: true, onClick: () => this.dismiss() },
      ]);
      this.bannerKind = 'installed';
      // Good news doesn't need to stay on screen: clear it unless something
      // else has taken the banner over in the meantime.
      window.setTimeout(() => {
        if (this.bannerKind === 'installed') {
          this.dismiss();
        }
      }, INSTALLED_BANNER_MS);
    } catch {
      // Non-fatal: the banner is informational only.
    }
  }

  private bindUpdateEvents(): void {
    if (this.listenersBound) return;
    this.listenersBound = true;

    const u1 = window.api.onUpdateProgress((percent) => {
      this.setText(t('update.downloading', { percent }));
    });

    const u2 = window.api.onUpdateDownloaded((info) => {
      if (info.manual) {
        // macOS: the .dmg is open and the app closes on its own so Finder can
        // replace the bundle (#377). Nothing left to click, same as Windows.
        this.setText(t('update.installerOpened'));
        this.setActions([]);
      } else {
        // Windows: the main process installs silently and relaunches on its own.
        this.setText(t('update.installing'));
        this.setActions([]);
      }
    });

    const u3 = window.api.onUpdateError(() => {
      this.setText(t('update.downloadFailed'));
      this.setActions([
        {
          label: t('update.downloadManually'),
          primary: true,
          onClick: () => window.api.openExternal(RELEASES_URL),
        },
        { label: '×', dismiss: true, onClick: () => this.dismiss() },
      ]);
    });

    this.unbindUpdateEvents.push(u1, u2, u3);
  }

  private async check(): Promise<void> {
    try {
      const result = await window.api.checkForUpdates();
      if (!result?.ok || !result.available || !result.version) {
        return;
      }

      if (localStorage.getItem(DISMISSED_KEY) === result.version) {
        return;
      }

      this.latestVersion = result.version;
      this.showAvailable(result.version);
    } catch {
      // Non-fatal: try again on the next interval.
    }
  }

  /**
   * Triggered by the "Verificar atualizações" button in Settings. Unlike the
   * automatic check, it ignores the dismissed flag and reports the outcome.
   */
  public async checkManually(): Promise<{ status: 'available' | 'latest' | 'error'; version?: string }> {
    if (!window.api?.checkForUpdates) {
      return { status: 'error' };
    }
    try {
      const result = await window.api.checkForUpdates();
      if (!result?.ok) {
        return { status: 'error' };
      }
      if (result.available && result.version) {
        this.latestVersion = result.version;
        this.showAvailable(result.version);
        return { status: 'available', version: result.version };
      }
      return { status: 'latest' };
    } catch {
      return { status: 'error' };
    }
  }

  private showAvailable(version: string): void {
    this.ensureBanner();
    this.setText(t('update.available', { version: escapeHtml(version) }));
    this.setActions([
      {
        label: t('update.updateNow'),
        primary: true,
        onClick: () => {
          this.setText(t('update.startingDownload'));
          this.setActions([]);
          window.api.downloadUpdate();
        },
      },
      { label: '×', dismiss: true, onClick: () => this.dismiss() },
    ]);
  }

  private dismiss(): void {
    if (this.latestVersion) {
      localStorage.setItem(DISMISSED_KEY, this.latestVersion);
    }
    this.bannerKind = '';
    this.banner?.remove();
    this.banner = null;
    this.textEl = null;
    this.actionsEl = null;
  }

  private ensureBanner(): void {
    if (this.banner) return;

    const banner = document.createElement('div');
    banner.className = 'update-banner';

    const text = document.createElement('span');
    text.className = 'update-banner__text';

    const actions = document.createElement('div');
    actions.className = 'update-banner__actions';

    banner.appendChild(text);
    banner.appendChild(actions);
    document.body.appendChild(banner);

    this.banner = banner;
    this.textEl = text;
    this.actionsEl = actions;
  }

  private setText(html: string): void {
    this.ensureBanner();
    this.bannerKind = '';
    if (this.textEl) {
      this.textEl.innerHTML = html;
    }
  }

  private setActions(actions: BannerAction[]): void {
    this.ensureBanner();
    if (!this.actionsEl) return;
    this.actionsEl.innerHTML = '';

    for (const action of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = action.label;
      btn.className = action.dismiss ? 'update-banner__dismiss' : 'update-banner__download';
      btn.addEventListener('click', action.onClick);
      this.actionsEl.appendChild(btn);
    }
  }
}

export const updateService = new UpdateService();
