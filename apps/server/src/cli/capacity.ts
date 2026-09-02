import { CapacityEstimate } from '@monky/shared';
import { CapacityEstimator } from '../domain/services/CapacityEstimator';
import { ANSI, color } from './constants';
import { t } from './i18n/index';
import { ask } from './prompts';

/**
 * Upload assumed when nobody says otherwise.
 *
 * The estimator used to take this silently, which made the report look like a
 * measurement of the host when it was really a guess (#515).
 */
export const DEFAULT_UPLOAD_MBPS = 100;

/**
 * Asks for the host's upload bandwidth.
 *
 * CPU and RAM are read from the machine, but upload cannot be: measuring it
 * would mean shipping a speed test, and the value the operator was sold by
 * their provider is both cheaper to obtain and more honest than a number we
 * invented. Non-interactive runs keep the documented default.
 */
export async function askUploadMbps(): Promise<{ uploadMbps: number; assumed: boolean }> {
  if (!process.stdin.isTTY) {
    return { uploadMbps: DEFAULT_UPLOAD_MBPS, assumed: true };
  }

  const answer = await ask(t('capacity.askUpload'), String(DEFAULT_UPLOAD_MBPS));
  const parsed = Number.parseFloat(String(answer).replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { uploadMbps: DEFAULT_UPLOAD_MBPS, assumed: true };
  }
  return { uploadMbps: parsed, assumed: false };
}

export interface HostCapacityReport {
  estimate: CapacityEstimate;
  uploadAssumed: boolean;
}

export async function estimateHostCapacity(): Promise<HostCapacityReport> {
  const { uploadMbps, assumed } = await askUploadMbps();
  return { estimate: CapacityEstimator.estimate(uploadMbps), uploadAssumed: assumed };
}

/**
 * Prints the estimate, stating where each number came from.
 *
 * The previous version printed one pre-rendered sentence built inside
 * `@monky/shared`, which was hardcoded in Portuguese and reached English
 * operators untranslated (#515).
 */
export function printCapacityEstimate(report: HostCapacityReport): void {
  const { estimate } = report;
  console.log();
  console.log(color(t('create.sfuCapacityTitle'), ANSI.bold));
  console.log(
    color(
      t('capacity.summary', {
        cores: String(estimate.cpuCores),
        ram: String(estimate.ramTotalGb),
        upload: String(estimate.uploadMbps),
        screen: String(estimate.maxScreenShareParticipants),
        voice: String(estimate.maxAudioParticipants),
      }),
      ANSI.cyan
    )
  );
  console.log(
    color(
      report.uploadAssumed
        ? t('capacity.sourceAssumedUpload', { upload: String(estimate.uploadMbps) })
        : t('capacity.sourceMeasured'),
      ANSI.dim
    )
  );
}
