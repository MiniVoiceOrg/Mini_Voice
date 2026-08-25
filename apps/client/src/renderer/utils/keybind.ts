/**
 * Utility for capturing and serializing KeyboardEvents into Electron Accelerator format
 * and friendly human-readable display strings.
 */

import { t } from '../i18n';

export interface ShortcutKeyCombo {
  accelerator: string;
  display: string;
}

export function formatKeyCombo(e: KeyboardEvent): ShortcutKeyCombo | null {
  // Ignore lone modifier keys
  if (['Control', 'Shift', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) {
    return null;
  }

  const parts: string[] = [];
  const displayParts: string[] = [];

  if (e.ctrlKey) {
    parts.push('CommandOrControl');
    displayParts.push('Ctrl');
  }
  if (e.altKey) {
    parts.push('Alt');
    displayParts.push('Alt');
  }
  if (e.shiftKey) {
    parts.push('Shift');
    displayParts.push('Shift');
  }
  if (e.metaKey) {
    parts.push('Super');
    displayParts.push('Win');
  }

  let mainKey = '';
  let displayKey = '';

  const code = e.code;
  const key = e.key;

  if (code.startsWith('Numpad')) {
    // Numpad0-9, NumpadAdd, etc.
    const num = code.replace('Numpad', '');
    if (num >= '0' && num <= '9') {
      mainKey = `num${num}`;
      displayKey = `Num ${num}`;
    } else if (num === 'Add') {
      mainKey = 'numadd';
      displayKey = 'Num +';
    } else if (num === 'Subtract') {
      mainKey = 'numsub';
      displayKey = 'Num -';
    } else if (num === 'Multiply') {
      mainKey = 'nummult';
      displayKey = 'Num *';
    } else if (num === 'Divide') {
      mainKey = 'numdiv';
      displayKey = 'Num /';
    } else if (num === 'Decimal') {
      mainKey = 'numdec';
      displayKey = 'Num .';
    } else {
      mainKey = `num${num.toLowerCase()}`;
      displayKey = `Num ${num}`;
    }
  } else if (/^F\d{1,2}$/i.test(key)) {
    mainKey = key.toUpperCase();
    displayKey = key.toUpperCase();
  } else if (code.startsWith('Digit')) {
    mainKey = code.replace('Digit', '');
    displayKey = mainKey;
  } else if (code.startsWith('Key')) {
    mainKey = code.replace('Key', '').toUpperCase();
    displayKey = mainKey;
  } else if (['Space', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(code)) {
    const map: Record<string, { accel: string; disp: string }> = {
      Space: { accel: 'Space', disp: t('keybind.space') },
      Backspace: { accel: 'Backspace', disp: 'Backspace' },
      Delete: { accel: 'Delete', disp: 'Del' },
      Insert: { accel: 'Insert', disp: 'Ins' },
      Home: { accel: 'Home', disp: 'Home' },
      End: { accel: 'End', disp: 'End' },
      PageUp: { accel: 'PageUp', disp: 'PgUp' },
      PageDown: { accel: 'PageDown', disp: 'PgDn' },
      ArrowUp: { accel: 'Up', disp: '↑' },
      ArrowDown: { accel: 'Down', disp: '↓' },
      ArrowLeft: { accel: 'Left', disp: '←' },
      ArrowRight: { accel: 'Right', disp: '→' },
      Tab: { accel: 'Tab', disp: 'Tab' },
    };
    mainKey = map[code]?.accel || code;
    displayKey = map[code]?.disp || code;
  } else if (key.length === 1) {
    mainKey = key.toUpperCase();
    displayKey = key.toUpperCase();
  } else {
    mainKey = key;
    displayKey = key;
  }

  if (!mainKey) return null;

  parts.push(mainKey);
  displayParts.push(displayKey);

  return {
    accelerator: parts.join('+'),
    display: displayParts.join(' + '),
  };
}
