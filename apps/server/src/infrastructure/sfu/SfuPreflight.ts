/**
 * Static checks that explain why the SFU cannot start, before it fails.
 *
 * `SfuManager.init()` catches every error and leaves the server running in
 * P2P, which is the right call for availability but means an operator who
 * deliberately chose `voiceMode=sfu` sees nothing wrong until calls degrade.
 * The two causes detectable without spawning a worker — an unsupported
 * Node.js and a worker binary that was never installed — are reported here so
 * the CLI and the server can both say what actually happened.
 *
 * Issues carry a code instead of a finished sentence: the server logs in
 * English while the CLI renders the same result through its own translations.
 */
import fs from 'fs';
import path from 'path';

/**
 * Lowest Node.js major the SFU stack accepts.
 *
 * mediasoup, and its `h264-profile-level-id` and `supports-color`
 * dependencies, all declare `engines.node: ">=22"`.
 */
export const SFU_MIN_NODE_MAJOR = 22;

export type SfuPreflightCode = 'node-version' | 'mediasoup-unresolved' | 'worker-missing';

export interface SfuPreflightIssue {
  code: SfuPreflightCode;
  /** English rendering, used for server logs. */
  message: string;
  /** Running Node.js version, for `node-version`. */
  found?: string;
  /** Expected worker binary location, for `worker-missing`. */
  workerPath?: string;
}

export interface SfuPreflightResult {
  ok: boolean;
  issues: SfuPreflightIssue[];
}

export function getNodeMajor(version: string = process.versions.node): number {
  return Number.parseInt(String(version).split('.')[0], 10) || 0;
}

/**
 * Directory of the installed mediasoup package.
 *
 * `require.resolve('mediasoup/package.json')` is not usable: mediasoup ships
 * an `exports` map with no `./package.json` entry, so Node rejects the
 * subpath. Resolving the entry point and walking up sidesteps that.
 */
function findMediasoupRoot(): string | null {
  let dir: string;
  try {
    dir = path.dirname(require.resolve('mediasoup'));
  } catch {
    return null;
  }

  for (let depth = 0; depth < 8; depth++) {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest)) {
      try {
        if (JSON.parse(fs.readFileSync(manifest, 'utf8')).name === 'mediasoup') return dir;
      } catch {
        // Unreadable manifest — keep walking up.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Worker binary mediasoup will execute, honouring its documented override.
 */
export function resolveWorkerBinaryPath(): string | null {
  const override = process.env.MEDIASOUP_WORKER_BIN;
  if (override) return override;

  const root = findMediasoupRoot();
  if (!root) return null;

  const binary = process.platform === 'win32' ? 'mediasoup-worker.exe' : 'mediasoup-worker';
  return path.join(root, 'worker', 'out', 'Release', binary);
}

export function checkSfuPreflight(): SfuPreflightResult {
  const issues: SfuPreflightIssue[] = [];

  const nodeMajor = getNodeMajor();
  if (nodeMajor < SFU_MIN_NODE_MAJOR) {
    issues.push({
      code: 'node-version',
      found: process.versions.node,
      message: `Node.js ${process.versions.node} is running, but mediasoup requires ${SFU_MIN_NODE_MAJOR} or newer.`,
    });
  }

  const workerPath = resolveWorkerBinaryPath();
  if (!workerPath) {
    issues.push({
      code: 'mediasoup-unresolved',
      message: 'The mediasoup package could not be resolved from the server installation.',
    });
  } else if (!fs.existsSync(workerPath)) {
    issues.push({
      code: 'worker-missing',
      workerPath,
      message:
        `The mediasoup worker binary is missing at ${workerPath}. ` +
        'Its postinstall step most likely never ran — npm blocks install scripts unless the package is allowed.',
    });
  }

  return { ok: issues.length === 0, issues };
}

/** Single-line summary suitable for a log entry. */
export function formatSfuPreflightForLog(result: SfuPreflightResult): string {
  return result.issues.map((issue) => issue.message).join(' ');
}
