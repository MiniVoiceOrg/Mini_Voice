import { BrowserWindow } from 'electron';
import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi';
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

interface ParsedHotkey {
  id: string;
  mainKeyCode: number;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

// Maps an Electron-accelerator token (as produced by the renderer KeybindsTab,
// which builds accelerator strings from KeyboardEvent.key) to the corresponding
// uiohook keycode. Letters, digits and F-keys are generated; named keys and
// punctuation are listed explicitly.
const ACCELERATOR_KEY_TO_UIOHOOK: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  const K: Record<string, number> = UiohookKey;
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') map[letter] = K[letter];
  for (let d = 0; d <= 9; d++) map[String(d)] = K[String(d)];
  for (let f = 1; f <= 24; f++) map[`F${f}`] = K[`F${f}`];
  Object.assign(map, {
    ' ': K.Space,
    Space: K.Space,
    Tab: K.Tab,
    Enter: K.Enter,
    Return: K.Enter,
    Backspace: K.Backspace,
    Delete: K.Delete,
    Del: K.Delete,
    Insert: K.Insert,
    Escape: K.Escape,
    Esc: K.Escape,
    Home: K.Home,
    End: K.End,
    PageUp: K.PageUp,
    PageDown: K.PageDown,
    ArrowUp: K.ArrowUp,
    Up: K.ArrowUp,
    ArrowDown: K.ArrowDown,
    Down: K.ArrowDown,
    ArrowLeft: K.ArrowLeft,
    Left: K.ArrowLeft,
    ArrowRight: K.ArrowRight,
    Right: K.ArrowRight,
    CapsLock: K.CapsLock,
    ';': K.Semicolon,
    '=': K.Equal,
    ',': K.Comma,
    '-': K.Minus,
    '.': K.Period,
    '/': K.Slash,
    '`': K.Backquote,
    '[': K.BracketLeft,
    '\\': K.Backslash,
    ']': K.BracketRight,
    "'": K.Quote,
  });
  return map;
})();

function classifyModifierToken(token: string): 'ctrl' | 'alt' | 'shift' | 'meta' | null {
  switch (token) {
    case 'CommandOrControl':
    case 'CmdOrCtrl':
    case 'Control':
    case 'Ctrl':
      return 'ctrl';
    case 'Alt':
    case 'Option':
    case 'AltGr':
      return 'alt';
    case 'Shift':
      return 'shift';
    case 'Super':
    case 'Meta':
    case 'Command':
    case 'Cmd':
      return 'meta';
    default:
      return null;
  }
}

// Parses an Electron accelerator string (e.g. "CommandOrControl+Shift+M", "Q")
// into a uiohook keycode plus the required modifier state. Returns null when the
// main key cannot be mapped, so an unknown binding is skipped instead of
// misfiring on the wrong key.
export function parseAcceleratorToHotkey(id: string, accelerator: string): ParsedHotkey | null {
  if (!accelerator) return null;
  // Do not trim tokens: the space key is a legitimate single-character token.
  const parts = accelerator.split('+').filter((part) => part.length > 0);
  let ctrl = false;
  let alt = false;
  let shift = false;
  let meta = false;
  let mainKeyCode: number | null = null;

  for (const part of parts) {
    const modifier = classifyModifierToken(part);
    if (modifier === 'ctrl') ctrl = true;
    else if (modifier === 'alt') alt = true;
    else if (modifier === 'shift') shift = true;
    else if (modifier === 'meta') meta = true;
    else {
      const code = ACCELERATOR_KEY_TO_UIOHOOK[part];
      if (typeof code === 'number') mainKeyCode = code;
    }
  }

  if (mainKeyCode === null) return null;
  return { id, mainKeyCode, ctrl, alt, shift, meta };
}

export class GlobalInputHook {
  private mainWindow: BrowserWindow | null = null;
  private isHookRunning = false;
  private isCapturing = false;
  private isPttActive = false;
  private pttConfig: PttConfig = { enabled: false, key: null };
  private listenersRegistered = false;
  private actionHotkeys: ParsedHotkey[] = [];
  private soundboardHotkeys: ParsedHotkey[] = [];
  private pressedKeys: Set<number> = new Set();

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
      this.handleKeyDown(e);
    });

    uIOhook.on('keyup', (e) => {
      this.handleKeyUp(e);
    });

    uIOhook.on('mousedown', (e) => {
      this.handleMouseDown(Number((e as any).button));
    });

    uIOhook.on('mouseup', (e) => {
      this.handleMouseUp(Number((e as any).button));
    });
  }

  private ensureHookState(): void {
    const shouldRun =
      this.isCapturing ||
      this.pttConfig.enabled ||
      this.actionHotkeys.length > 0 ||
      this.soundboardHotkeys.length > 0;
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

  public setActionHotkeys(shortcuts: Array<{ action: string; accelerator: string }>): boolean {
    this.actionHotkeys = this.parseHotkeys(
      shortcuts.map((item) => ({ id: item.action, accelerator: item.accelerator }))
    );
    this.ensureHookState();
    return true;
  }

  public setSoundboardHotkeys(shortcuts: Array<{ soundName: string; accelerator: string }>): boolean {
    this.soundboardHotkeys = this.parseHotkeys(
      shortcuts.map((item) => ({ id: item.soundName, accelerator: item.accelerator }))
    );
    this.ensureHookState();
    return true;
  }

  private parseHotkeys(list: Array<{ id: string; accelerator: string }>): ParsedHotkey[] {
    const parsed: ParsedHotkey[] = [];
    for (const item of list) {
      if (!item.id || !item.accelerator) continue;
      const hotkey = parseAcceleratorToHotkey(item.id, item.accelerator);
      if (hotkey) {
        parsed.push(hotkey);
      } else {
        console.warn(
          `[GlobalInputHook] Could not map accelerator "${item.accelerator}" for "${item.id}"; shortcut disabled.`
        );
      }
    }
    return parsed;
  }

  private matchHotkeys(keycode: number, event: UiohookKeyboardEvent): void {
    if (this.actionHotkeys.length === 0 && this.soundboardHotkeys.length === 0) return;

    const ctrl = !!event.ctrlKey;
    const alt = !!event.altKey;
    const shift = !!event.shiftKey;
    const meta = !!event.metaKey;

    for (const hotkey of this.actionHotkeys) {
      if (this.hotkeyMatches(hotkey, keycode, ctrl, alt, shift, meta)) {
        this.emitActionTriggered(hotkey.id);
      }
    }
    for (const hotkey of this.soundboardHotkeys) {
      if (this.hotkeyMatches(hotkey, keycode, ctrl, alt, shift, meta)) {
        this.emitSoundboardTriggered(hotkey.id);
      }
    }
  }

  private hotkeyMatches(
    hotkey: ParsedHotkey,
    keycode: number,
    ctrl: boolean,
    alt: boolean,
    shift: boolean,
    meta: boolean
  ): boolean {
    return (
      hotkey.mainKeyCode === keycode &&
      hotkey.ctrl === ctrl &&
      hotkey.alt === alt &&
      hotkey.shift === shift &&
      hotkey.meta === meta
    );
  }

  private handleKeyDown(event: UiohookKeyboardEvent): void {
    const keycode = Number(event.keycode);
    const keyName = KEYCODE_TO_NAME.get(keycode) || `Key_${keycode}`;
    const isRepeat = this.pressedKeys.has(keycode);
    this.pressedKeys.add(keycode);

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

    // Action/soundboard hotkeys fire once per physical press (OS auto-repeat is
    // ignored via pressedKeys). uiohook only observes input, so the key still
    // passes through to the focused app/game — unlike Electron globalShortcut,
    // which swallowed single keys like "Q" (#571).
    if (!isRepeat) {
      this.matchHotkeys(keycode, event);
    }
  }

  private handleKeyUp(event: UiohookKeyboardEvent): void {
    const keycode = Number(event.keycode);
    const keyName = KEYCODE_TO_NAME.get(keycode) || `Key_${keycode}`;
    this.pressedKeys.delete(keycode);

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

  private emitActionTriggered(action: string): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('shortcut:action-triggered', action);
    }
  }

  private emitSoundboardTriggered(soundName: string): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('soundboard:shortcut-triggered', soundName);
    }
  }

  public destroy(): void {
    this.isCapturing = false;
    this.isPttActive = false;
    this.pttConfig = { enabled: false, key: null };
    this.actionHotkeys = [];
    this.soundboardHotkeys = [];
    this.pressedKeys.clear();
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
