/**
 * CLI i18n module.
 *
 * Mirrors the client's approach: pt-BR is the source-of-truth, English mirrors
 * it, and `t()` replaces `{placeholders}` at call sites.
 *
 * Language is persisted in `monky.json` (`language` field) and selected on first
 * run via an interactive prompt (in English, since it's universal).
 */
import fs from 'fs';
import path from 'path';
import { ptBR } from './locales/pt-BR';
import { en } from './locales/en';

export type CliTranslationKey = keyof typeof ptBR;
export type CliTranslationMap = Record<CliTranslationKey, string>;
export type SupportedCliLanguage = 'pt-BR' | 'en';

export const SUPPORTED_CLI_LANGUAGES: Array<{ code: SupportedCliLanguage; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
];

const FALLBACK_LANGUAGE: SupportedCliLanguage = 'en';

const CATALOGS: Record<SupportedCliLanguage, CliTranslationMap> = {
  'pt-BR': ptBR,
  en,
};

let currentLanguage: SupportedCliLanguage = FALLBACK_LANGUAGE;

export function getCliLanguage(): SupportedCliLanguage {
  return currentLanguage;
}

export function setCliLanguage(language: SupportedCliLanguage): void {
  if (SUPPORTED_CLI_LANGUAGES.some((l) => l.code === language)) {
    currentLanguage = language;
  }
}

/**
 * Translates `key`, replacing `{placeholders}` with `params`.
 * Missing keys fall back to pt-BR and, ultimately, to the key itself.
 */
export function t(key: CliTranslationKey, params?: Record<string, string | number>): string {
  const catalog = CATALOGS[currentLanguage] ?? CATALOGS[FALLBACK_LANGUAGE];
  const template = catalog[key] ?? CATALOGS['pt-BR'][key] ?? String(key);

  if (!params) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] !== undefined ? String(params[name]) : match
  );
}

// ── Language persistence ──────────────────────────────────────────────────

const GLOBAL_CONFIG_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.monky'
);
const GLOBAL_CONFIG_PATH = path.join(GLOBAL_CONFIG_DIR, 'cli-config.json');

interface GlobalCliConfig {
  language?: SupportedCliLanguage;
}

function readGlobalConfig(): GlobalCliConfig {
  try {
    if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
    }
  } catch { /* ignore */ }
  return {};
}

function writeGlobalConfig(config: GlobalCliConfig): void {
  try {
    fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch { /* best-effort */ }
}

/**
 * Loads the persisted language or returns null if none is set.
 */
export function loadPersistedLanguage(): SupportedCliLanguage | null {
  const config = readGlobalConfig();
  if (config.language && SUPPORTED_CLI_LANGUAGES.some((l) => l.code === config.language)) {
    return config.language;
  }
  return null;
}

/** Persists the chosen language to the global CLI config. */
export function persistLanguage(language: SupportedCliLanguage): void {
  const config = readGlobalConfig();
  config.language = language;
  writeGlobalConfig(config);
}

/**
 * Initializes i18n: loads persisted preference. If none exists, returns false
 * so the caller can trigger the first-run language prompt.
 */
export function initCliI18n(): boolean {
  const stored = loadPersistedLanguage();
  if (stored) {
    setCliLanguage(stored);
    return true;
  }
  // Try to detect from OS locale
  const osLocale = (process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || '').toLowerCase();
  if (osLocale.startsWith('pt')) {
    setCliLanguage('pt-BR');
    return false; // still prompt to confirm
  }
  setCliLanguage('en');
  return false;
}
