import { escapeHtml } from '../utils/html';

interface UpdateAsset {
  name: string;
  url: string;
}

interface UpdateCheckResult {
  ok: boolean;
  tag?: string;
  name?: string;
  htmlUrl?: string;
  publishedAt?: string;
  assets?: UpdateAsset[];
  error?: string;
}

const DISMISSED_KEY = 'mini_voice_dismissed_update';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Checks GitHub for newer releases on startup and periodically, showing a
 * dismissible banner that links to the download when an update is available.
 */
class UpdateService {
  private currentVersion = '0.0.0';
  private banner: HTMLElement | null = null;

  public async init(): Promise<void> {
    if (!window.api?.checkForUpdates || !window.api?.getAppVersion) {
      return;
    }

    try {
      this.currentVersion = await window.api.getAppVersion();
    } catch {
      // Keep default; a failed version read simply disables the check.
      return;
    }

    // Slight delay so the app finishes booting before we hit the network.
    setTimeout(() => this.check(), 4000);
    setInterval(() => this.check(), CHECK_INTERVAL_MS);
  }

  private async check(): Promise<void> {
    try {
      const result = await window.api.checkForUpdates();
      if (!result?.ok || !result.tag) {
        return;
      }

      if (!this.isNewer(this.parse(result.tag), this.parse(this.currentVersion))) {
        return;
      }

      if (localStorage.getItem(DISMISSED_KEY) === result.tag) {
        return;
      }

      this.showBanner(result);
    } catch {
      // Network/parse errors are non-fatal for update checks.
    }
  }

  private parse(version: string): number[] {
    return String(version)
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  }

  private isNewer(a: number[], b: number[]): boolean {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const x = a[i] ?? 0;
      const y = b[i] ?? 0;
      if (x > y) return true;
      if (x < y) return false;
    }
    return false;
  }

  private showBanner(result: UpdateCheckResult): void {
    if (this.banner) {
      this.banner.remove();
    }

    const version = escapeHtml(result.tag ?? '');
    const downloadUrl = result.htmlUrl ?? '';

    const banner = document.createElement('div');
    banner.className = 'update-banner';
    banner.innerHTML = `
      <span class="update-banner__text">
        Nova versão <strong>${version}</strong> disponível.
      </span>
      <div class="update-banner__actions">
        <button type="button" class="update-banner__download">Baixar atualização</button>
        <button type="button" class="update-banner__dismiss" aria-label="Dispensar">&times;</button>
      </div>
    `;

    banner.querySelector('.update-banner__download')?.addEventListener('click', () => {
      if (downloadUrl) {
        window.api.openExternal(downloadUrl);
      }
    });

    banner.querySelector('.update-banner__dismiss')?.addEventListener('click', () => {
      if (result.tag) {
        localStorage.setItem(DISMISSED_KEY, result.tag);
      }
      banner.remove();
      this.banner = null;
    });

    document.body.appendChild(banner);
    this.banner = banner;
  }
}

export const updateService = new UpdateService();
