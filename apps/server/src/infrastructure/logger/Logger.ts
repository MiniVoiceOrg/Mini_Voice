export type LogCategory = 'INFO' | 'WARN' | 'ERROR' | 'SECURITY' | 'NETWORK' | 'DATABASE' | 'WEBRTC';

export class Logger {
  public static log(category: LogCategory, message: string, meta?: any): void {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
    console.log(`[${timestamp}] [${category}] ${message}${metaStr}`);
  }

  public static info(category: LogCategory, message: string, meta?: any): void {
    this.log(category, message, meta);
  }

  public static warn(category: LogCategory, message: string, meta?: any): void {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
    console.warn(`[${timestamp}] [WARN:${category}] ${message}${metaStr}`);
  }

  public static error(category: LogCategory, message: string, error?: any): void {
    const timestamp = new Date().toISOString();
    const errStr = error ? ` | ${error instanceof Error ? error.stack : JSON.stringify(error)}` : '';
    console.error(`[${timestamp}] [ERROR:${category}] ${message}${errStr}`);
  }

  public static security(message: string, meta?: any): void {
    this.log('SECURITY', message, meta);
  }
}
