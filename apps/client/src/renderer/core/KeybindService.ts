import { ActionShortcutBinding } from '@monky/shared';
import { settingsStore } from '../stores/settingsStore';
import { appEvents } from './EventBus';

export interface KeybindActionDefinition {
  id: string;
  nameKey: string;
  descKey: string;
  icon: string;
}

export const KEYBIND_ACTIONS: KeybindActionDefinition[] = [
  {
    id: 'toggle_mute',
    nameKey: 'keybinds.actionToggleMute',
    descKey: 'keybinds.actionToggleMuteDesc',
    icon: 'mic_off',
  },
  {
    id: 'toggle_deafen',
    nameKey: 'keybinds.actionToggleDeafen',
    descKey: 'keybinds.actionToggleDeafenDesc',
    icon: 'headset_off',
  },
  {
    id: 'toggle_camera',
    nameKey: 'keybinds.actionToggleCamera',
    descKey: 'keybinds.actionToggleCameraDesc',
    icon: 'videocam',
  },
  {
    id: 'toggle_screen_share',
    nameKey: 'keybinds.actionToggleScreenShare',
    descKey: 'keybinds.actionToggleScreenShareDesc',
    icon: 'screen_share',
  },
];

export class KeybindService {
  private cleanupListener: (() => void) | null = null;

  public init(): void {
    if (this.cleanupListener) {
      this.cleanupListener();
      this.cleanupListener = null;
    }

    if (window.api?.onActionShortcutTriggered) {
      this.cleanupListener = window.api.onActionShortcutTriggered((action: string) => {
        this.handleAction(action);
      });
    }

    this.syncShortcuts();
  }

  public syncShortcuts(): void {
    if (!window.api?.registerActionShortcuts) return;

    const shortcuts: ActionShortcutBinding[] = [];
    for (const [action, binding] of Object.entries(settingsStore.keybindShortcuts)) {
      if (binding && binding.accelerator) {
        shortcuts.push({
          action,
          accelerator: binding.accelerator,
        });
      }
    }

    window.api.registerActionShortcuts(shortcuts).catch((err) => {
      console.warn('[KeybindService] Failed to register action shortcuts:', err);
    });
  }

  private handleAction(action: string): void {
    switch (action) {
      case 'toggle_mute':
        appEvents.emit('keybind.toggle_mute');
        break;
      case 'toggle_deafen':
        appEvents.emit('keybind.toggle_deafen');
        break;
      case 'toggle_camera':
        appEvents.emit('keybind.toggle_camera');
        break;
      case 'toggle_screen_share':
        appEvents.emit('keybind.toggle_screen_share');
        break;
      default:
        console.warn(`[KeybindService] Unknown action: ${action}`);
        break;
    }
  }

  public destroy(): void {
    if (this.cleanupListener) {
      this.cleanupListener();
      this.cleanupListener = null;
    }
  }
}

export const keybindService = new KeybindService();
