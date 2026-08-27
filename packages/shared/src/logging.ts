/**
 * Shapes for server logs that are consumed outside the server process.
 *
 * The server writes to the console, but the desktop app hosting a server and
 * the CLI both need the same entries in a structured form, so the vocabulary
 * lives here instead of being redeclared by each consumer.
 */
export type LogCategory =
  | 'INFO'
  | 'WARN'
  | 'ERROR'
  | 'SECURITY'
  | 'NETWORK'
  | 'DATABASE'
  | 'WEBRTC'
  | 'SOUNDBOARD'
  | 'ATTACHMENT';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  /** ISO-8601, assigned when the entry is recorded. */
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
}

export const LOG_LEVELS: LogLevel[] = ['INFO', 'WARN', 'ERROR'];
