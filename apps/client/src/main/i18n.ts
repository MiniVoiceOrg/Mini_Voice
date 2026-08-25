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
    'tray.tooltipIdle': 'Mini Voice',
    'tray.tooltipDeafened': 'Mini Voice (Áudio Mutado / Ensurdecido)',
    'tray.tooltipMuted': 'Mini Voice (Microfone Mutado)',
    'tray.tooltipSpeaking': 'Mini Voice (Microfone Ativo — Falando)',
    'tray.tooltipInCall': 'Mini Voice (Em Chamada)',
    'tray.open': 'Abrir Mini Voice',
    'tray.muteMic': 'Mutar Microfone',
    'tray.unmuteMic': 'Desmutar Microfone',
    'tray.deafen': 'Mutar Áudio (Ensurdecer)',
    'tray.undeafen': 'Desmutar Áudio (Ouvir)',
    'tray.quit': 'Fechar Mini Voice',
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
    'tray.tooltipIdle': 'Mini Voice',
    'tray.tooltipDeafened': 'Mini Voice (Audio Muted / Deafened)',
    'tray.tooltipMuted': 'Mini Voice (Microphone Muted)',
    'tray.tooltipSpeaking': 'Mini Voice (Microphone Active — Speaking)',
    'tray.tooltipInCall': 'Mini Voice (In Call)',
    'tray.open': 'Open Mini Voice',
    'tray.muteMic': 'Mute Microphone',
    'tray.unmuteMic': 'Unmute Microphone',
    'tray.deafen': 'Mute Audio (Deafen)',
    'tray.undeafen': 'Unmute Audio (Listen)',
    'tray.quit': 'Quit Mini Voice',
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
