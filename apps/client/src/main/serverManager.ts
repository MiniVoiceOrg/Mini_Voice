import path from 'path';
import fs from 'fs';
import { app, BrowserWindow } from 'electron';
import { MonkyServer, ServerConfig, Logger } from '@monky/server';
import type { HostServerOptions, LogEntry, ServerStats } from '@monky/shared';
import { mt } from './i18n';
import { isSafeServerId, migrateLegacyServerData, serverDataDirFor } from './serverDataDir';

export type { HostServerOptions };

export class ServerManager {
  private serverInstance: MonkyServer | null = null;
  private isRunning: boolean = false;
  private currentPort: number | null = null;
  private currentServerId: string | null = null;
  private unsubscribeLogs: (() => void) | null = null;

  public async startServer(options: HostServerOptions): Promise<{ success: boolean; error?: string }> {
    if (this.isRunning && this.serverInstance) {
      // Already serving exactly what was asked for.
      if (this.currentPort === options.port) {
        // The caller may know which entry of "Meus Servidores" this instance
        // belongs to even when whoever started it did not, so keep the most
        // specific answer instead of leaving the id stale (#333).
        if (options.serverId && options.serverId !== this.currentServerId) {
          this.currentServerId = options.serverId;
          this.notifyStatus();
        }
        return { success: true };
      }
      // A different server is up: reporting success here would leave the caller
      // connecting to the wrong instance, so swap it out first.
      await this.stopServer();
    }

    if (options.serverId && !isSafeServerId(options.serverId)) {
      return { success: false, error: mt('error.startServerFailed') };
    }

    const dataDir = this.resolveDataDir(options.serverId);
    fs.mkdirSync(dataDir, { recursive: true });

    const config: ServerConfig = {
      port: options.port,
      dataDir,
      serverName: options.serverName || 'Monky Server',
      password: options.password || '',
      initialVoiceChannel: options.initialVoiceChannel || 'Geral',
      initialTextChannel: options.initialTextChannel || 'geral',
    };

    try {
      const server = await MonkyServer.create(config);
      await server.start();
      this.serverInstance = server;
      this.isRunning = true;
      this.currentPort = options.port;
      this.currentServerId = options.serverId ?? null;
      this.startForwardingLogs();
      console.log(`[ServerManager] Local server started successfully on port ${options.port}`);
      this.notifyStatus();
      return { success: true };
    } catch (err: any) {
      console.error('[ServerManager] Error starting local server:', err);
      this.isRunning = false;
      this.serverInstance = null;
      this.currentPort = null;
      this.currentServerId = null;
      this.notifyStatus();
      return { success: false, error: err.message || mt('error.startServerFailed') };
    }
  }

  private static baseDataDir(): string {
    return path.join(app.getPath('userData'), 'server-data');
  }

  /**
   * One folder per entry of "Meus Servidores" (#364). Servers started without
   * an id keep the flat folder: they have no entry to be told apart by.
   */
  private resolveDataDir(serverId?: string): string {
    const baseDir = ServerManager.baseDataDir();
    if (!serverId) return baseDir;

    const dataDir = serverDataDirFor(baseDir, serverId);
    migrateLegacyServerData(baseDir, dataDir);
    return dataDir;
  }

  /**
   * Drops the data of a server removed from "Meus Servidores". Without this the
   * database outlived the entry and was inherited by the next server created
   * (#364).
   */
  public deleteServerData(serverId: string): { success: boolean; error?: string } {
    if (!serverId || !isSafeServerId(serverId)) {
      return { success: false, error: mt('error.deleteServerDataFailed') };
    }
    // Erasing the database under a live server would leave it writing into
    // files nobody can find again.
    if (this.isRunning && this.currentServerId === serverId) {
      return { success: false, error: mt('error.deleteServerDataRunning') };
    }

    try {
      fs.rmSync(serverDataDirFor(ServerManager.baseDataDir(), serverId), { recursive: true, force: true });
      return { success: true };
    } catch (err: any) {
      console.error('[ServerManager] Error deleting server data:', err);
      return { success: false, error: err.message || mt('error.deleteServerDataFailed') };
    }
  }

  public async stopServer(): Promise<void> {
    if (this.serverInstance) {
      console.log('[ServerManager] Stopping local server...');
      this.unsubscribeLogs?.();
      this.unsubscribeLogs = null;
      await this.serverInstance.stop();
      this.serverInstance = null;
      this.isRunning = false;
      this.currentPort = null;
      this.currentServerId = null;
      this.notifyStatus();
    }
  }

  /**
   * Pushes the hosted server state to every window. Polling it at render time
   * loses every transition that happens while another screen is up, which is
   * how "Meus Servidores" ended up offering to start a server that was already
   * running (#333).
   */
  private notifyStatus(): void {
    const status = this.getStatus();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('server-host:status-changed', status);
      }
    }
  }

  /**
   * Streams the hosted server's log entries to the renderer as they happen, so
   * the log view does not have to poll. The subscription is dropped on stop:
   * starting and stopping repeatedly would otherwise stack listeners.
   */
  private startForwardingLogs(): void {
    this.unsubscribeLogs?.();
    this.unsubscribeLogs = Logger.subscribe((entry: LogEntry) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send('server-host:log', entry);
        }
      }
    });
  }

  public getLogs(): LogEntry[] {
    return Logger.getRecent();
  }

  public clearLogs(): void {
    Logger.clearBuffer();
  }

  public async getStats(): Promise<ServerStats | null> {
    if (!this.serverInstance) return null;
    return this.serverInstance.getStats();
  }

  /**
   * Single source of truth for the hosted server. The renderer used to track
   * which of the user's servers was up in view state, which went stale as soon
   * as it was started from somewhere else (#333).
   */
  public getStatus(): { isRunning: boolean; port: number | null; serverId: string | null } {
    return { isRunning: this.isRunning, port: this.currentPort, serverId: this.currentServerId };
  }
}
