import { BrowserWindow } from 'electron';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import type { PttConfig, PttKeyBinding } from '@monky/shared';

const KEYCODE_TO_NAME = new Map<number, string>(
  Object.entries(UiohookKey).map(([name, code]) => [code as number, name])
);

export function formatKeyDisplay(name: string): string {
  const overrides: Record<string, string> = {
    Space: 'Espaço',
    Escape: 'Esc',
    Control: 'Ctrl',
    ControlRight: 'Ctrl Direito',
    Alt: 'Alt',
    AltRight: 'Alt Gr',
    Shift: 'Shift',
    ShiftRight: 'Shift Direito',
    CapsLock: 'Caps Lock',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Enter: 'Enter',
    ArrowUp: 'Seta Cima',
    ArrowDown: 'Seta Baixo',
    ArrowLeft: 'Seta Esquerda',
    ArrowRight: 'Seta Direita',
    PageUp: 'Page Up',
    PageDown: 'Page Down',
    Home: 'Home',
    End: 'End',
    Insert: 'Insert',
    Delete: 'Delete',
  };
  return overrides[name] || name;
}

export class GlobalInputHook {
  private mainWindow: BrowserWindow | null = null;
  private isHookRunning = false;
  private isCapturing = false;
  private isPttActive = false;
  private pttConfig: PttConfig = { enabled: false, key: null };
  private listenersRegistered = false;

  public init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
    if (!this.listenersRegistered) {
      this.setupListeners();
      this.listenersRegistered = true;
    }
  }

  private setupListeners(): void {
    uIOhook.removeAllListeners('keydown');
    uIOhook.removeAllListeners('keyup');
    uIOhook.removeAllListeners('mousedown');
    uIOhook.removeAllListeners('mouseup');

    uIOhook.on('keydown', (e) => {
      this.handleKeyDown(Number((e as any).keycode));
    });

    uIOhook.on('keyup', (e) => {
      this.handleKeyUp(Number((e as any).keycode));
    });

    uIOhook.on('mousedown', (e) => {
      this.handleMouseDown(Number((e as any).button));
    });

    uIOhook.on('mouseup', (e) => {
      this.handleMouseUp(Number((e as any).button));
    });
  }

  private ensureHookState(): void {
    const shouldRun = this.isCapturing || this.pttConfig.enabled;
    if (shouldRun && !this.isHookRunning) {
      try {
        uIOhook.start();
        this.isHookRunning = true;
      } catch (err) {
        console.warn('[GlobalInputHook] Failed to start uIOhook:', err);
      }
    } else if (!shouldRun && this.isHookRunning) {
      try {
        uIOhook.stop();
        this.isHookRunning = false;
      } catch (err) {
        console.warn('[GlobalInputHook] Failed to stop uIOhook:', err);
      }
    }
  }

  public setPttConfig(config: PttConfig): boolean {
    this.pttConfig = config;
    if (!config.enabled && this.isPttActive) {
      this.isPttActive = false;
      this.emitPttState(false);
    }
    this.ensureHookState();
    return true;
  }

  public startCapture(): boolean {
    this.isCapturing = true;
    this.ensureHookState();
    return true;
  }

  public stopCapture(): boolean {
    this.isCapturing = false;
    this.ensureHookState();
    return true;
  }

  private handleKeyDown(keycode: number): void {
    const keyName = KEYCODE_TO_NAME.get(keycode) || `Key_${keycode}`;

    if (this.isCapturing) {
      const binding: PttKeyBinding = {
        code: keyName,
        display: formatKeyDisplay(keyName),
        keyType: 'keyboard',
        keyCode: keycode,
      };
      this.isCapturing = false;
      this.ensureHookState();
      this.emitCaptured(binding);
      return;
    }

    if (this.pttConfig.enabled && this.pttConfig.key) {
      const key = this.pttConfig.key;
      if (key.keyType === 'keyboard' && (key.keyCode === keycode || key.code === keyName)) {
        if (!this.isPttActive) {
          this.isPttActive = true;
          this.emitPttState(true);
        }
      }
    }
  }

  private handleKeyUp(keycode: number): void {
    const keyName = KEYCODE_TO_NAME.get(keycode) || `Key_${keycode}`;

    if (this.pttConfig.enabled && this.pttConfig.key) {
      const key = this.pttConfig.key;
      if (key.keyType === 'keyboard' && (key.keyCode === keycode || key.code === keyName)) {
        if (this.isPttActive) {
          this.isPttActive = false;
          this.emitPttState(false);
        }
      }
    }
  }

  private handleMouseDown(button: number): void {
    if (this.isCapturing) {
      // Button mappings: 1=Left, 2=Right, 3=Middle, 4=Back/Side1, 5=Forward/Side2
      const buttonNames: Record<number, string> = {
        1: 'Mouse 1 (Esquerdo)',
        2: 'Mouse 2 (Direito)',
        3: 'Mouse 3 (Scroll)',
        4: 'Mouse 4 (Lateral Traseiro)',
        5: 'Mouse 5 (Lateral Frontal)',
      };
      const binding: PttKeyBinding = {
        code: `Mouse${button}`,
        display: buttonNames[button] || `Mouse ${button}`,
        keyType: 'mouse',
        mouseButton: button,
      };
      this.isCapturing = false;
      this.ensureHookState();
      this.emitCaptured(binding);
      return;
    }

    if (this.pttConfig.enabled && this.pttConfig.key) {
      const key = this.pttConfig.key;
      if (key.keyType === 'mouse' && key.mouseButton === button) {
        if (!this.isPttActive) {
          this.isPttActive = true;
          this.emitPttState(true);
        }
      }
    }
  }

  private handleMouseUp(button: number): void {
    if (this.pttConfig.enabled && this.pttConfig.key) {
      const key = this.pttConfig.key;
      if (key.keyType === 'mouse' && key.mouseButton === button) {
        if (this.isPttActive) {
          this.isPttActive = false;
          this.emitPttState(false);
        }
      }
    }
  }

  private emitPttState(active: boolean): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('ptt:state-changed', active);
    }
  }

  private emitCaptured(binding: PttKeyBinding): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('ptt:captured', binding);
    }
  }

  public destroy(): void {
    this.isCapturing = false;
    this.isPttActive = false;
    this.pttConfig = { enabled: false, key: null };
    if (this.isHookRunning) {
      try {
        uIOhook.stop();
      } catch {}
      this.isHookRunning = false;
    }
    uIOhook.removeAllListeners();
    this.listenersRegistered = false;
    this.mainWindow = null;
  }
}

export const globalInputHook = new GlobalInputHook();
