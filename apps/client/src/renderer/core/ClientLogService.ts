/**
 * Renderer-side logging service for the Monky client (#444).
 *
 * Provides a convenient API for recording structured log entries from anywhere
 * in the renderer process. Entries are sent to the main process via IPC, where
 * they are written to rotating JSON-lines files on disk.
 *
 * ## Security
 *
 * Sensitive data (passwords, tokens, identity keys) must NEVER be passed to
 * any log method. The service does NOT sanitise payloads — callers are
 * responsible for excluding secrets before logging.
 */

import type { ClientLogCategory, LogLevel, ClientLogEntry } from '@monky/shared';

class ClientLogService {
  private enabled = true;

  /** Initialises the service, loading config from the main process. */
  public async init(): Promise<void> {
    try {
      const config = await window.api.getClientLogConfig();
      this.enabled = config.enabled;
    } catch {
      // Main process may not have the logger ready yet
    }
  }

  /** Whether the service will forward entries to the main process. */
  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  private log(level: LogLevel, category: ClientLogCategory, message: string, data?: Record<string, unknown>): void {
    if (!this.enabled) return;

    const entry: ClientLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
    };
    if (data) entry.data = data;

    // Fire-and-forget — we never want logging to block the UI
    if (typeof window !== 'undefined' && window.api?.writeClientLog) {
      window.api.writeClientLog(entry).catch(() => {});
    }
  }

  // ── Convenience methods ────────────────────────────────────────────

  public info(category: ClientLogCategory, message: string, data?: Record<string, unknown>): void {
    this.log('INFO', category, message, data);
  }

  public warn(category: ClientLogCategory, message: string, data?: Record<string, unknown>): void {
    this.log('WARN', category, message, data);
  }

  public error(category: ClientLogCategory, message: string, data?: Record<string, unknown>): void {
    this.log('ERROR', category, message, data);
  }

  /**
   * Logs an error object, extracting message and stack trace.
   * Avoids leaking sensitive data from Error objects.
   */
  public logError(category: ClientLogCategory, context: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    this.error(category, `${context}: ${message}`, stack ? { stack } : undefined);
  }
}

export const clientLog = new ClientLogService();
