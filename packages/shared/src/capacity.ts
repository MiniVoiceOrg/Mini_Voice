export interface CapacityEstimate {
  cpuCores: number;
  ramTotalGb: number;
  uploadMbps: number;
  maxAudioParticipants: number;
  maxScreenShareParticipants: number;
  maxCameraParticipants: number;
  recommendedMaxUsers: number;
}

export class CapacityEstimator {
  /**
   * Estimates SFU participant capacity based on system resources and upload bandwidth.
   *
   * @param uploadMbps Upload bandwidth available to the host server in Mbps (default 100 Mbps)
   * @param cpuCores Available CPU logical cores (default 4)
   * @param ramTotalGb Available RAM in Gigabytes (default 8)
   */
  public static estimate(
    uploadMbps = 100,
    cpuCores = 4,
    ramTotalGb = 8
  ): CapacityEstimate {
    const uploadKbps = Math.max(10, uploadMbps) * 1000;

    // Audio stream: ~48 kbps per participant speaking/listening
    // In SFU: Total outbound audio = N_speakers * (N_participants - 1) * 48 kbps
    // Assuming up to 3 simultaneous speakers:
    const audioPerUserEgressKbps = 3 * 48; // ~144 kbps per listener
    const maxAudioByBandwidth = Math.floor(uploadKbps / audioPerUserEgressKbps);
    const maxAudioByCpu = cpuCores * 150; // ~150 audio streams per core
    const maxAudioByRam = Math.floor(ramTotalGb * 80); // ~80 users per GB
    const maxAudioParticipants = Math.max(
      2,
      Math.min(maxAudioByBandwidth, maxAudioByCpu, maxAudioByRam)
    );

    // Screen Share (1080p 60fps @ 6 Mbps):
    // Outbound bandwidth = (N_viewers - 1) * 6000 kbps
    const screenShareBitrateKbps = 6000;
    const maxScreenShareParticipants = Math.max(
      2,
      Math.floor(uploadKbps / screenShareBitrateKbps) + 1
    );

    // Camera (720p @ 500 kbps, assuming 4 active webcams):
    const cameraEgressPerUserKbps = 4 * 500; // 2000 kbps
    const maxCameraParticipants = Math.max(
      2,
      Math.floor(uploadKbps / cameraEgressPerUserKbps) + 1
    );

    // Recommended safe maximum users for the server
    const recommendedMaxUsers = Math.max(
      5,
      Math.min(maxAudioParticipants, Math.floor(maxScreenShareParticipants * 1.5))
    );

    // Deliberately returns only numbers: an earlier version also built a
    // ready-made sentence here, hardcoded in Portuguese, which reached English
    // operators untranslated. Each layer phrases it through its own i18n (#515).
    return {
      cpuCores,
      ramTotalGb,
      uploadMbps,
      maxAudioParticipants,
      maxScreenShareParticipants,
      maxCameraParticipants,
      recommendedMaxUsers,
    };
  }
}
