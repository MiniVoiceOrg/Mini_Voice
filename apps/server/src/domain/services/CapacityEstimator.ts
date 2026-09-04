import os from 'os';
import {
  CapacityEstimate,
  CapacityEstimator as SharedCapacityEstimator,
  HostSpecs,
} from '@monky/shared';

export type { CapacityEstimate };

export class CapacityEstimator {
  /**
   * Reads what this machine actually has.
   *
   * Sent to the client so the estimator stops describing the admin's desktop
   * while they are configuring a server that runs somewhere else (#515).
   */
  public static getHostSpecs(): HostSpecs {
    const cpus = os.cpus();
    return {
      cpuCores: Array.isArray(cpus) && cpus.length > 0 ? cpus.length : 1,
      ramTotalGb: Math.round((os.totalmem() / (1024 * 1024 * 1024)) * 10) / 10,
    };
  }

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
    const specs = CapacityEstimator.getHostSpecs();
    const cpuCores = overrideCores ?? specs.cpuCores;
    const ramTotalGb = overrideRamGb ?? specs.ramTotalGb;
    return SharedCapacityEstimator.estimate(uploadMbps, cpuCores, ramTotalGb);
  }
}
