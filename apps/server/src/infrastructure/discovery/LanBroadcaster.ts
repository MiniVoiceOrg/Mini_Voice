import dgram from 'dgram';
import { Logger } from '../logger/Logger';

const DEFAULT_DISCOVERY_PORT = 41234;
const DEFAULT_BROADCAST_INTERVAL_MS = 3000;
const DISCOVERY_VERSION = '1.0';
const DISCOVERY_TYPE = 'mini-voice-announce';
const BROADCAST_ADDRESS = '255.255.255.255';

interface LanBroadcasterOptions {
  serverName: string;
  serverPort: number;
  discoveryPort?: number;
  intervalMs?: number;
}

export class LanBroadcaster {
  private readonly serverName: string;
  private readonly serverPort: number;
  private readonly discoveryPort: number;
  private readonly intervalMs: number;
  private socket: dgram.Socket | null = null;
  private interval: NodeJS.Timeout | null = null;
  private isStarted = false;

  constructor(options: LanBroadcasterOptions) {
    this.serverName = options.serverName;
    this.serverPort = options.serverPort;
    this.discoveryPort = options.discoveryPort ?? DEFAULT_DISCOVERY_PORT;
    this.intervalMs = options.intervalMs ?? DEFAULT_BROADCAST_INTERVAL_MS;
  }

  public async start(): Promise<void> {
    if (this.isStarted) return;

    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    try {
      await new Promise<void>((resolve, reject) => {
        const handleError = (error: Error) => {
          socket.off('listening', handleListening);
          reject(error);
        };
        const handleListening = () => {
          socket.off('error', handleError);
          resolve();
        };

        socket.once('error', handleError);
        socket.once('listening', handleListening);
        socket.bind(0);
      });

      socket.setBroadcast(true);
      this.socket = socket;
      this.isStarted = true;

      this.broadcast();
      this.interval = setInterval(() => this.broadcast(), this.intervalMs);
    } catch (error) {
      try {
        socket.close();
      } catch {}
      Logger.warn('NETWORK', 'LAN discovery broadcast unavailable; continuing without it.', error);
    }
  }

  public async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    const socket = this.socket;
    this.socket = null;
    this.isStarted = false;

    if (!socket) return;

    await new Promise<void>((resolve) => {
      try {
        socket.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  private broadcast(): void {
    if (!this.socket) return;

    const payload = Buffer.from(
      JSON.stringify({
        type: DISCOVERY_TYPE,
        serverName: this.serverName,
        port: this.serverPort,
        version: DISCOVERY_VERSION,
      })
    );

    this.socket.send(payload, this.discoveryPort, BROADCAST_ADDRESS, (error) => {
      if (error) {
        Logger.warn('NETWORK', 'Failed to send LAN discovery broadcast.', error);
      }
    });
  }
}
