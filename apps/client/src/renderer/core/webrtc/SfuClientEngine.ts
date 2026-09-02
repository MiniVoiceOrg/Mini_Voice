import * as mediasoupClient from 'mediasoup-client';
import type { types as mediasoupTypes } from 'mediasoup-client';
import {
  MessageType,
  SfuConnectWebRtcTransportPayload,
  SfuConsumePayload,
  SfuConsumedPayload,
  SfuCreateWebRtcTransportPayload,
  SfuGetProducersPayload,
  SfuGetRouterRtpCapabilitiesPayload,
  SfuNewProducerPayload,
  SfuProducePayload,
  SfuProducedPayload,
  SfuProducerClosedPayload,
  SfuProducersListPayload,
  SfuRouterRtpCapabilitiesPayload,
  SfuWebRtcTransportCreatedPayload,
} from '@monky/shared';
import { NetworkClient } from '../NetworkClient';
import { clientLog } from '../ClientLogService';
import { appEvents } from '../EventBus';

export interface SfuConsumerTrackEvent {
  producerSessionId: string;
  kind: 'audio' | 'video';
  mediaType: 'mic' | 'camera' | 'screen_video' | 'screen_audio';
  track: MediaStreamTrack;
  consumerId: string;
  producerId: string;
  shareId?: string;
  rtpReceiver?: RTCRtpReceiver;
}

export interface SfuClientEngineCallbacks {
  onConsumerTrack: (event: SfuConsumerTrackEvent) => void;
  onConsumerClosed: (producerSessionId: string, mediaType: string, shareId?: string) => void;
  onFallbackToP2p: (reason: string) => void;
}

export class SfuClientEngine {
  private getClient: () => NetworkClient;
  private getMySessionId: () => string | undefined;
  private device: mediasoupClient.Device | null = null;
  private sendTransport: mediasoupTypes.Transport | null = null;
  private recvTransport: mediasoupTypes.Transport | null = null;
  private channelId: string | null = null;
  private producers: Map<string, mediasoupTypes.Producer> = new Map();
  private consumers: Map<string, mediasoupTypes.Consumer> = new Map();
  /** Consumer tracking metadata: producerId -> { producerSessionId, mediaType, shareId, consumerId } */
  private consumerMeta: Map<string, { producerSessionId: string; mediaType: string; shareId?: string; consumerId: string }> = new Map();
  private isConnecting: boolean = false;
  private isConnected: boolean = false;
  private unsubscribeEvents: Array<() => void> = [];

  constructor(
    getClient: () => NetworkClient,
    getMySessionId: () => string | undefined,
    private callbacks: SfuClientEngineCallbacks
  ) {
    this.getClient = getClient;
    this.getMySessionId = getMySessionId;
  }

  private get client(): NetworkClient {
    return this.getClient();
  }

  public async join(channelId: string): Promise<boolean> {
    this.leave();
    this.channelId = channelId;
    this.isConnecting = true;

    try {
      clientLog.info('SFU', `Joining SFU room for channel ${channelId}`);

      // 1. Get router RTP capabilities
      const routerCapsResp = await this.client.sendRequest<SfuRouterRtpCapabilitiesPayload>(
        MessageType.SFU_GET_ROUTER_RTP_CAPABILITIES,
        { channelId } satisfies SfuGetRouterRtpCapabilitiesPayload,
        undefined,
        10000
      );

      if (!routerCapsResp || !routerCapsResp.rtpCapabilities) {
        throw new Error('Falha ao obter capacidades RTP do servidor SFU');
      }

      // 2. Load device
      this.device = new mediasoupClient.Device();
      await this.device.load({ routerRtpCapabilities: routerCapsResp.rtpCapabilities as any });

      // 3. Create send transport
      const sendCreated = await this.client.sendRequest<SfuWebRtcTransportCreatedPayload>(
        MessageType.SFU_CREATE_WEBRTC_TRANSPORT,
        { channelId, direction: 'send' } satisfies SfuCreateWebRtcTransportPayload,
        undefined,
        10000
      );

      this.sendTransport = this.device.createSendTransport(sendCreated.transportOptions as any);

      this.sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        this.client
          .sendRequest(
            MessageType.SFU_CONNECT_WEBRTC_TRANSPORT,
            {
              channelId,
              transportId: this.sendTransport!.id,
              dtlsParameters,
            } satisfies SfuConnectWebRtcTransportPayload,
            undefined,
            8000
          )
          .then(() => callback())
          .catch((err) => {
            clientLog.error('SFU', 'Send transport connect error', { error: err?.message });
            errback(err);
          });
      });

      this.sendTransport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        this.client
          .sendRequest<SfuProducedPayload>(
            MessageType.SFU_PRODUCE,
            {
              channelId,
              transportId: this.sendTransport!.id,
              kind,
              rtpParameters,
              appData,
            } satisfies SfuProducePayload,
            undefined,
            8000
          )
          .then((resp) => {
            callback({ id: resp.id });
          })
          .catch((err) => {
            clientLog.error('SFU', 'Send transport produce error', { error: err?.message });
            errback(err);
          });
      });

      this.sendTransport.on('connectionstatechange', (state) => {
        clientLog.info('SFU', `Send transport state: ${state}`);
        if (state === 'failed') {
          clientLog.warn('SFU', 'Send transport failed, requesting fallback');
          this.callbacks.onFallbackToP2p('Falha na conexão do transporte de envio SFU');
        }
      });

      // 4. Create recv transport
      const recvCreated = await this.client.sendRequest<SfuWebRtcTransportCreatedPayload>(
        MessageType.SFU_CREATE_WEBRTC_TRANSPORT,
        { channelId, direction: 'recv' } satisfies SfuCreateWebRtcTransportPayload,
        undefined,
        10000
      );

      this.recvTransport = this.device.createRecvTransport(recvCreated.transportOptions as any);

      this.recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        this.client
          .sendRequest(
            MessageType.SFU_CONNECT_WEBRTC_TRANSPORT,
            {
              channelId,
              transportId: this.recvTransport!.id,
              dtlsParameters,
            } satisfies SfuConnectWebRtcTransportPayload,
            undefined,
            8000
          )
          .then(() => callback())
          .catch((err) => {
            clientLog.error('SFU', 'Recv transport connect error', { error: err?.message });
            errback(err);
          });
      });

      this.recvTransport.on('connectionstatechange', (state) => {
        clientLog.info('SFU', `Recv transport state: ${state}`);
        if (state === 'failed') {
          clientLog.warn('SFU', 'Recv transport failed, requesting fallback');
          this.callbacks.onFallbackToP2p('Falha na conexão do transporte de recepção SFU');
        }
      });

      // 5. Register network listeners for new producers and producer closed
      this.subscribeNetworkEvents();

      // 6. Fetch existing producers in the channel and consume them
      try {
        const producersResp = await this.client.sendRequest<SfuProducersListPayload>(
          MessageType.SFU_GET_PRODUCERS,
          { channelId } satisfies SfuGetProducersPayload,
          undefined,
          8000
        );

        if (producersResp && Array.isArray(producersResp.producers)) {
          for (const prod of producersResp.producers) {
            void this.consumeRemoteProducer(prod);
          }
        }
      } catch (err: any) {
        clientLog.warn('SFU', 'Failed to fetch existing producers in channel', { error: err?.message });
      }

      this.isConnected = true;
      this.isConnecting = false;
      clientLog.info('SFU', `Successfully connected to SFU channel ${channelId}`);
      return true;
    } catch (err: any) {
      clientLog.error('SFU', 'Error joining SFU channel', { error: err?.message });
      this.leave();
      return false;
    }
  }

  private subscribeNetworkEvents(): void {
    const handleNewProducer = (payload: SfuNewProducerPayload) => {
      if (payload.channelId !== this.channelId) return;
      void this.consumeRemoteProducer(payload);
    };

    const handleProducerClosed = (payload: SfuProducerClosedPayload) => {
      if (payload.channelId !== this.channelId) return;
      this.handleRemoteProducerClosed(payload.producerId);
    };

    const handleContingencyFallback = (payload: { reason?: string }) => {
      clientLog.warn('SFU', `Contingency fallback triggered: ${payload.reason}`);
      this.callbacks.onFallbackToP2p(payload.reason || 'Servidor acionou contingência P2P');
    };

    appEvents.on(`message.${MessageType.SFU_NEW_PRODUCER}`, handleNewProducer);
    appEvents.on(`message.${MessageType.SFU_PRODUCER_CLOSED}`, handleProducerClosed);
    appEvents.on(`message.${MessageType.SFU_CONTINGENCY_FALLBACK}`, handleContingencyFallback);

    this.unsubscribeEvents.push(() => {
      appEvents.off(`message.${MessageType.SFU_NEW_PRODUCER}`, handleNewProducer);
      appEvents.off(`message.${MessageType.SFU_PRODUCER_CLOSED}`, handleProducerClosed);
      appEvents.off(`message.${MessageType.SFU_CONTINGENCY_FALLBACK}`, handleContingencyFallback);
    });
  }

  public async produceMic(track: MediaStreamTrack): Promise<mediasoupTypes.Producer | null> {
    if (!this.sendTransport || !this.device?.canProduce('audio')) return null;
    try {
      this.closeProducer('mic');
      const producer = await this.sendTransport.produce({
        track,
        appData: { mediaType: 'mic' },
        codecOptions: {
          opusStereo: true,
          opusDtx: true,
        },
      });
      this.producers.set('mic', producer);
      producer.on('transportclose', () => {
        this.producers.delete('mic');
      });
      clientLog.info('SFU', `Produced mic audio track ${track.id} with producerId ${producer.id}`);
      return producer;
    } catch (err: any) {
      clientLog.error('SFU', 'Failed to produce mic track', { error: err?.message });
      return null;
    }
  }

  public async produceCamera(track: MediaStreamTrack): Promise<mediasoupTypes.Producer | null> {
    if (!this.sendTransport || !this.device?.canProduce('video')) return null;
    try {
      this.closeProducer('camera');
      const producer = await this.sendTransport.produce({
        track,
        appData: { mediaType: 'camera' },
      });
      this.producers.set('camera', producer);
      producer.on('transportclose', () => {
        this.producers.delete('camera');
      });
      clientLog.info('SFU', `Produced camera video track ${track.id} with producerId ${producer.id}`);
      return producer;
    } catch (err: any) {
      clientLog.error('SFU', 'Failed to produce camera track', { error: err?.message });
      return null;
    }
  }

  public async produceScreenVideo(track: MediaStreamTrack, shareId: string): Promise<mediasoupTypes.Producer | null> {
    if (!this.sendTransport || !this.device?.canProduce('video')) return null;
    const key = `screen_video:${shareId}`;
    try {
      this.closeProducer(key);
      const producer = await this.sendTransport.produce({
        track,
        appData: { mediaType: 'screen_video', shareId },
      });
      this.producers.set(key, producer);
      producer.on('transportclose', () => {
        this.producers.delete(key);
      });
      clientLog.info('SFU', `Produced screen video track ${track.id} shareId ${shareId} with producerId ${producer.id}`);
      return producer;
    } catch (err: any) {
      clientLog.error('SFU', 'Failed to produce screen video track', { error: err?.message });
      return null;
    }
  }

  public async produceScreenAudio(track: MediaStreamTrack, shareId: string): Promise<mediasoupTypes.Producer | null> {
    if (!this.sendTransport || !this.device?.canProduce('audio')) return null;
    const key = `screen_audio:${shareId}`;
    try {
      this.closeProducer(key);
      const producer = await this.sendTransport.produce({
        track,
        appData: { mediaType: 'screen_audio', shareId },
        codecOptions: {
          opusStereo: true,
        },
      });
      this.producers.set(key, producer);
      producer.on('transportclose', () => {
        this.producers.delete(key);
      });
      clientLog.info('SFU', `Produced screen audio track ${track.id} shareId ${shareId} with producerId ${producer.id}`);
      return producer;
    } catch (err: any) {
      clientLog.error('SFU', 'Failed to produce screen audio track', { error: err?.message });
      return null;
    }
  }

  public async replaceTrack(key: string, track: MediaStreamTrack | null): Promise<boolean> {
    const producer = this.producers.get(key);
    if (!producer) return false;
    try {
      await producer.replaceTrack({ track });
      return true;
    } catch (err: any) {
      clientLog.error('SFU', `Failed to replace track for producer ${key}`, { error: err?.message });
      return false;
    }
  }

  public closeProducer(key: string): void {
    const producer = this.producers.get(key);
    if (producer) {
      try {
        producer.close();
      } catch {}
      this.producers.delete(key);
      if (this.channelId) {
        this.client.send(MessageType.SFU_PRODUCER_CLOSED, {
          channelId: this.channelId,
          producerId: producer.id,
        } satisfies SfuProducerClosedPayload);
      }
    }
  }

  private async consumeRemoteProducer(producerData: SfuNewProducerPayload): Promise<void> {
    if (!this.recvTransport || !this.device || !this.channelId) return;
    const { producerId, producerSessionId, kind, appData } = producerData;

    // Do not consume our own producers
    const mySessionId = this.getMySessionId();
    if (producerSessionId && mySessionId && producerSessionId === mySessionId) {
      return;
    }

    if (this.consumers.has(producerId) || this.consumerMeta.has(producerId)) {
      return;
    }

    try {
      clientLog.info('SFU', `Consuming producer ${producerId} (${kind}) from session ${producerSessionId}`);

      const consumed = await this.client.sendRequest<SfuConsumedPayload>(
        MessageType.SFU_CONSUME,
        {
          channelId: this.channelId,
          transportId: this.recvTransport.id,
          producerId,
          rtpCapabilities: this.device.rtpCapabilities,
        } satisfies SfuConsumePayload,
        undefined,
        8000
      );

      const consumer = await this.recvTransport.consume({
        id: consumed.id,
        producerId: consumed.producerId,
        kind: consumed.kind as any,
        rtpParameters: consumed.rtpParameters as any,
        appData: consumed.appData || {},
      });

      this.consumers.set(producerId, consumer);
      this.consumerMeta.set(producerId, {
        producerSessionId,
        mediaType: appData.mediaType,
        shareId: appData.shareId,
        consumerId: consumer.id,
      });

      consumer.on('trackended', () => {
        this.handleRemoteProducerClosed(producerId);
      });

      consumer.on('transportclose', () => {
        this.handleRemoteProducerClosed(producerId);
      });

      const mediaType = (appData.mediaType || (kind === 'audio' ? 'mic' : 'camera')) as SfuConsumerTrackEvent['mediaType'];

      this.callbacks.onConsumerTrack({
        producerSessionId,
        kind,
        mediaType,
        track: consumer.track,
        consumerId: consumer.id,
        producerId,
        shareId: appData.shareId,
        rtpReceiver: (consumer as any).rtpReceiver,
      });
    } catch (err: any) {
      clientLog.error('SFU', `Error consuming remote producer ${producerId}`, { error: err?.message });
    }
  }

  private handleRemoteProducerClosed(producerId: string): void {
    const consumer = this.consumers.get(producerId);
    const meta = this.consumerMeta.get(producerId);
    if (consumer) {
      try {
        consumer.close();
      } catch {}
      this.consumers.delete(producerId);
    }
    if (meta) {
      this.consumerMeta.delete(producerId);
      this.callbacks.onConsumerClosed(meta.producerSessionId, meta.mediaType, meta.shareId);
    }
  }

  public async setConsumerPaused(producerId: string, paused: boolean): Promise<void> {
    const consumer = this.consumers.get(producerId);
    if (consumer && this.channelId) {
      if (paused) {
        consumer.pause();
      } else {
        consumer.resume();
      }
      this.client.send(MessageType.SFU_CONSUMER_SET_PAUSED, {
        channelId: this.channelId,
        consumerId: consumer.id,
        paused,
      });
    }
  }

  public getConsumerReceiver(producerSessionId: string, mediaType: string = 'mic'): RTCRtpReceiver | null {
    for (const [prodId, meta] of this.consumerMeta.entries()) {
      if (meta.producerSessionId === producerSessionId && meta.mediaType === mediaType) {
        const consumer = this.consumers.get(prodId);
        return (consumer as any)?.rtpReceiver ?? null;
      }
    }
    return null;
  }

  public isReady(): boolean {
    return this.isConnected && !!this.sendTransport && !!this.recvTransport;
  }

  public async getPing(): Promise<number | null> {
    const transport = this.sendTransport || this.recvTransport;
    if (!transport) return null;
    try {
      const stats = await transport.getStats();
      for (const report of stats.values()) {
        if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.nominated)) {
          if (typeof report.currentRoundTripTime === 'number') {
            return Math.round(report.currentRoundTripTime * 1000);
          }
          if (typeof report.roundTripTime === 'number') {
            return Math.round(report.roundTripTime * 1000);
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  public leave(): void {
    for (const unsub of this.unsubscribeEvents) {
      unsub();
    }
    this.unsubscribeEvents = [];

    for (const producer of this.producers.values()) {
      try {
        producer.close();
      } catch {}
    }
    this.producers.clear();

    for (const consumer of this.consumers.values()) {
      try {
        consumer.close();
      } catch {}
    }
    this.consumers.clear();
    this.consumerMeta.clear();

    if (this.sendTransport) {
      try {
        this.sendTransport.close();
      } catch {}
      this.sendTransport = null;
    }

    if (this.recvTransport) {
      try {
        this.recvTransport.close();
      } catch {}
      this.recvTransport = null;
    }

    this.device = null;
    this.channelId = null;
    this.isConnected = false;
    this.isConnecting = false;
  }
}
