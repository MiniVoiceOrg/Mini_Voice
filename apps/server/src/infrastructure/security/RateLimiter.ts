import { LIMITS } from '@mini-voice/shared';

export class RateLimiter {
  private userMessageTimestamps: Map<string, number[]> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(cleanupIntervalMs: number = 60_000) {
    // Periodically evict stale entries so the map does not grow unboundedly as
    // users who stop sending messages would otherwise never be removed.
    this.cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs);
    // Do not keep the process alive solely for this timer.
    if (typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Checks if an action is within rate limits.
   * Returns true if allowed, false if rate limited.
   */
  public checkLimit(
    userIdOrIp: string,
    maxCount: number = LIMITS.RATE_LIMIT_MAX_MESSAGES,
    windowMs: number = LIMITS.RATE_LIMIT_WINDOW_MS
  ): boolean {
    const now = Date.now();
    let timestamps = this.userMessageTimestamps.get(userIdOrIp);

    if (!timestamps) {
      timestamps = [];
      this.userMessageTimestamps.set(userIdOrIp, timestamps);
    }

    // Filter out timestamps outside the sliding window
    const validTimestamps = timestamps.filter((t) => now - t < windowMs);

    if (validTimestamps.length >= maxCount) {
      this.userMessageTimestamps.set(userIdOrIp, validTimestamps);
      return false; // Rate limit exceeded
    }

    validTimestamps.push(now);
    this.userMessageTimestamps.set(userIdOrIp, validTimestamps);
    return true;
  }

  public cleanup(): void {
    const now = Date.now();
    for (const [key, timestamps] of this.userMessageTimestamps.entries()) {
      const valid = timestamps.filter((t) => now - t < LIMITS.RATE_LIMIT_WINDOW_MS);
      if (valid.length === 0) {
        this.userMessageTimestamps.delete(key);
      } else {
        this.userMessageTimestamps.set(key, valid);
      }
    }
  }

  /** Stops the periodic cleanup timer. Call on server shutdown. */
  public dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
