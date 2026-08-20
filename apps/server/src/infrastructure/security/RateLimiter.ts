import { LIMITS } from '@mini-voice/shared';

export class RateLimiter {
  private userMessageTimestamps: Map<string, number[]> = new Map();

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
}
