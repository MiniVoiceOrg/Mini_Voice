import { app, BrowserWindow, Menu, NativeImage, nativeImage, Tray } from 'electron';
import fs from 'fs';
import path from 'path';

export interface VoiceStatus {
  inCall: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  isSpeaking: boolean;
}

// 32x32 pre-rendered pixel-crisp PNG icons (base64)
const TRAY_ICONS_BASE64 = {
  // White/silver microphone when in call & idle
  micIdle:
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA8ElEQVR4nO2W7Q2EIAyGGcERHIERGMERbgRGcBNGuBFuBEdgBPuH33cxKZcekUOhYkJo8iZ+AO9DK41C9MgMACcB3IySNY0HAPcCcO9A27OhBsCe+RfianP5x9zrunJgvVMAczsAAE7jovosQDi3dMdLBsBSnBFiaDIATFMAt5WAnvvxKACO5ekLAM7iQs+jjQjHbte2yBwBJrL4I9WKcYy/n4oBxO8H5U3sjrkN4AyLeQQiJV5zAjFFdk+zwJP2BIgMMmKq/pQghCIAqqp5dQBsLCqQJgB65/3Iab6eOAFeKwvE7QAiXoKUeMx79Gg+PvLRFXmTipBMAAAAAElFTkSuQmCC',
  // Vibrant green microphone (#23A55A) when voice activity is detected
  micSpeaking:
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABP0lEQVR4nO2Wyw2DMAyGMwIjVMoCjMAInDMFI7ABI3DKHIzQERghI1AhJdVPYptAyaEIS77kYX/4FZR65KRoa2ptTe+1vsroC4y2zJlKWzNpa5ZI17WKudOC3ZcEMIBB8iDj/AshfFg4M0gAzh8amf1acB6UTMdq0+87znkDRrjw9xkAPXO3hTONaDwGOwsQOxIhIUQTrIWaGI4CxHfVtn7SFMMmBTCfAJgFgLRYGYDN2kGAXXs5KSgFQKYgKcICKRCLMGnDuHVyAXJsJQCKGUSwNuUOIgi1AzvyIIpCvoRRrK3pYG3cG8XgaNVOHRzF5GMUOX0LALiHxZf3GAlg3AsoRYJ8GX8Snw4nOHYh7EXFhxRzPXIPWEkIbDW6rW4D4Hu7iRTbsyP2L/tPzBk+7FD6fwDFp2BPr3H+yCO3lw/D8uLvh5OzuAAAAABJRU5ErkJggg==',
  // Red microphone with slash (#ED4245) when muted
  micMuted:
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABJUlEQVR4nO2W0Q2DIBCGGcERHMERDAnvjtARHMENOgIjdISOwAhOQByhjcnZnNdDKRz0xUsuUTH3f8Dxq1JXJIbXpvPaTJBdieJsUa9N47V5em1eJNdnjZT4VvTGjHPiHwhpgB0EM8Zl/nasohwE7PcZwJQNEIKoCgAQd1LcxQJ4bUa4H3MAYmYcAnDZK4IAYmZOAawkgGV6oiqAU3xPFN8CfO7b2FMA78r4gtdmhkKPWCOCd9frOUscAAbiBYdWTHplyAZQ+4baROYAAD4tVkQ8AHGWsuIIYjiY/c62iwAgkI6siEXWWw2iR2K9OviKVgMoBgHG0pPESz6SMdqw6RAgviR8FWUaMwNgYaw7zZYDW3CWrfruCdnf9x8mEPzNv+KKv8cbxEUE/T6P5bEAAAAASUVORK5CYII=',
  // Red headphones off (#ED4245) when deafened
  deafened:
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABEklEQVR4nO2W3Q2EMAiAHcERHOFGuJCwR0dwhG7iKI7iBE1H8GLCA0GuhfoTHyThpeXnK1JL173yREmAn02V9T4BhgQ4JcA5AWbSmda2vf6M5CtpYIkjJVsrmsm2DUQArI7EGsi3FSIUAk9a4G2N9qR9aIWIItCSAAeD30A9wX19laBvrpXdfBpRjezqCXH65QAEr0S0OsnTD0pPmCDI11eFBDjyhmPrrRD8U4w1Y9l4Uey7IWoxpbFsvKzYuCAsMbnx7t7/sTNDWGO6ja0QlwFYIS4FsEBcDlCDuAWgBOEFsF8ZI4T3Gtp/GnYI+ZaUY9K7HpuHCR1iOhrzDIi2weRkiN2gezfE/QBdYcx/5ZVHyA/B+7CxJtiy5QAAAABJRU5ErkJggg==',
};

export class TrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow;
  private onQuitApp: () => void;

  private voiceStatus: VoiceStatus = {
    inCall: false,
    isMuted: false,
    isDeafened: false,
    isSpeaking: false,
  };

  private appLogoImage: NativeImage | null = null;
  private micIdleImage: NativeImage;
  private micSpeakingImage: NativeImage;
  private micMutedImage: NativeImage;
  private deafenedImage: NativeImage;

  constructor(mainWindow: BrowserWindow, onQuitApp: () => void) {
    this.mainWindow = mainWindow;
    this.onQuitApp = onQuitApp;

    // Load pre-rendered base64 tray images
    this.micIdleImage = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICONS_BASE64.micIdle}`);
    this.micSpeakingImage = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICONS_BASE64.micSpeaking}`);
    this.micMutedImage = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICONS_BASE64.micMuted}`);
    this.deafenedImage = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICONS_BASE64.deafened}`);

    this.initAppLogo();
    this.createTray();
  }

  private initAppLogo(): void {
    const iconCandidates = [
      path.join(__dirname, '../../build/icon.png'),
      path.join(__dirname, '../../build/icon.ico'),
      path.join(__dirname, '../../images/Logo.png'),
      path.join(__dirname, '../../src/renderer/assets/Logo.png'),
      path.join(__dirname, '../../assets/Logo.png'),
      path.join(app.getAppPath(), 'build/icon.png'),
      path.join(app.getAppPath(), 'build/icon.ico'),
      path.join(app.getAppPath(), 'images/Logo.png'),
      path.join(app.getAppPath(), 'src/renderer/assets/Logo.png'),
    ];
    const foundPath = iconCandidates.find((p) => fs.existsSync(p));
    if (foundPath) {
      const img = nativeImage.createFromPath(foundPath);
      // Resize to standard 32x32 / 16x16 tray size if needed
      this.appLogoImage = img.resize({ width: 32, height: 32, quality: 'best' });
    } else {
      this.appLogoImage = this.micIdleImage;
    }
  }

  private createTray(): void {
    const initialIcon = this.appLogoImage || this.micIdleImage;
    this.tray = new Tray(initialIcon);
    this.tray.setToolTip('Mini Voice');

    // Single click / double click to restore window
    this.tray.on('click', () => {
      this.showWindow();
    });
    this.tray.on('double-click', () => {
      this.showWindow();
    });

    this.updateTray();
  }

  public showWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    if (!this.mainWindow.isVisible()) {
      this.mainWindow.show();
    }
    this.mainWindow.focus();
  }

  public updateVoiceStatus(status: VoiceStatus): void {
    this.voiceStatus = { ...status };
    this.updateTray();
  }

  private updateTray(): void {
    if (!this.tray || this.tray.isDestroyed()) return;

    // 1. Determine tray icon
    let currentIcon: NativeImage;
    let tooltip: string;

    if (!this.voiceStatus.inCall) {
      currentIcon = this.appLogoImage || this.micIdleImage;
      tooltip = 'Mini Voice';
    } else if (this.voiceStatus.isDeafened) {
      currentIcon = this.deafenedImage;
      tooltip = 'Mini Voice (Áudio Mutado / Ensurdecido)';
    } else if (this.voiceStatus.isMuted) {
      currentIcon = this.micMutedImage;
      tooltip = 'Mini Voice (Microfone Mutado)';
    } else if (this.voiceStatus.isSpeaking) {
      currentIcon = this.micSpeakingImage;
      tooltip = 'Mini Voice (Microfone Ativo — Falando)';
    } else {
      currentIcon = this.micIdleImage;
      tooltip = 'Mini Voice (Em Chamada)';
    }

    this.tray.setImage(currentIcon);
    this.tray.setToolTip(tooltip);

    // 2. Build context menu
    const menuTemplate: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'Abrir Mini Voice',
        click: () => this.showWindow(),
      },
    ];

    if (this.voiceStatus.inCall) {
      menuTemplate.push({ type: 'separator' });

      // Mute / Unmute Microphone
      const isMuted = this.voiceStatus.isMuted;
      menuTemplate.push({
        label: isMuted ? 'Desmutar Microfone' : 'Mutar Microfone',
        click: () => {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('tray:toggle-mute');
          }
        },
      });

      // Deafen / Undeafen Audio (mutes both audio & mic, same as app behavior)
      const isDeafened = this.voiceStatus.isDeafened;
      menuTemplate.push({
        label: isDeafened ? 'Desmutar Áudio (Ouvir)' : 'Mutar Áudio (Ensurdecer)',
        click: () => {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('tray:toggle-deafen');
          }
        },
      });
    }

    menuTemplate.push({ type: 'separator' });
    menuTemplate.push({
      label: 'Fechar Mini Voice',
      click: () => {
        this.onQuitApp();
      },
    });

    const contextMenu = Menu.buildFromTemplate(menuTemplate);
    this.tray.setContextMenu(contextMenu);
  }

  public destroy(): void {
    if (this.tray && !this.tray.isDestroyed()) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
