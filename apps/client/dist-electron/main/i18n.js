"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setMainLanguage = setMainLanguage;
exports.mt = mt;
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
};
let currentLanguage = 'pt-BR';
function setMainLanguage(language) {
    if (language === 'en' || language === 'pt-BR') {
        currentLanguage = language;
    }
}
function mt(key) {
    return CATALOGS[currentLanguage][key] ?? CATALOGS['pt-BR'][key] ?? key;
}
//# sourceMappingURL=i18n.js.map