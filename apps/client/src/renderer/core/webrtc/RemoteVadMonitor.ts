import type { ParticipantManager } from '../ParticipantManager';
import type { PeerSession } from '../WebRtcManager';

/**
 * RemoteVadMonitor monitors incoming RTP audio levels for remote peers via WebRTC getStats()
 * without fetching full stats reports, preventing garbage collection pressure (#411).
 */
export class RemoteVadMonitor {
  private remoteAudioVads: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor(private getVoiceParticipants: () => ParticipantManager) {}

  public setupRemoteVad(peerSessionId: string, getSession: () => PeerSession | undefined): void {
    this.cleanupRemoteVad(peerSessionId);
    let isSpeaking = false;
    let silenceCounter = 0;

    const interval = setInterval(async () => {
      const session = getSession();
      if (!session || !session.pc || session.pc.connectionState === 'closed') {
        return;
      }
      try {
        // Use the audio receiver's getStats() instead of pc.getStats() to avoid
        // fetching the full stats report (video, ICE, codec, etc.), which creates
        // thousands of short-lived objects per second and pressures the GC (#411).
        const audioReceiver = session.pc.getReceivers().find((r) => r.track?.kind === 'audio');
        if (!audioReceiver) return;

        const stats = await audioReceiver.getStats();
        let audioLevel: number | undefined;
        for (const report of stats.values()) {
          if (report.type === 'inbound-rtp' && (report.kind === 'audio' || report.mediaType === 'audio')) {
            if (typeof report.audioLevel === 'number') {
              audioLevel = report.audioLevel;
              break;
            }
          }
        }

        if (audioLevel !== undefined) {
          // WebRTC RFC 6464 audioLevel ranges from 0.0 to 1.0 (linear scale).
          // Packets with active voice are typically above 0.01.
          const isVoiceActive = audioLevel > 0.01;

          if (isVoiceActive) {
            silenceCounter = 0;
            if (!isSpeaking) {
              isSpeaking = true;
              this.getVoiceParticipants().setSpeaking(peerSessionId, true);
            }
          } else {
            silenceCounter++;
            // At 150ms interval, 3 consecutive silent reads ≈ 450ms — still
            // responsive enough for a natural speaking-indicator transition.
            if (silenceCounter > 3 && isSpeaking) {
              isSpeaking = false;
              this.getVoiceParticipants().setSpeaking(peerSessionId, false);
            }
          }
        }
      } catch (e) {}
    }, 150);

    this.remoteAudioVads.set(peerSessionId, interval);
  }

  public cleanupRemoteVad(peerSessionId: string): void {
    const interval = this.remoteAudioVads.get(peerSessionId);
    if (interval) {
      clearInterval(interval);
      this.remoteAudioVads.delete(peerSessionId);
    }
  }

  public cleanupAll(): void {
    for (const interval of this.remoteAudioVads.values()) {
      clearInterval(interval);
    }
    this.remoteAudioVads.clear();
  }
}
