import { v4 as uuidv4 } from 'uuid';
import {
  AuthConnectPayload,
  AuthSuccessPayload,
  MessageType,
  ProtocolErrorCode,
  ProtocolMessage,
  PROTOCOL_VERSION,
  RECONNECT_DELAYS_MS,
  ServerErrorPayload,
} from '@mini-voice/shared';
import { appEvents } from './EventBus';

export type ConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING';

export interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: any;
}

export class NetworkClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'DISCONNECTED';
  private reconnectAttempt: number = 0;
  private reconnectTimeout: any = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private currentServerUrl: string = '';
  private lastConnectPayload: AuthConnectPayload | null = null;
  private manualDisconnect: boolean = false;

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  public async connect(
    host: string,
    port: number,
    clientId: string,
    nickname: string,
    password?: string
  ): Promise<AuthSuccessPayload> {
    this.manualDisconnect = false;
    this.reconnectAttempt = 0;
    this.clearReconnect();

    const cleanHost = host.trim().replace(/^ws:\/\//, '').replace(/^wss:\/\//, '');
    this.currentServerUrl = `ws://${cleanHost}:${port}`;

    this.lastConnectPayload = {
      protocolVersion: PROTOCOL_VERSION,
      clientId,
      nickname,
      password: password || '',
    };

    return new Promise((resolve, reject) => {
      this.setStatus('CONNECTING');

      try {
        this.ws = new WebSocket(this.currentServerUrl);
      } catch (err: any) {
        this.setStatus('DISCONNECTED');
        return reject(new Error(`Não foi possível conectar ao endereço ${this.currentServerUrl}: ${err.message}`));
      }

      const connectionTimeout = setTimeout(() => {
        if (this.status === 'CONNECTING') {
          this.ws?.close();
          this.setStatus('DISCONNECTED');
          reject(new Error('Tempo limite de conexão esgotado. Verifique o IP e a porta.'));
        }
      }, 8000);

      this.ws.onopen = () => {
        clearTimeout(connectionTimeout);
        // Send AUTH_CONNECT
        const authRequestId = uuidv4();

        this.sendRequest<AuthSuccessPayload>(MessageType.AUTH_CONNECT, this.lastConnectPayload, authRequestId)
          .then((res) => {
            this.setStatus('CONNECTED');
            this.reconnectAttempt = 0;
            appEvents.emit('network.connected', res);
            resolve(res);
          })
          .catch((err) => {
            clearTimeout(connectionTimeout);
            this.ws?.close();
            this.setStatus('DISCONNECTED');
            reject(err);
          });
      };

      this.ws.onmessage = (event) => {
        try {
          const message: ProtocolMessage = JSON.parse(event.data.toString());
          this.handleIncomingMessage(message);
        } catch (e) {
          console.error('Failed to parse incoming WebSocket message', e);
        }
      };

      this.ws.onclose = () => {
        clearTimeout(connectionTimeout);
        this.handleSocketClosed();
      };

      this.ws.onerror = (err) => {
        console.warn('WebSocket error encountered:', err);
      };
    });
  }

  public disconnect(): void {
    this.manualDisconnect = true;
    this.clearReconnect();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('DISCONNECTED');
    appEvents.emit('network.disconnected');
  }

  public send(type: MessageType, payload: any, requestId?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`Cannot send message ${type}, socket is not open.`);
      return;
    }

    const message: ProtocolMessage = {
      type,
      requestId: requestId || uuidv4(),
      payload,
    };

    this.ws.send(JSON.stringify(message));
  }

  public sendRequest<T = any>(type: MessageType, payload: any, customRequestId?: string, timeoutMs: number = 8000): Promise<T> {
    const requestId = customRequestId || uuidv4();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`Timeout aguardando resposta para ${type}`));
        }
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timer });
      this.send(type, payload, requestId);
    });
  }

  private handleIncomingMessage(message: ProtocolMessage): void {
    const { type, requestId, payload } = message;

    // Check if matching a pending request
    if (requestId && this.pendingRequests.has(requestId)) {
      const pending = this.pendingRequests.get(requestId)!;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(requestId);

      if (type === MessageType.SERVER_ERROR) {
        const errorPayload = payload as ServerErrorPayload;
        pending.reject(new Error(errorPayload.message || errorPayload.code));
        return;
      }

      pending.resolve(payload);
    }

    // Emit event for all message types
    appEvents.emit(`message.${type}`, payload);
  }

  private handleSocketClosed(): void {
    this.ws = null;

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Conexão encerrada'));
    }
    this.pendingRequests.clear();

    if (this.manualDisconnect) {
      this.setStatus('DISCONNECTED');
      return;
    }

    // Attempt automatic reconnection
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.manualDisconnect || !this.lastConnectPayload) return;

    this.setStatus('RECONNECTING');
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt++;

    appEvents.emit('network.reconnecting', { attempt: this.reconnectAttempt, delay });

    this.reconnectTimeout = setTimeout(async () => {
      if (this.manualDisconnect || !this.lastConnectPayload) return;

      try {
        console.log(`[NetworkClient] Trying to reconnect (attempt ${this.reconnectAttempt})...`);
        const { clientId, nickname, password } = this.lastConnectPayload;
        // Parse host & port
        const urlObj = new URL(this.currentServerUrl);
        const host = urlObj.hostname;
        const port = parseInt(urlObj.port, 10);

        await this.connect(host, port, clientId, nickname, password);
      } catch (err) {
        console.warn(`[NetworkClient] Reconnection attempt ${this.reconnectAttempt} failed.`);
      }
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    appEvents.emit('network.status', status);
  }
}

export const networkClient = new NetworkClient();
