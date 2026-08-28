import { ChannelSummary, canAccessChannel } from '@monky/shared';
import { serverStore } from '../stores/serverStore';
import { showAlert } from '../views/Dialog';
import { t } from '../i18n';

/**
 * The private channel that blocks a voice move, or null when the move is fine
 * (#390).
 *
 * Whoever can move members usually manages channels too, which means they see
 * every private room — including the ones the person being moved cannot enter.
 * The server already refuses such a move, but silently: this mirrors the same
 * rule client-side so the warning names the channel instead of nothing
 * happening.
 *
 * An unknown channel is deliberately treated as allowed. The server stays the
 * authority, and guessing here would block a legitimate move on stale state.
 */
export function findBlockedMoveTarget(userId: string, channelId: string): ChannelSummary | null {
  const channel = serverStore.getChannel(channelId);
  if (!channel || !channel.isPrivate) return null;

  const allowed = canAccessChannel(
    channel,
    serverStore.getUserPermissions(userId),
    serverStore.getUserRoleIds(userId)
  );
  return allowed ? null : channel;
}

/**
 * Warns whoever is moving someone and reports whether the move must be dropped
 * (#390). Without this the request just fails server-side and nothing happens
 * on screen, which reads as a broken drag rather than a denied one.
 */
export function warnIfMoveBlocked(userId: string, nickname: string, channelId: string): boolean {
  const blocked = findBlockedMoveTarget(userId, channelId);
  if (!blocked) return false;

  void showAlert({
    title: t('main.moveBlockedTitle'),
    message: t('main.moveBlockedMessage', { user: nickname, channel: blocked.name }),
    variant: 'warning',
  });
  return true;
}
