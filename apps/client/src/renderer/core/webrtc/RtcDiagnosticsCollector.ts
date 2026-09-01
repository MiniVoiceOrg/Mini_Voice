import {
  MessageType,
  RtcCandidateInfo,
  RtcDiagnosticsReportPayload,
} from '@monky/shared';
import type { NetworkClient } from '../NetworkClient';
import type { PeerSession } from '../WebRtcManager';

/**
 * RtcDiagnosticsCollector collects ICE candidate-pair stats and round-trip times (RTT)
 * from peer connections and sends reports to the server for diagnosing connectivity.
 */
export class RtcDiagnosticsCollector {
  public async getPeerPing(session: PeerSession | undefined): Promise<number | null> {
    if (!session || !session.pc) return null;
    try {
      const stats = await session.pc.getStats();
      for (const report of stats.values()) {
        if (
          report.type === 'candidate-pair' &&
          (report.state === 'succeeded' || report.nominated) &&
          report.currentRoundTripTime !== undefined
        ) {
          return Math.round(report.currentRoundTripTime * 1000);
        }
      }
    } catch (e) {}
    return null;
  }

  public async getAverageP2pPing(peers: Map<string, PeerSession>): Promise<number | null> {
    const pings: number[] = [];
    for (const session of peers.values()) {
      const ping = await this.getPeerPing(session);
      if (ping !== null) pings.push(ping);
    }
    if (pings.length === 0) return null;
    return Math.round(pings.reduce((a, b) => a + b, 0) / pings.length);
  }

  public async sendDiagnosticsReport(
    peerSessionId: string,
    session: PeerSession | undefined,
    signalClient: NetworkClient
  ): Promise<void> {
    let localCandidate: RtcCandidateInfo | null = null;
    let remoteCandidate: RtcCandidateInfo | null = null;
    let iceGatheringState = 'unknown';
    let signalingState = 'unknown';

    if (session?.pc) {
      try {
        iceGatheringState = session.pc.iceGatheringState;
        signalingState = session.pc.signalingState;

        const stats = await session.pc.getStats();
        // Find the candidate pair that was nominated or last attempted
        for (const report of stats.values()) {
          if (
            report.type === 'candidate-pair' &&
            (report.nominated || report.state === 'failed' || report.state === 'succeeded')
          ) {
            const localId: string | undefined = report.localCandidateId;
            const remoteId: string | undefined = report.remoteCandidateId;

            if (localId) {
              const local = stats.get(localId);
              if (local) {
                localCandidate = {
                  type: local.candidateType ?? 'unknown',
                  address: local.address ?? local.ip,
                  port: local.port,
                  protocol: local.protocol,
                };
              }
            }

            if (remoteId) {
              const remote = stats.get(remoteId);
              if (remote) {
                remoteCandidate = {
                  type: remote.candidateType ?? 'unknown',
                  address: remote.address ?? remote.ip,
                  port: remote.port,
                  protocol: remote.protocol,
                };
              }
            }
            break;
          }
        }
      } catch (e) {
        console.warn('[WebRTC:Diagnostics] Failed to collect diagnostics stats:', e);
      }
    }

    const payload: RtcDiagnosticsReportPayload = {
      targetSessionId: peerSessionId,
      reason: `ice_restart=${session?.iceRestartAttempts ?? 0}, hard_reconnect=${session?.reconnectAttempts ?? 0}`,
      iceGatheringState,
      signalingState,
      iceRestartAttempts: session?.iceRestartAttempts ?? 0,
      hardReconnectAttempts: session?.reconnectAttempts ?? 0,
      localCandidate,
      remoteCandidate,
    };

    signalClient.send(MessageType.RTC_DIAGNOSTICS_REPORT, payload);
  }
}
