import { networkClient } from '../core/NetworkClient';

const DEFAULT_AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64"><rect width="24" height="24" fill="#1c232d" rx="12"/><circle cx="12" cy="8" r="4" fill="#9da7b3"/><path d="M4 20c0-4.418 3.582-8 8-8s8 3.582 8 8" fill="#9da7b3"/></svg>`;

export const DEFAULT_AVATAR_URL = `data:image/svg+xml;base64,${btoa(DEFAULT_AVATAR_SVG)}`;

export function getAvatarUrl(url?: string | null): string {
  if (url && url.trim().length > 0) {
    // Relative avatar paths (served over HTTP by the server) must be resolved
    // against the connected server's HTTP base URL.
    if (url.startsWith('/avatars/')) {
      const base = networkClient.getHttpBaseUrl();
      return base ? `${base}${url}` : DEFAULT_AVATAR_URL;
    }
    return url;
  }
  return DEFAULT_AVATAR_URL;
}

/**
 * Saved-server icons must be persisted as absolute URLs. `getAvatarUrl` resolves
 * relative `/avatars/...` paths against the *currently connected* server, so a
 * stored relative path made every other server in the rail request its icon from
 * the wrong host and render broken (#312).
 */
export function toAbsoluteServerIconUrl(
  host: string,
  port: number,
  iconUrl?: string | null
): string | null {
  if (!iconUrl || iconUrl.trim().length === 0) return null;
  if (!iconUrl.startsWith('/')) return iconUrl;
  const cleanHost = host.trim().replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '');
  return `http://${cleanHost}:${port}${iconUrl}`;
}
