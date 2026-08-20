import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { MiniVoiceServer, ServerConfig } from '@mini-voice/server/dist/server.js';

export interface HostServerOptions {
  port: number;
  serverName: string;
  password?: string;
  initialVoiceChannel?: string;
  initialTextChannel?: string;
}

export class ServerManager {
  private serverInstance: MiniVoiceServer | null = null;
  private isRunning: boolean = false;

  public async startServer(options: HostServerOptions): Promise<{ success: boolean; error?: string }> {
    if (this.isRunning && this.serverInstance) {
      return { success: true };
    }

    const dataDir = path.join(app.getPath('userData'), 'server-data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const config: ServerConfig = {
      port: options.port,
      dataDir,
      serverName: options.serverName || 'Mini Voice Server',
      password: options.password || '',
      initialVoiceChannel: options.initialVoiceChannel || 'Geral',
      initialTextChannel: options.initialTextChannel || 'geral',
    };

    try {
      const server = await MiniVoiceServer.create(config);
      await server.start();
      this.serverInstance = server;
      this.isRunning = true;
      console.log(`[ServerManager] Local server started successfully on port ${options.port}`);
      return { success: true };
    } catch (err: any) {
      console.error('[ServerManager] Error starting local server:', err);
      this.isRunning = false;
      this.serverInstance = null;
      return { success: false, error: err.message || 'Falha ao iniciar servidor' };
    }
  }

  public async stopServer(): Promise<void> {
    if (this.serverInstance) {
      console.log('[ServerManager] Stopping local server...');
      await this.serverInstance.stop();
      this.serverInstance = null;
      this.isRunning = false;
    }
  }

  public getStatus(): { isRunning: boolean } {
    return { isRunning: this.isRunning };
  }
}
