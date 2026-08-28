/**
 * Version arithmetic and release selection for the in-app updater, kept free of
 * any Electron import so it can be unit tested (#354).
 */

const GITHUB_REPO = 'MonkyOrg/Monky';

export interface GithubRelease {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: Array<{ name: string; browser_download_url: string }>;
}

export function cleanVer(v?: string): string {
  return String(v ?? '')
    .replace(/^v/i, '')
    .trim();
}

/**
 * Compares two semver strings following SemVer precedence, including the
 * pre-release rule that a release (e.g. `1.8.0`) outranks any of its
 * pre-releases (e.g. `1.8.0-beta.3`), and that `-beta.10 > -beta.2`.
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const na = cleanVer(a).split('-');
  const nb = cleanVer(b).split('-');
  const pa = na[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pb = nb[0].split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  // Numeric parts equal — apply pre-release precedence.
  const preA = na.slice(1).join('-');
  const preB = nb.slice(1).join('-');
  if (!preA && !preB) return 0;
  if (!preA) return 1; // a is a release, b is a pre-release
  if (!preB) return -1; // a is a pre-release, b is a release
  return comparePrerelease(preA, preB);
}

function comparePrerelease(a: string, b: string): number {
  const ai = a.split('.');
  const bi = b.split('.');
  const len = Math.max(ai.length, bi.length);
  for (let i = 0; i < len; i++) {
    const x = ai[i];
    const y = bi[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = parseInt(x, 10) - parseInt(y, 10);
      if (d !== 0) return d > 0 ? 1 : -1;
    } else if (xn !== yn) {
      return xn ? -1 : 1; // numeric identifiers have lower precedence
    } else if (x > y) {
      return 1;
    } else if (x < y) {
      return -1;
    }
  }
  return 0;
}

export function isNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

/**
 * Highest-versioned release of a listing, ignoring drafts and untagged entries.
 *
 * The listing is never assumed to be in chronological order: GitHub returns it
 * ordered by tag name, so the newest build is not necessarily the first entry.
 */
export function pickBestRelease(list: unknown): GithubRelease | null {
  const candidates = (Array.isArray(list) ? (list as GithubRelease[]) : []).filter(
    (r) => r && !r.draft && r.tag_name
  );
  let best: GithubRelease | null = null;
  for (const r of candidates) {
    if (!best || compareVersions(cleanVer(r.tag_name), cleanVer(best.tag_name)) > 0) {
      best = r;
    }
  }
  return best;
}

/**
 * Update feed for one release. Its assets are published side by side under a
 * per-tag path, so that folder works as a "generic" electron-updater feed:
 * `latest.yml` sits next to the installer it describes, and the manifest
 * references the installer by a relative name.
 */
export function feedUrlForTag(tag: string): string {
  return `https://github.com/${GITHUB_REPO}/releases/download/${tag}`;
}
