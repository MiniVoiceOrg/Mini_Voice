import os from 'os';
import {
  CapacityEstimate,
  CapacityEstimator as SharedCapacityEstimator,
} from '@monky/shared';

export type { CapacityEstimate };

export class CapacityEstimator {
  /**
   * Estimates SFU participant capacity based on system resources and upload bandwidth.
   *
   * @param uploadMbps Upload bandwidth available to the host server in Mbps (default 100 Mbps)
   */
  public static estimate(
    uploadMbps = 100,
    overrideCores?: number,
    overrideRamGb?: number
  ): CapacityEstimate {
    const cpus = os.cpus();
    const cpuCores =
      overrideCores ?? (Array.isArray(cpus) && cpus.length > 0 ? cpus.length : 1);
    const ramTotalGb =
      overrideRamGb ??
      Math.round((os.totalmem() / (1024 * 1024 * 1024)) * 10) / 10;
    return SharedCapacityEstimator.estimate(uploadMbps, cpuCores, ramTotalGb);
  }
}
