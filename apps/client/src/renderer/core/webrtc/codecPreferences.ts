import { settingsStore } from '../../stores/settingsStore';

/**
 * Video codec prioritization for WebRTC peer connections.
 *
 * Supports user-customizable preferred codecs with automatic hardware fallback:
 * - auto: prioritized as AV1 -> VP9 -> VP8 -> H.264
 * - av1 / vp9 / vp8 / h264: places chosen codec first, keeping all others as fallback
 */

export type PreferredVideoCodec = 'auto' | 'av1' | 'vp9' | 'vp8' | 'h264';

export const VIDEO_CODEC_PRIORITY_ORDER = [
  'video/av1',
  'video/vp9',
  'video/vp8',
  'video/h264',
] as const;

export interface CodecCapabilityLike {
  mimeType: string;
  clockRate?: number;
  channels?: number;
  sdpFmtpLine?: string;
}

export function getPriorityListForCodec(preferred: PreferredVideoCodec): string[] {
  switch (preferred) {
    case 'av1':
      return ['video/av1', 'video/vp9', 'video/vp8', 'video/h264'];
    case 'vp9':
      return ['video/vp9', 'video/av1', 'video/vp8', 'video/h264'];
    case 'vp8':
      return ['video/vp8', 'video/av1', 'video/vp9', 'video/h264'];
    case 'h264':
      return ['video/h264', 'video/av1', 'video/vp9', 'video/vp8'];
    case 'auto':
    default:
      return ['video/av1', 'video/vp9', 'video/vp8', 'video/h264'];
  }
}

/**
 * Sorts an array of WebRTC video codec capabilities according to the preference order.
 * Codecs not explicitly listed (e.g. rtx, red, ulpfec) maintain their relative position after primary codecs.
 */
export function sortVideoCodecs<T extends CodecCapabilityLike>(
  codecs: T[],
  preferred: PreferredVideoCodec = 'auto'
): T[] {
  const priorityList = getPriorityListForCodec(preferred);
  const getPriority = (mimeType: string): number => {
    const lower = mimeType.toLowerCase();
    const index = priorityList.findIndex((pref) => lower === pref);
    return index !== -1 ? index : 999;
  };

  return [...codecs].sort((a, b) => {
    const prioA = getPriority(a.mimeType);
    const prioB = getPriority(b.mimeType);
    return prioA - prioB;
  });
}

/**
 * Retrieves the supported video codecs from the WebRTC runtime, sorted by preference.
 */
export function getPrioritizedVideoCodecs(
  preferred: PreferredVideoCodec = settingsStore?.preferredVideoCodec ?? 'auto'
): CodecCapabilityLike[] {
  if (typeof RTCRtpReceiver === 'undefined' || typeof (RTCRtpReceiver as any).getCapabilities !== 'function') {
    return [];
  }
  const capabilities = (RTCRtpReceiver as any).getCapabilities('video');
  if (!capabilities || !Array.isArray(capabilities.codecs) || capabilities.codecs.length === 0) {
    return [];
  }
  return sortVideoCodecs(capabilities.codecs, preferred);
}

/**
 * Applies the prioritized video codecs to all video transceivers on a given RTCPeerConnection.
 */
export function applyVideoCodecPreferences(
  pc: RTCPeerConnection,
  preferred: PreferredVideoCodec = settingsStore?.preferredVideoCodec ?? 'auto'
): void {
  try {
    const prioritizedCodecs = getPrioritizedVideoCodecs(preferred);
    if (prioritizedCodecs.length === 0) return;

    for (const transceiver of pc.getTransceivers()) {
      const isVideo =
        transceiver.receiver?.track?.kind === 'video' ||
        transceiver.sender?.track?.kind === 'video' ||
        (transceiver as any).kind === 'video';

      if (isVideo && typeof (transceiver as any).setCodecPreferences === 'function') {
        try {
          (transceiver as any).setCodecPreferences(prioritizedCodecs);
        } catch {
          // If browser/device rejects the preferences array, leave default negotiation intact
        }
      }
    }
  } catch {
    // Gracefully ignore environments without getTransceivers / setCodecPreferences
  }
}
