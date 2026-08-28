import { compareVersionTags } from '../scripts/calculate-version.js';

const REPO = 'MonkyOrg/Monky';
const API = `https://api.github.com/repos/${REPO}`;

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface ReleaseInfo {
  version: string;
  tag: string;
  url: string;
  publishedAt: string;
  winSetup: ReleaseAsset | null;
  winPortable: ReleaseAsset | null;
  macArm64: ReleaseAsset | null;
  macX64: ReleaseAsset | null;
  cli: ReleaseAsset | null;
}

export interface DownloadData {
  stable: ReleaseInfo | null;
  beta: ReleaseInfo | null;
  releasesUrl: string;
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  published_at: string;
  draft: boolean;
  prerelease: boolean;
  assets: GitHubAsset[];
}

declare const data: DownloadData;
export { data };

/**
 * The GitHub API allows 60 requests/hour per anonymous IP, which a busy CI
 * runner can exhaust on its own. Inside Actions the token lifts that ceiling.
 */
function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'monky-docs-build',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Retrying a 404 or a bad token only delays the failure by a few seconds. */
function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) return error.status === 429 || error.status >= 500;
  return true;
}

async function fetchJson<T>(path: string, attempts = 3): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(`${API}${path}`, { headers: buildHeaders() });
      if (!response.ok) {
        throw new HttpError(
          response.status,
          `GitHub respondeu ${response.status} ${response.statusText} em ${path}`,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryable(error)) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function findAsset(assets: GitHubAsset[], pattern: RegExp): ReleaseAsset | null {
  const match = assets.find((asset) => pattern.test(asset.name));
  if (!match) return null;
  return { name: match.name, url: match.browser_download_url, size: match.size };
}

function toReleaseInfo(release: GitHubRelease): ReleaseInfo {
  const assets = release.assets || [];
  return {
    version: release.tag_name.replace(/^v/, ''),
    tag: release.tag_name,
    url: release.html_url,
    publishedAt: release.published_at,
    winSetup: findAsset(assets, /-win-x64-setup\.exe$/i),
    winPortable: findAsset(assets, /-win-x64-portable\.exe$/i),
    macArm64: findAsset(assets, /-mac-arm64\.dmg$/i),
    macX64: findAsset(assets, /-mac-x64\.dmg$/i),
    cli: findAsset(assets, /^monky-cli-.+\.tgz$/i),
  };
}

async function loadReleases(): Promise<DownloadData> {
  const [latest, recent] = await Promise.all([
    fetchJson<GitHubRelease>('/releases/latest'),
    fetchJson<GitHubRelease[]>('/releases?per_page=30'),
  ]);

  // The API lists releases by date, so the newest beta is picked by comparing
  // versions instead of trusting the order (v3.10.0 would lose to v3.9.0).
  const betas = recent.filter((release) => release.prerelease && !release.draft);
  const newestBeta = betas.reduce<GitHubRelease | null>((best, candidate) => {
    if (!best) return candidate;
    return compareVersionTags(candidate.tag_name, best.tag_name) > 0 ? candidate : best;
  }, null);

  const stable = toReleaseInfo(latest);
  const beta = newestBeta ? toReleaseInfo(newestBeta) : null;

  // A beta only matters while it is ahead of the stable channel; once promoted,
  // the same version sits in both and offering it twice just adds confusion.
  const betaIsAhead = beta && compareVersionTags(beta.tag, stable.tag) > 0;

  return {
    stable,
    beta: betaIsAhead ? beta : null,
    releasesUrl: `https://github.com/${REPO}/releases`,
  };
}

export default {
  async load(): Promise<DownloadData> {
    try {
      return await loadReleases();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      // Failing the CI build keeps the previous deploy — with working links —
      // online, which beats replacing it with a page that downloads nothing.
      if (process.env.CI) {
        throw new Error(`Não foi possível ler as releases do GitHub: ${reason}`);
      }

      console.warn(`[download.data] releases indisponíveis (${reason}); seguindo sem links.`);
      return { stable: null, beta: null, releasesUrl: `https://github.com/${REPO}/releases` };
    }
  },
};
