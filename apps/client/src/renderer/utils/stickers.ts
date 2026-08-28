/**
 * Chat stickers (#356).
 *
 * A sticker is not a new kind of message: it is a normal image attachment plus a
 * marker in the message text that tells the client "render this attachment as a
 * fixed-size square instead of a regular photo". Keeping the marker in `content`
 * means stickers need no protocol, database or server change at all — they ride
 * the attachment pipeline that already exists, and message history replays them
 * for free.
 *
 * A client that does not know about stickers simply shows the literal marker and
 * the image below it, so nothing breaks across app versions.
 */

/** Attachment ids are UUIDs; the bounded character class keeps the regex safe. */
const STICKER_TOKEN = /\[\[sticker:([A-Za-z0-9-]{1,64})\]\]/g;

/** Builds the marker that flags `attachmentId` as a sticker. */
export function stickerToken(attachmentId: string): string {
  return `[[sticker:${attachmentId}]]`;
}

/** Returns the attachment ids flagged as stickers, in the order they appear. */
export function extractStickerIds(content: string): string[] {
  const ids: string[] = [];
  for (const match of content.matchAll(STICKER_TOKEN)) {
    if (!ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
}

/**
 * Removes only the markers listed in `ids` — that is, the ones whose attachment
 * actually resolved to a sticker. A marker that resolves to nothing (a user
 * typed it by hand, or the attachment was evicted before the message was sent)
 * stays visible as literal text, so a message can never be silently blanked out.
 */
export function stripStickerTokens(content: string, ids: readonly string[]): string {
  if (ids.length === 0) return content;
  const rendered = new Set(ids);
  return content.replace(STICKER_TOKEN, (match, id: string) => (rendered.has(id) ? '' : match)).trim();
}
