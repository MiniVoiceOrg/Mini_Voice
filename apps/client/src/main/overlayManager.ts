import { BrowserWindow, screen } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import {
  OVERLAY_DEFAULT_WIDTH,
  OVERLAY_DEFAULT_HEIGHT,
} from '@monky/shared';
import type {
  OverlayBounds,
  OverlayConfig,
  OverlayPosition,
  OverlaySignalPayload,
  OverlaySyncState,
} from '@monky/shared';

const DEFAULT_OVERLAY_WIDTH = OVERLAY_DEFAULT_WIDTH;
const DEFAULT_OVERLAY_HEIGHT = OVERLAY_DEFAULT_HEIGHT;
const PADDING = 24;

export class OverlayManager {
  private overlayWindow: BrowserWindow | null = null;
  private mainWindow: BrowserWindow;
  private currentConfig: OverlayConfig | null = null;
  private boundsDebounceTimeout: NodeJS.Timeout | null = null;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
  }

  public setMainWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
  }

  public isOpen(): boolean {
    return !!this.overlayWindow && !this.overlayWindow.isDestroyed();
  }

  public getConfig(): OverlayConfig | null {
    return this.currentConfig;
  }

  public open(config: OverlayConfig): boolean {
    this.currentConfig = { ...config };

    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      if (config.position !== 'custom') {
        const { x, y } = this.calculatePosition(config.position, this.overlayWindow.getBounds());
        this.overlayWindow.setPosition(x, y);
      }
      this.overlayWindow.showInactive();
      this.notifyConfigUpdated(this.currentConfig);
      this.notifyStateChanged(true);
      return true;
    }

    const initialBounds = this.getInitialBounds(config);

    this.overlayWindow = new BrowserWindow({
      x: initialBounds.x,
      y: initialBounds.y,
      width: initialBounds.width,
      height: initialBounds.height,
      minWidth: 160,
      minHeight: 120,
      frame: false,
      transparent: true,
      hasShadow: false,
      alwaysOnTop: true,
      resizable: true,
      skipTaskbar: true,
      backgroundColor: '#00000000',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        webSecurity: true,
      },
    });

    this.overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    this.overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    if (process.env.VITE_DEV_SERVER_URL) {
      const devUrl = new URL(process.env.VITE_DEV_SERVER_URL);
      devUrl.searchParams.set('overlay', '1');
      this.overlayWindow.loadURL(devUrl.toString());
    } else {
      const distHtmlPath = path.join(__dirname, '../../dist/index.html');
      const fileUrl = pathToFileURL(distHtmlPath);
      fileUrl.searchParams.set('overlay', '1');
      this.overlayWindow.loadURL(fileUrl.toString());
    }

    this.overlayWindow.once('ready-to-show', () => {
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.showInactive();
        this.notifyStateChanged(true);
        if (this.currentConfig) {
          this.notifyConfigUpdated(this.currentConfig);
        }
      }
    });

    const handleBoundsChange = () => {
      if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;
      if (this.boundsDebounceTimeout) clearTimeout(this.boundsDebounceTimeout);
      this.boundsDebounceTimeout = setTimeout(() => {
        if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;
        const bounds = this.overlayWindow.getBounds();
        if (this.currentConfig) {
          this.currentConfig.bounds = bounds;
        }
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('overlay:config-updated', this.currentConfig!);
        }
      }, 250);
    };

    this.overlayWindow.on('moved', handleBoundsChange);
    this.overlayWindow.on('resized', handleBoundsChange);

    this.overlayWindow.on('closed', () => {
      this.overlayWindow = null;
      if (this.boundsDebounceTimeout) {
        clearTimeout(this.boundsDebounceTimeout);
        this.boundsDebounceTimeout = null;
      }
      this.notifyStateChanged(false);
    });

    return true;
  }

  public close(): boolean {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.close();
      this.overlayWindow = null;
      this.notifyStateChanged(false);
      return true;
    }
    return false;
  }

  public setConfig(configPartial: Partial<OverlayConfig>): void {
    if (!this.currentConfig) {
      this.currentConfig = {
        mode: 'cameras-only',
        layout: 'grid',
        position: 'bottom-right',
        cardOpacity: 0.85,
        focusActiveSpeaker: false,
        ...configPartial,
      };
    } else {
      this.currentConfig = { ...this.currentConfig, ...configPartial };
    }

    if (configPartial.position && configPartial.position !== 'custom' && this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      const { x, y } = this.calculatePosition(configPartial.position, this.overlayWindow.getBounds());
      this.overlayWindow.setPosition(x, y);
    }

    this.notifyConfigUpdated(this.currentConfig);
  }

  public resetBounds(): void {
    if (!this.currentConfig) return;
    this.currentConfig.bounds = undefined;
    const pos = this.currentConfig.position === 'custom' ? 'bottom-right' : this.currentConfig.position;
    const { x, y } = this.calculatePosition(pos, { width: DEFAULT_OVERLAY_WIDTH, height: DEFAULT_OVERLAY_HEIGHT });

    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.setBounds({
        x,
        y,
        width: DEFAULT_OVERLAY_WIDTH,
        height: DEFAULT_OVERLAY_HEIGHT,
      });
    }

    this.notifyConfigUpdated(this.currentConfig);
  }

  public sendSignal(payload: OverlaySignalPayload): void {
    if (payload.target === 'overlay') {
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.webContents.send('overlay:signal-received', payload.signal);
      }
    } else if (payload.target === 'main') {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('overlay:signal-received', payload.signal);
      }
    }
  }

  public sendSyncState(state: OverlaySyncState): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.webContents.send('overlay:sync-state-received', state);
    }
  }

  private notifyStateChanged(isOpen: boolean): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('overlay:state-changed', isOpen);
    }
  }

  private notifyConfigUpdated(config: OverlayConfig): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('overlay:config-updated', config);
    }
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.webContents.send('overlay:config-updated', config);
    }
  }

  private getInitialBounds(config: OverlayConfig): OverlayBounds {
    const width = config.bounds?.width || DEFAULT_OVERLAY_WIDTH;
    const height = config.bounds?.height || DEFAULT_OVERLAY_HEIGHT;

    if (config.position === 'custom' && config.bounds) {
      const display = screen.getDisplayNearestPoint({ x: config.bounds.x, y: config.bounds.y });
      const workArea = display.workArea;
      const x = Math.max(workArea.x, Math.min(config.bounds.x, workArea.x + workArea.width - width));
      const y = Math.max(workArea.y, Math.min(config.bounds.y, workArea.y + workArea.height - height));
      return { x, y, width, height };
    }

    const pos = config.position === 'custom' ? 'bottom-right' : config.position;
    const { x, y } = this.calculatePosition(pos, { width, height });
    return { x, y, width, height };
  }

  private calculatePosition(
    position: OverlayPosition,
    size: { width: number; height: number }
  ): { x: number; y: number } {
    let targetDisplay = screen.getPrimaryDisplay();
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const mainBounds = this.mainWindow.getBounds();
      targetDisplay = screen.getDisplayNearestPoint({
        x: mainBounds.x + mainBounds.width / 2,
        y: mainBounds.y + mainBounds.height / 2,
      });
    }

    const { x: areaX, y: areaY, width: areaW, height: areaH } = targetDisplay.workArea;

    switch (position) {
      case 'top-left':
        return { x: areaX + PADDING, y: areaY + PADDING };
      case 'top-right':
        return { x: areaX + areaW - size.width - PADDING, y: areaY + PADDING };
      case 'bottom-left':
        return { x: areaX + PADDING, y: areaY + areaH - size.height - PADDING };
      case 'bottom-right':
      default:
        return { x: areaX + areaW - size.width - PADDING, y: areaY + areaH - size.height - PADDING };
    }
  }
}
