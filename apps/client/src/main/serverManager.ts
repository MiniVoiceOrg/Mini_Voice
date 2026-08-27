import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { MonkyServer, ServerConfig } from '@monky/server';
import { mt } from './i18n';

export interface HostServerOptions {
  port: number;
  serverName: string;
  password?: string;
  initialVoiceChannel?: string;
  initialTextChannel?: string;
}

export class ServerManager {
  private serverInstance: MonkyServer | null = null;
  private isRunning: boolean = false;
  private currentPort: number | null = null;

  public async startServer(options: HostServerOptions): Promise<{ success: boolean; error?: string }> {
    if (this.isRunning && this.serverInstance) {
      // Already serving exactly what was asked for.
      if (this.currentPort === options.port) {
        return { success: true };
      }
      // A different server is up: reporting success here would leave the caller
      // connecting to the wrong instance, so swap it out first.
      await this.stopServer();
    }

    const dataDir = path.join(app.getPath('userData'), 'server-data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

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
      console.log(`[ServerManager] Local server started successfully on port ${options.port}`);
      return { success: true };
    } catch (err: any) {
      console.error('[ServerManager] Error starting local server:', err);
      this.isRunning = false;
      this.serverInstance = null;
      this.currentPort = null;
      return { success: false, error: err.message || mt('error.startServerFailed') };
    }
  }

  public async stopServer(): Promise<void> {
    if (this.serverInstance) {
      console.log('[ServerManager] Stopping local server...');
      await this.serverInstance.stop();
      this.serverInstance = null;
      this.isRunning = false;
      this.currentPort = null;
    }
  }

  public getStatus(): { isRunning: boolean } {
    return { isRunning: this.isRunning };
  }
}
