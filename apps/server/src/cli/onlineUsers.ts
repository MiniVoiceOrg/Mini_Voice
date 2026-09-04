import http from 'http';
import { LIMITS } from '@monky/shared';
import { ANSI, color } from './constants';
import { readLocalConfig } from './context';
import { t } from './i18n/index';
import { confirm } from './prompts';
import { RegisteredServer } from './registry';

/** Port a registered server answers on, using the same precedence as `monky status`. */
export function resolveServerPort(server: RegisteredServer): number {
  return server.port ?? readLocalConfig(server.dataDir).port ?? LIMITS.DEFAULT_PORT;
}

/**
 * People currently connected to a running server, or `null` when it cannot be
 * reached — stopped, listening elsewhere, or an older build without `/preview`.
 * Counts distinct people, so one person on two devices is still one (#309).
 */
export function countOnlineUsers(port: number, timeoutMs = 1500): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const request = http.get(
      { host: '127.0.0.1', port, path: '/preview', timeout: timeoutMs },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          finish(null);
          return;
        }

        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
          // The endpoint answers with a small object; anything larger means we
          // are talking to something that is not a Monky server.
          if (body.length > 64_000) request.destroy();
        });
        response.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            finish(typeof parsed?.userCount === 'number' ? parsed.userCount : null);
          } catch {
            finish(null);
          }
        });
      }
    );

    request.on('timeout', () => request.destroy());
    request.on('error', () => finish(null));
  });
}

/**
 * Checks whether anyone is on the server before an action that disconnects
 * everybody, and asks the owner to confirm (#334). Non-interactive shells only
 * get the warning: blocking a scripted `monky stop` on a prompt nobody can
 * answer would be worse than the surprise.
 */
export async function confirmDisconnectingUsers(
  server: RegisteredServer,
  action: string
): Promise<boolean> {
  const onlineUsers = await countOnlineUsers(resolveServerPort(server));
  if (onlineUsers === null || onlineUsers <= 0) return true;

  const people = onlineUsers === 1 ? t('online.one') : t('online.many', { count: onlineUsers });
  console.log(color(t('online.warning', { people, server: server.name || server.dataDir }), ANSI.yellow));
  console.log(color(t('online.willDisconnect', { action }), ANSI.yellow));

  if (!process.stdin.isTTY) {
    console.log(color(t('online.nonInteractive'), ANSI.dim));
    return true;
  }

  const confirmed = await confirm(t('online.confirmAction', { action }), false);
  if (!confirmed) {
    console.log(color(t('prompt.cancelled'), ANSI.yellow));
  }
  return confirmed;
}
