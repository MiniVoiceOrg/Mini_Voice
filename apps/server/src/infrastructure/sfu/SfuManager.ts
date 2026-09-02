import os from 'os';
import net from 'net';
import * as mediasoup from 'mediasoup';
import type { RouterRtpCodecCapability, TransportListenInfo } from 'mediasoup/node/lib/types.js';
import { LIMITS } from '@monky/shared';
import { getPublicIp } from '../discovery/ServerIpScanner';

const MEDIA_CODECS: RouterRtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/AV1',
    clockRate: 90000,
    parameters: {},
  },
  {
    kind: 'video',
    mimeType: 'video/VP9',
    clockRate: 90000,
    parameters: {
      'profile-id': 0,
    },
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {},
  },
  {
    kind: 'video',
    mimeType: 'video/H264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
    },
  },
];

export interface SfuManagerOptions {
  rtcMinPort?: number;
  rtcMaxPort?: number;
  announcedIp?: string | null;
  listenIp?: string;
}

export interface SfuProducerRecord {
  producer: mediasoup.types.Producer;
  sessionId: string;
  channelId: string;
  kind: 'audio' | 'video';
  appData: Record<string, any>;
}

export interface SfuConsumerRecord {
  consumer: mediasoup.types.Consumer;
  sessionId: string;
  channelId: string;
  producerId: string;
}

export interface SfuTransportRecord {
  transport: mediasoup.types.WebRtcTransport;
  sessionId: string;
  channelId: string;
  direction: 'send' | 'recv';
}

export class SfuManager {
  private worker: mediasoup.types.Worker | null = null;
  private routers: Map<string, mediasoup.types.Router> = new Map(); // key = channelId
  private transports: Map<string, SfuTransportRecord> = new Map(); // key = transportId
  private producers: Map<string, SfuProducerRecord> = new Map(); // key = producerId
  private consumers: Map<string, SfuConsumerRecord> = new Map(); // key = consumerId

  private isInitialized = false;
  private isAvailable = false;
  private initializationError: string | null = null;

  private readonly rtcMinPort: number;
  private readonly rtcMaxPort: number;
  private readonly listenIp: string;
  private announcedIp: string | null = null;
  private detectedPublicIp: string | null = null;

  constructor(options: SfuManagerOptions = {}) {
    this.rtcMinPort = options.rtcMinPort || LIMITS.SFU_DEFAULT_MIN_PORT;
    this.rtcMaxPort = options.rtcMaxPort || LIMITS.SFU_DEFAULT_MAX_PORT;
    this.listenIp = options.listenIp || '0.0.0.0';
    this.announcedIp = options.announcedIp || null;
  }

  public setAnnouncedIp(ip: string | null): void {
    this.announcedIp = ip;
  }

  public getAnnouncedIp(): string | null {
    return this.announcedIp;
  }

  public async init(): Promise<boolean> {
    if (this.isInitialized) {
      return this.isAvailable;
    }

    try {
      if (!this.announcedIp && !this.detectedPublicIp) {
        getPublicIp().then((ip) => {
          if (ip) {
            this.detectedPublicIp = ip;
            console.log(`[SFU] Auto-detected public IP for WebRTC candidates: ${ip}`);
          }
        }).catch(() => {});
      }

      this.worker = await mediasoup.createWorker({
        rtcMinPort: this.rtcMinPort,
        rtcMaxPort: this.rtcMaxPort,
        logLevel: 'warn',
      });

      this.worker.on('died', (error) => {
        console.error('[SFU] mediasoup Worker died:', error);
        this.isAvailable = false;
        this.initializationError = error?.message || 'Worker died unexpectedly';
      });

      this.isInitialized = true;
      this.isAvailable = true;
      this.initializationError = null;
      console.log(`[SFU] mediasoup Worker initialized on UDP ports ${this.rtcMinPort}-${this.rtcMaxPort}`);
      return true;
    } catch (err: any) {
      this.isInitialized = true;
      this.isAvailable = false;
      this.initializationError = err?.message || String(err);
      console.warn('[SFU] Failed to start mediasoup worker:', this.initializationError);
      return false;
    }
  }

  public isReady(): boolean {
    return this.isAvailable && this.worker !== null && !this.worker.died;
  }

  public getLastError(): string | null {
    return this.initializationError;
  }

  public async getOrCreateRouter(channelId: string): Promise<mediasoup.types.Router> {
    if (!this.isInitialized) {
      await this.init();
    }
    if (!this.isReady() || !this.worker) {
      throw new Error(`SFU worker is not available: ${this.initializationError || 'worker offline'}`);
    }

    let router = this.routers.get(channelId);
    if (!router || router.closed) {
      router = await this.worker.createRouter({ mediaCodecs: MEDIA_CODECS });
      this.routers.set(channelId, router);
    }
    return router;
  }

  private getListenInfos(preferredAnnouncedIp?: string): TransportListenInfo[] {
    const portRange = { min: this.rtcMinPort, max: this.rtcMaxPort };
    const infos: TransportListenInfo[] = [];
    const addedAddresses = new Set<string>();

    const addAnnouncedAddress = (addr: string | null | undefined) => {
      if (!addr) return;
      const trimmed = addr.trim();
      if (!trimmed || addedAddresses.has(trimmed)) return;
      infos.push({
        protocol: 'udp',
        ip: this.listenIp,
        announcedAddress: trimmed,
        portRange,
      });
      infos.push({
        protocol: 'tcp',
        ip: this.listenIp,
        announcedAddress: trimmed,
        portRange,
      });
      addedAddresses.add(trimmed);
    };

    // 1. Explicit announced IP configured by admin
    if (this.announcedIp) {
      addAnnouncedAddress(this.announcedIp);
    }

    // 2. Client connection host / IP (if client reached server via a public IP or domain)
    if (preferredAnnouncedIp && preferredAnnouncedIp !== 'localhost' && preferredAnnouncedIp !== '127.0.0.1') {
      addAnnouncedAddress(preferredAnnouncedIp);
    }

    // 3. Auto-detected server public IP (for cloud VPS behind 1:1 NAT like AWS, Oracle Cloud, GCP, etc.)
    if (this.detectedPublicIp) {
      addAnnouncedAddress(this.detectedPublicIp);
    }

    // 4. Always include 127.0.0.1 for local/loopback clients
    addAnnouncedAddress('127.0.0.1');

    // 5. Detect all available local network interfaces (Radmin VPN 26.x, LAN 192.168.x, 10.x, etc.)
    try {
      const interfaces = os.networkInterfaces();
      for (const [_, ifaceList] of Object.entries(interfaces)) {
        if (!ifaceList) continue;
        for (const iface of ifaceList) {
          const family = String(iface.family);
          if ((family === 'IPv4' || family === '4') && iface.address) {
            addAnnouncedAddress(iface.address);
          }
        }
      }
    } catch {
      // Ignore network interface detection failure
    }

    // Fallback if no valid address was found
    if (infos.length === 0) {
      infos.push({
        protocol: 'udp',
        ip: this.listenIp,
        portRange,
      });
      infos.push({
        protocol: 'tcp',
        ip: this.listenIp,
        portRange,
      });
    }

    return infos;
  }

  public async getRouterRtpCapabilities(channelId: string): Promise<mediasoup.types.RtpCapabilities> {
    const router = await this.getOrCreateRouter(channelId);
    return router.rtpCapabilities;
  }

  public async createWebRtcTransport(
    sessionId: string,
    channelId: string,
    direction: 'send' | 'recv',
    clientHost?: string
  ): Promise<{
    id: string;
    iceParameters: mediasoup.types.IceParameters;
    iceCandidates: mediasoup.types.IceCandidate[];
    dtlsParameters: mediasoup.types.DtlsParameters;
    sctpParameters?: mediasoup.types.SctpParameters;
  }> {
    const router = await this.getOrCreateRouter(channelId);
    const listenInfos = this.getListenInfos(clientHost);


    const transport = await router.createWebRtcTransport({
      listenInfos,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 2000000,
    });

    console.log(`[SFU Server] Created ${direction} transport ${transport.id} for session ${sessionId} in channel ${channelId}`);
    console.log(`[SFU Server] Transport ${transport.id} ICE candidates (${transport.iceCandidates.length}):`, transport.iceCandidates.map((c) => `${c.protocol?.toUpperCase()} ${c.ip || (c as any).address}:${c.port}`));

    transport.on('icestatechange', (iceState) => {
      console.log(`[SFU Server] Transport ${transport.id} (${direction}, session ${sessionId}) ICE state changed: ${iceState}`);
    });

    transport.on('dtlsstatechange', (dtlsState) => {
      console.log(`[SFU Server] Transport ${transport.id} (${direction}, session ${sessionId}) DTLS state changed: ${dtlsState}`);
      if (dtlsState === 'failed' || dtlsState === 'closed') {
        transport.close();
      }
    });

    transport.on('@close', () => {
      console.log(`[SFU Server] Transport ${transport.id} closed`);
      this.transports.delete(transport.id);
    });

    this.transports.set(transport.id, {
      transport,
      sessionId,
      channelId,
      direction,
    });

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      sctpParameters: transport.sctpParameters,
    };
  }

  public getProducersInChannel(channelId: string): Array<{
    producerId: string;
    producerSessionId: string;
    kind: 'audio' | 'video';
    appData: Record<string, any>;
  }> {
    const list: Array<{
      producerId: string;
      producerSessionId: string;
      kind: 'audio' | 'video';
      appData: Record<string, any>;
    }> = [];

    for (const [producerId, p] of this.producers.entries()) {
      if (p.channelId === channelId && !p.producer.closed) {
        list.push({
          producerId,
          producerSessionId: p.sessionId,
          kind: p.kind,
          appData: p.appData,
        });
      }
    }

    return list;
  }

  public async connectWebRtcTransport(
    transportId: string,
    dtlsParameters: mediasoup.types.DtlsParameters
  ): Promise<void> {
    const record = this.transports.get(transportId);
    if (!record) {
      throw new Error(`Transport ${transportId} not found`);
    }
    console.log(`[SFU Server] Connecting transport ${transportId} (session ${record.sessionId}, ${record.direction}) with DTLS role ${dtlsParameters.role}`);
    await record.transport.connect({ dtlsParameters });
    console.log(`[SFU Server] Transport ${transportId} connect resolved successfully`);
  }

  public async produce(
    sessionId: string,
    channelId: string,
    transportId: string,
    kind: 'audio' | 'video',
    rtpParameters: mediasoup.types.RtpParameters,
    appData: Record<string, any> = {}
  ): Promise<{ id: string }> {
    const record = this.transports.get(transportId);
    if (!record) {
      throw new Error(`Transport ${transportId} not found`);
    }

    const producer = await record.transport.produce({
      kind,
      rtpParameters,
      appData,
    });

    console.log(`[SFU Server] Producer created ${producer.id} (${kind}, mediaType: ${appData?.mediaType || 'unknown'}) on transport ${transportId} for session ${sessionId}`);

    producer.on('transportclose', () => {
      console.log(`[SFU Server] Producer ${producer.id} closed (transport closed)`);
      this.producers.delete(producer.id);
    });

    producer.on('@close', () => {
      console.log(`[SFU Server] Producer ${producer.id} closed`);
      this.producers.delete(producer.id);
    });

    this.producers.set(producer.id, {
      producer,
      sessionId,
      channelId,
      kind,
      appData,
    });

    return { id: producer.id };
  }

  public async consume(
    sessionId: string,
    channelId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: mediasoup.types.RtpCapabilities
  ): Promise<{
    id: string;
    producerId: string;
    kind: 'audio' | 'video';
    rtpParameters: mediasoup.types.RtpParameters;
    producerSessionId: string;
    appData: Record<string, any>;
  }> {
    const router = await this.getOrCreateRouter(channelId);
    const transportRecord = this.transports.get(transportId);
    if (!transportRecord) {
      throw new Error(`Transport ${transportId} not found`);
    }

    const producerRecord = this.producers.get(producerId);
    if (!producerRecord) {
      throw new Error(`Producer ${producerId} not found`);
    }

    if (!router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error(`Cannot consume producer ${producerId} with provided capabilities`);
    }

    const consumer = await transportRecord.transport.consume({
      producerId,
      rtpCapabilities,
      paused: false,
    });

    console.log(`[SFU Server] Consumer created ${consumer.id} (${consumer.kind}) for session ${sessionId} consuming producer ${producerId} (owner: ${producerRecord.sessionId}, type: ${producerRecord.appData?.mediaType})`);

    consumer.on('transportclose', () => {
      console.log(`[SFU Server] Consumer ${consumer.id} closed (transport closed)`);
      this.consumers.delete(consumer.id);
    });

    consumer.on('producerclose', () => {
      console.log(`[SFU Server] Consumer ${consumer.id} closed (producer closed)`);
      this.consumers.delete(consumer.id);
    });

    consumer.on('@close', () => {
      console.log(`[SFU Server] Consumer ${consumer.id} closed`);
      this.consumers.delete(consumer.id);
    });

    this.consumers.set(consumer.id, {
      consumer,
      sessionId,
      channelId,
      producerId,
    });

    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind as 'audio' | 'video',
      rtpParameters: consumer.rtpParameters,
      producerSessionId: producerRecord.sessionId,
      appData: producerRecord.appData,
    };
  }

  public closeProducer(producerId: string): void {
    const record = this.producers.get(producerId);
    if (record) {
      record.producer.close();
      this.producers.delete(producerId);
    }
  }

  public async setConsumerPaused(consumerId: string, paused: boolean): Promise<void> {
    const record = this.consumers.get(consumerId);
    if (!record) return;
    if (paused) {
      await record.consumer.pause();
    } else {
      await record.consumer.resume();
    }
  }

  public getProducersForChannel(channelId: string, excludeSessionId?: string): SfuProducerRecord[] {
    const list: SfuProducerRecord[] = [];
    for (const record of this.producers.values()) {
      if (record.channelId === channelId) {
        if (!excludeSessionId || record.sessionId !== excludeSessionId) {
          list.push(record);
        }
      }
    }
    return list;
  }

  public closeSession(sessionId: string): { closedProducerIds: string[] } {
    const closedProducerIds: string[] = [];

    // Close producers for session
    for (const [id, record] of Array.from(this.producers.entries())) {
      if (record.sessionId === sessionId) {
        closedProducerIds.push(id);
        record.producer.close();
        this.producers.delete(id);
      }
    }

    // Close consumers for session
    for (const [id, record] of Array.from(this.consumers.entries())) {
      if (record.sessionId === sessionId) {
        record.consumer.close();
        this.consumers.delete(id);
      }
    }

    // Close transports for session
    for (const [id, record] of Array.from(this.transports.entries())) {
      if (record.sessionId === sessionId) {
        record.transport.close();
        this.transports.delete(id);
      }
    }

    return { closedProducerIds };
  }

  public closeChannel(channelId: string): void {
    for (const [id, record] of Array.from(this.producers.entries())) {
      if (record.channelId === channelId) {
        record.producer.close();
        this.producers.delete(id);
      }
    }

    for (const [id, record] of Array.from(this.consumers.entries())) {
      if (record.channelId === channelId) {
        record.consumer.close();
        this.consumers.delete(id);
      }
    }

    for (const [id, record] of Array.from(this.transports.entries())) {
      if (record.channelId === channelId) {
        record.transport.close();
        this.transports.delete(id);
      }
    }

    const router = this.routers.get(channelId);
    if (router) {
      router.close();
      this.routers.delete(channelId);
    }
  }

  public close(): void {
    for (const router of this.routers.values()) {
      router.close();
    }
    this.routers.clear();
    this.transports.clear();
    this.producers.clear();
    this.consumers.clear();

    if (this.worker && !this.worker.died) {
      this.worker.close();
    }
    this.worker = null;
    this.isInitialized = false;
    this.isAvailable = false;
  }
}
