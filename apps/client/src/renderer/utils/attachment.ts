import { AttachmentKind } from '@mini-voice/shared';
import { networkClient } from '../core/NetworkClient';

/**
 * Resolves an attachment URL served by the host (e.g. "/attachments/<file>")
 * against the connected server's HTTP base URL, mirroring getAvatarUrl (#11).
 * Returns an empty string when there is no url (evicted) or no connection.
 */
export function getAttachmentUrl(url?: string | null): string {
  if (!url || url.trim().length === 0) return '';
  if (url.startsWith('/attachments/')) {
    const base = networkClient.getHttpBaseUrl();
    return base ? `${base}${url}` : '';
  }
  return url;
}

/** Human-readable file size, e.g. 1536 -> "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  const rounded = value >= 100 || i === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[i]}`;
}

/** Material Symbols icon name for a non-previewable attachment chip. */
export function fileIconName(kind: AttachmentKind, mimeType: string, name: string): string {
  if (kind === 'image') return 'image';
  if (kind === 'video') return 'movie';
  const lower = (name || '').toLowerCase();
  if (mimeType.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a|aac)$/.test(lower)) return 'audio_file';
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) return 'picture_as_pdf';
  if (/\.(zip|rar|7z|tar|gz|bz2)$/.test(lower)) return 'folder_zip';
  if (/\.(doc|docx|odt|rtf)$/.test(lower)) return 'description';
  if (/\.(xls|xlsx|ods|csv)$/.test(lower)) return 'table_chart';
  if (/\.(ppt|pptx|odp)$/.test(lower)) return 'slideshow';
  if (/\.(js|ts|tsx|jsx|py|java|c|cpp|cs|go|rs|rb|php|html|css|json|xml|sh)$/.test(lower)) return 'code';
  return 'draft';
}
