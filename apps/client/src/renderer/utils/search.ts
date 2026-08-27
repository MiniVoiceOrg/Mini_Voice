/**
 * Utilitário de busca textual flexível (#288)
 * Ignora maiúsculas/minúsculas, acentuação (UTF-8 diacríticos) e caracteres especiais.
 */
export function normalizeSearchString(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function matchesSearch(target: string, query: string): boolean {
  if (!query || !query.trim()) return true;
  if (!target) return false;

  const cleanTarget = normalizeSearchString(target);
  const cleanQuery = normalizeSearchString(query).trim();

  // 1. Verificação direta de substring normalizada
  if (cleanTarget.includes(cleanQuery)) return true;

  // 2. Verificação alfanumérica pura (ignora pontuação, traços e símbolos)
  const alphaTarget = cleanTarget.replace(/[^a-z0-9]/g, '');
  const alphaQuery = cleanQuery.replace(/[^a-z0-9]/g, '');
  if (alphaQuery && alphaTarget.includes(alphaQuery)) return true;

  // 3. Verificação por múltiplos tokens/palavras
  const tokens = cleanQuery.split(/\s+/).filter(Boolean);
  return tokens.every((token) => cleanTarget.includes(token));
}
