/**
 * Escapes a string for safe interpolation into HTML, preventing XSS when
 * rendering user-provided content (nicknames, messages, server names, etc.).
 */
export function escapeHtml(str: string | null | undefined): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
