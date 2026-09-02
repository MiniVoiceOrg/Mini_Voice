/**
 * Child process helpers that keep arguments intact.
 *
 * Node's DEP0190 warns that `shell: true` concatenates arguments instead of
 * escaping them, and the consequence is not only a warning: a data directory
 * containing a space reached pm2 split into two arguments. `scripts/pack-cli.js`
 * already documents the same trap for `npm pack`.
 *
 * POSIX runs the executable directly, with no shell involved. On Windows `pm2`
 * and `npm` resolve to `.cmd` shims, which Node refuses to spawn without a
 * shell (EINVAL), so the arguments are quoted and handed over as a single
 * command string — passing an empty `args` array is also what keeps DEP0190
 * from firing.
 */
import {
  ChildProcess,
  SpawnOptions,
  SpawnSyncOptions,
  SpawnSyncReturns,
  spawn,
  spawnSync,
} from 'child_process';

const isWindows = process.platform === 'win32';

/**
 * Quotes one argument for `cmd.exe`.
 *
 * Doubling embedded quotes is the escaping cmd understands; the surrounding
 * quotes are only added when the value could otherwise be split or reparsed.
 */
export function quoteWindowsArg(value: string): string {
  return /[\s"&|<>^()]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildWindowsCommand(command: string, args: string[]): string {
  return [command, ...args].map(quoteWindowsArg).join(' ');
}

/** Runs a command to completion, without letting a shell reparse arguments. */
export function runSync(
  command: string,
  args: string[] = [],
  options: SpawnSyncOptions = {}
): SpawnSyncReturns<string> {
  const result = isWindows
    ? spawnSync(buildWindowsCommand(command, args), [], { ...options, shell: true })
    : spawnSync(command, args, { ...options, shell: false });
  return result as SpawnSyncReturns<string>;
}

/** Long-running variant of {@link runSync}, for streamed output. */
export function runAsync(command: string, args: string[] = [], options: SpawnOptions = {}): ChildProcess {
  return isWindows
    ? spawn(buildWindowsCommand(command, args), [], { ...options, shell: true })
    : spawn(command, args, { ...options, shell: false });
}

/** Whether a command exists and exits cleanly — never throws. */
export function commandSucceeds(command: string, args: string[] = []): boolean {
  try {
    const result = runSync(command, args, { stdio: 'ignore' });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}
