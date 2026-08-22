/**
 * Tiny catalog for the strings the main process owns (#16).
 *
 * Native dialogs are created by Electron's main process, so they can't reach
 * the renderer catalog. The renderer pushes the active language here through
 * the `app-set-language` IPC channel whenever it changes, and these few strings
 * follow along.
 */
export type MainLanguage = 'pt-BR' | 'en';
declare const CATALOGS: {
    readonly 'pt-BR': {
        readonly 'dialog.selectProfilePhoto': "Selecionar Foto de Perfil";
        readonly 'dialog.selectSoundFile': "Selecionar Arquivo de Som";
        readonly 'dialog.audioFilter': "Áudio (WAV, MP3, OGG)";
        readonly 'dialog.selectSoundboardFolder': "Selecionar Pasta de Sons (Soundboard)";
        readonly 'error.audioFileTooLarge': "Arquivo de áudio muito grande (máximo 3MB)";
        readonly 'error.noPendingUpdate': "Nenhuma atualização pendente";
        readonly 'error.updaterUnavailable': "Updater indisponível";
        readonly 'error.updaterDevMode': "Atualização automática indisponível em modo de desenvolvimento";
        readonly 'error.startServerFailed': "Falha ao iniciar servidor";
    };
    readonly en: {
        readonly 'dialog.selectProfilePhoto': "Select Profile Picture";
        readonly 'dialog.selectSoundFile': "Select Sound File";
        readonly 'dialog.audioFilter': "Audio (WAV, MP3, OGG)";
        readonly 'dialog.selectSoundboardFolder': "Select Sound Folder (Soundboard)";
        readonly 'error.audioFileTooLarge': "Audio file is too large (3MB maximum)";
        readonly 'error.noPendingUpdate': "No pending update";
        readonly 'error.updaterUnavailable': "Updater unavailable";
        readonly 'error.updaterDevMode': "Automatic updates are unavailable in development mode";
        readonly 'error.startServerFailed': "Failed to start the server";
    };
};
export type MainTranslationKey = keyof (typeof CATALOGS)['pt-BR'];
export declare function setMainLanguage(language: string | undefined): void;
export declare function mt(key: MainTranslationKey): string;
export {};
//# sourceMappingURL=i18n.d.ts.map