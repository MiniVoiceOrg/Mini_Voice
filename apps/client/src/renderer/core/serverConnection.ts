import type { AuthSuccessPayload } from '@monky/shared';
import { MessageType } from '@monky/shared';
import { networkClient, type NetworkClient } from './NetworkClient';
import { sessionManager } from './SessionManager';
import { webRtcManager } from './WebRtcManager';
import { voiceStore } from '../stores/voiceStore';
import { clientLog } from './ClientLogService';

interface ClientIdentity {
  publicKey: string;
  clientId: string;
}

/**
 * Connects to a server and puts it on screen, keeping every server already
 * connected alive in the background (#400).
 *
 * Before this, entering a server tore the previous connection down, which
 * dropped the call and every unread message with it. Now walking into another
 * server is like opening another window on it: the previous one stays
 * connected, still receiving messages, and coming back to it is instant.
 */
export async function openServerSession(
  host: string,
  port: number,
  identity: ClientIdentity,
  nickname: string,
  password?: string
): Promise<AuthSuccessPayload> {
  clientLog.info('CONNECTION', `Opening server session: ${host}:${port}`, { nickname });
  const previous = sessionManager.getActive();
  const session = sessionManager.create(host, port, nickname, password);
  sessionManager.activate(session.key);

  try {
    return await session.client.connect(host, port, identity, nickname, password);
  } catch (err) {
    clientLog.error('CONNECTION', `Failed to open session ${host}:${port}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    // The session never really came up; dropping it keeps the rail honest.
    sessionManager.remove(session.key);
    if (previous && sessionManager.has(previous.key)) {
      sessionManager.activate(previous.key);
    }
    throw err;
  }
}

/**
 * Connection of the server hosting the current call.
 *
 * Leaving a call has to talk to the server the call is on, which is not
 * necessarily the one on screen (#400) — the user may have walked over to
 * another server while still talking.
 */
export function callClient(): NetworkClient {
  const key = voiceStore.voiceSessionKey;
  const session = key ? sessionManager.get(key) : undefined;
  return session ? session.client : networkClient;
}

/**
 * Rejoins the call on a server the user is not looking at.
 *
 * `MainView.rejoinVoiceChannel` awaits the microphone before sending anything,
 * and everything after that await runs with the globals already restored to the
 * visible server — which would move the call to the wrong server (#400). This
 * path touches no shared global: it talks to the session it was given.
 */
export async function rejoinCallOnSession(sessionKey: string, channelId: string): Promise<void> {
  clientLog.info('CONNECTION', `Rejoining call on session ${sessionKey}`, { channelId });
  const session = sessionManager.get(sessionKey);
  if (!session) return;

  webRtcManager.closeAllPeers();
  voiceStore.setChannel(channelId, sessionKey);
  session.client.send(MessageType.VOICE_JOIN, {
    channelId,
    isMuted: voiceStore.isMuted,
    isDeafened: voiceStore.isDeafened,
  });

  for (const peer of session.participants.getInVoiceChannel(channelId)) {
    if (session.serverStore.isMySession(peer.user.sessionId)) continue;
    await webRtcManager.connectToPeer(peer.user.sessionId || peer.user.id, true);
  }
}

/**
 * Brings an already-connected server back on screen without touching the
 * network: its socket and state were kept while it was in the background.
 *
 * A session that is merely present but not connected (it dropped and is
 * retrying) is refused, so the caller falls back to a real connection attempt
 * instead of showing an empty server.
 */
export function showServerSession(key: string): boolean {
  const session = sessionManager.get(key);
  if (!session || session.client.getStatus() !== 'CONNECTED') {
    clientLog.warn('CONNECTION', `Cannot show session ${key} — not connected`);
    return false;
  }
  clientLog.info('CONNECTION', `Showing server session: ${key}`);
  sessionManager.activate(key);
  return true;
}
