/**
 * Tiny catalog for the strings the main process owns (#16).
 *
 * Native dialogs are created by Electron's main process, so they can't reach
 * the renderer catalog. The renderer pushes the active language here through
 * the `app-set-language` IPC channel whenever it changes, and these few strings
 * follow along.
 */
export type MainLanguage = 'pt-BR' | 'en';

const CATALOGS = {
  'pt-BR': {
    'dialog.selectProfilePhoto': 'Selecionar Foto de Perfil',
    'dialog.selectSoundFile': 'Selecionar Arquivo de Som',
    'dialog.audioFilter': 'Áudio (WAV, MP3, OGG)',
    'dialog.selectSoundboardFolder': 'Selecionar Pasta de Sons (Soundboard)',
    'error.audioFileTooLarge': 'Arquivo de áudio muito grande (máximo 3MB)',
    'error.noPendingUpdate': 'Nenhuma atualização pendente',
    'error.updaterUnavailable': 'Updater indisponível',
    'error.updaterDevMode': 'Atualização automática indisponível em modo de desenvolvimento',
    'error.startServerFailed': 'Falha ao iniciar servidor',
  },
  en: {
    'dialog.selectProfilePhoto': 'Select Profile Picture',
    'dialog.selectSoundFile': 'Select Sound File',
    'dialog.audioFilter': 'Audio (WAV, MP3, OGG)',
    'dialog.selectSoundboardFolder': 'Select Sound Folder (Soundboard)',
    'error.audioFileTooLarge': 'Audio file is too large (3MB maximum)',
    'error.noPendingUpdate': 'No pending update',
    'error.updaterUnavailable': 'Updater unavailable',
    'error.updaterDevMode': 'Automatic updates are unavailable in development mode',
    'error.startServerFailed': 'Failed to start the server',
  },
} as const;

export type MainTranslationKey = keyof (typeof CATALOGS)['pt-BR'];

let currentLanguage: MainLanguage = 'pt-BR';

export function setMainLanguage(language: string | undefined): void {
  if (language === 'en' || language === 'pt-BR') {
    currentLanguage = language;
  }
}

export function mt(key: MainTranslationKey): string {
  return CATALOGS[currentLanguage][key] ?? CATALOGS['pt-BR'][key] ?? key;
}
