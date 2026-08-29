import { EmojiPicker } from '../views/EmojiPicker';

/**
 * Attaches an emoji picker popup to a text input field (#402).
 *
 * Clicking the button opens the EmojiPicker in emoji-only mode. Selecting an
 * emoji inserts it at the current caret position and dispatches an 'input' event
 * so form validation and reactive listeners stay in sync.
 */
export function attachInputEmojiPicker(
  container: HTMLElement,
  input: HTMLInputElement,
  button: HTMLElement,
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' = 'bottom-right'
): () => void {
  let picker: EmojiPicker | null = null;

  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (picker?.isOpen()) {
      picker.close();
      picker = null;
      return;
    }

    picker = new EmojiPicker({
      container,
      anchor: button,
      emojiOnly: true,
      position,
      onSelectEmoji: (emoji: string) => {
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        const value = input.value;
        input.value = value.slice(0, start) + emoji + value.slice(end);
        const nextPos = start + emoji.length;
        input.setSelectionRange(nextPos, nextPos);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      },
    });

    void picker.open();
  };

  button.addEventListener('click', onClick);

  return () => {
    button.removeEventListener('click', onClick);
    picker?.destroy();
    picker = null;
  };
}
