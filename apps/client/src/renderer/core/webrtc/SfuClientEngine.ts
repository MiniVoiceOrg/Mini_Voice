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
import { settingsStore } from '../../stores/settingsStore';
import { shouldPreferHardwareEncoding, sortVideoCodecs } from './codecPreferences';

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
  /**
   * The SFU link is down. There is no degraded mode to fall back to, so the
   * manager answers this by rejoining the room until it comes back.
   */
  onConnectionFailed: (reason: string) => void;
  /** A transport reached `connected`, which closes any rejoin ladder in flight. */
  onConnected: () => void;
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
  /**
   * Last reported state of each transport.
   *
   * Tracked separately because the two carry different media in different
   * directions and can diverge: a send transport reaching `connected` while
   * the recv one failed must not be read as a healthy session, or the rejoin
   * that the failure asked for would be cancelled and half the call would stay
   * dead.
   */
  private sendTransportState: string = 'new';
  private recvTransportState: string = 'new';
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
      console.log(`[SFU Client] Joining SFU room for channel ${channelId}...`);
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

      console.log(`[SFU Client] Received Router RTP capabilities (${routerCapsResp.rtpCapabilities.codecs?.length || 0} codecs). Loading device...`);

      // 2. Load device
      this.device = new mediasoupClient.Device();
      await this.device.load({ routerRtpCapabilities: routerCapsResp.rtpCapabilities as any });
      console.log(`[SFU Client] Mediasoup Device loaded! Can produce audio: ${this.canProduceKind('audio')}, video: ${this.canProduceKind('video')}`);

      // 3. Create send transport
      console.log(`[SFU Client] Requesting createSendTransport from server...`);
      const sendCreated = await this.client.sendRequest<SfuWebRtcTransportCreatedPayload>(
        MessageType.SFU_CREATE_WEBRTC_TRANSPORT,
        { channelId, direction: 'send' } satisfies SfuCreateWebRtcTransportPayload,
        undefined,
        10000
      );

      console.log(`[SFU Client] Send transport created on server (${sendCreated.transportOptions?.id}). ICE candidates:`, sendCreated.transportOptions?.iceCandidates?.map((c: any) => `${c.protocol?.toUpperCase()} ${c.ip || c.address}:${c.port}`));

      this.sendTransport = this.device.createSendTransport(sendCreated.transportOptions as any);

      this.sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        console.log(`[SFU Client] Send transport on('connect') DTLS triggered (role: ${dtlsParameters.role})`);
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
          .then(() => {
            console.log(`[SFU Client] Send transport DTLS connect acknowledged by server`);
            callback();
          })
          .catch((err) => {
            console.error('[SFU Client] Send transport connect error:', err);
            clientLog.error('SFU', 'Send transport connect error', { error: err?.message });
            errback(err);
          });
      });

      this.sendTransport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        console.log(`[SFU Client] Send transport on('produce') triggered: kind=${kind}, type=${appData?.mediaType}`);
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
            console.log(`[SFU Client] Producer acknowledged by server with producerId: ${resp.id}`);
            callback({ id: resp.id });
          })
          .catch((err) => {
            console.error('[SFU Client] Send transport produce error:', err);
            clientLog.error('SFU', 'Send transport produce error', { error: err?.message });
            errback(err);
          });
      });

      this.sendTransport.on('connectionstatechange', (state) => {
        console.log(`[SFU Client] Send transport connectionState changed: ${state}`);
        clientLog.info('SFU', `Send transport state: ${state}`);
        this.sendTransportState = state;
        if (state === 'failed') {
          clientLog.warn('SFU', 'Send transport failed, requesting reconnect');
          this.callbacks.onConnectionFailed('SFU send transport connection failed');
          return;
        }
        this.notifyIfHealthy();
      });

      // 4. Create recv transport
      console.log(`[SFU Client] Requesting createRecvTransport from server...`);
      const recvCreated = await this.client.sendRequest<SfuWebRtcTransportCreatedPayload>(
        MessageType.SFU_CREATE_WEBRTC_TRANSPORT,
        { channelId, direction: 'recv' } satisfies SfuCreateWebRtcTransportPayload,
        undefined,
        10000
      );

      console.log(`[SFU Client] Recv transport created on server (${recvCreated.transportOptions?.id}). ICE candidates:`, recvCreated.transportOptions?.iceCandidates?.map((c: any) => `${c.protocol?.toUpperCase()} ${c.ip || c.address}:${c.port}`));

      this.recvTransport = this.device.createRecvTransport(recvCreated.transportOptions as any);

      this.recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        console.log(`[SFU Client] Recv transport on('connect') DTLS triggered (role: ${dtlsParameters.role})`);
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
          .then(() => {
            console.log(`[SFU Client] Recv transport DTLS connect acknowledged by server`);
            callback();
          })
          .catch((err) => {
            console.error('[SFU Client] Recv transport connect error:', err);
            clientLog.error('SFU', 'Recv transport connect error', { error: err?.message });
            errback(err);
          });
      });

      this.recvTransport.on('connectionstatechange', (state) => {
        console.log(`[SFU Client] Recv transport connectionState changed: ${state}`);
        clientLog.info('SFU', `Recv transport state: ${state}`);
        this.recvTransportState = state;
        if (state === 'failed') {
          clientLog.warn('SFU', 'Recv transport failed, requesting reconnect');
          this.callbacks.onConnectionFailed('SFU recv transport connection failed');
          return;
        }
        this.notifyIfHealthy();
      });

      // 5. Register network listeners for new producers and producer closed
      this.subscribeNetworkEvents();

      // 6. Fetch existing producers in the channel and consume them
      try {
        console.log(`[SFU Client] Fetching existing producers in channel ${channelId}...`);
        const producersResp = await this.client.sendRequest<SfuProducersListPayload>(
          MessageType.SFU_GET_PRODUCERS,
          { channelId } satisfies SfuGetProducersPayload,
          undefined,
          8000
        );

        if (producersResp && Array.isArray(producersResp.producers)) {
          console.log(`[SFU Client] Found ${producersResp.producers.length} existing producers in channel:`, producersResp.producers);
          for (const prod of producersResp.producers) {
            void this.consumeRemoteProducer(prod);
          }
        }
      } catch (err: any) {
        console.warn('[SFU Client] Failed to fetch existing producers in channel:', err);
        clientLog.warn('SFU', 'Failed to fetch existing producers in channel', { error: err?.message });
      }

      this.isConnected = true;
      this.isConnecting = false;
      console.log(`[SFU Client] Successfully joined and initialized SFU for channel ${channelId}`);
      clientLog.info('SFU', `Successfully connected to SFU channel ${channelId}`);
      return true;
    } catch (err: any) {
      console.error('[SFU Client] Error joining SFU channel:', err);
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

    appEvents.on(`message.${MessageType.SFU_NEW_PRODUCER}`, handleNewProducer);
    appEvents.on(`message.${MessageType.SFU_PRODUCER_CLOSED}`, handleProducerClosed);

    this.unsubscribeEvents.push(() => {
      appEvents.off(`message.${MessageType.SFU_NEW_PRODUCER}`, handleNewProducer);
      appEvents.off(`message.${MessageType.SFU_PRODUCER_CLOSED}`, handleProducerClosed);
    });
  }

  public canProduceKind(kind: 'audio' | 'video'): boolean {
    if (!this.device || !this.device.loaded) return false;
    try {
      return this.device.canProduce(kind);
    } catch {
      return false;
    }
  }

  /**
   * Picks which codec to encode video with instead of letting mediasoup take the
   * first one the router offers (#526).
   *
   * The router advertises AV1 first, and AV1 has no hardware encoder on most
   * desktops — so a 1080p screen share was being encoded on the CPU, which is
   * exactly what makes a game stutter while sharing. This honours the same
   * preference the user picks for P2P calls.
   */
  private pickVideoCodec(): mediasoupTypes.RtpCodecCapability | undefined {
    const codecs = this.device?.rtpCapabilities?.codecs;
    if (!codecs) return undefined;

    const videoCodecs = codecs.filter(
      (codec) => codec.kind === 'video' && !/\/(rtx|red|ulpfec|flexfec)/i.test(codec.mimeType)
    );
    if (videoCodecs.length === 0) return undefined;

    const [best] = sortVideoCodecs(
      videoCodecs,
      settingsStore?.preferredVideoCodec ?? 'auto',
      shouldPreferHardwareEncoding()
    );
    return best;
  }

  public async produceMic(track: MediaStreamTrack): Promise<mediasoupTypes.Producer | null> {
    if (!this.sendTransport || !this.canProduceKind('audio')) {
      console.warn(`[SFU Client] Cannot produce mic: sendTransport=${!!this.sendTransport}, canProduceAudio=${this.canProduceKind('audio')}`);
      return null;
    }
    try {
      this.closeProducer('mic');
      console.log(`[SFU Client] Producing microphone track ${track.id} (enabled=${track.enabled}, readyState=${track.readyState})...`);
      const producer = await this.sendTransport.produce({
        track,
        appData: { mediaType: 'mic' },
        codecOptions: {
          opusDtx: true,
        },
      });
      this.producers.set('mic', producer);
      producer.on('transportclose', () => {
        console.log(`[SFU Client] Mic producer transport closed`);
        this.producers.delete('mic');
      });
      console.log(`[SFU Client] Produced mic audio track ${track.id} with producerId ${producer.id}`);
      clientLog.info('SFU', `Produced mic audio track ${track.id} with producerId ${producer.id}`);
      return producer;
    } catch (err: any) {
      console.error('[SFU Client] Failed to produce mic track:', err);
      clientLog.error('SFU', 'Failed to produce mic track', { error: err?.message });
      return null;
    }
  }

  public async produceCamera(track: MediaStreamTrack): Promise<mediasoupTypes.Producer | null> {
    if (!this.sendTransport || !this.canProduceKind('video')) {
      console.warn(`[SFU Client] Cannot produce camera: sendTransport=${!!this.sendTransport}, canProduceVideo=${this.canProduceKind('video')}`);
      return null;
    }
    try {
      this.closeProducer('camera');
      console.log(`[SFU Client] Producing camera track ${track.id}...`);
      const producer = await this.sendTransport.produce({
        track,
        codec: this.pickVideoCodec(),
        appData: { mediaType: 'camera' },
      });
      this.producers.set('camera', producer);
      producer.on('transportclose', () => {
        this.producers.delete('camera');
      });
      console.log(`[SFU Client] Produced camera video track ${track.id} with producerId ${producer.id}`);
      clientLog.info('SFU', `Produced camera video track ${track.id} with producerId ${producer.id}`);
      return producer;
    } catch (err: any) {
      console.error('[SFU Client] Failed to produce camera track:', err);
      clientLog.error('SFU', 'Failed to produce camera track', { error: err?.message });
      return null;
    }
  }

  public async produceScreenVideo(track: MediaStreamTrack, shareId: string): Promise<mediasoupTypes.Producer | null> {
    if (!this.sendTransport || !this.canProduceKind('video')) return null;
    const key = `screen_video:${shareId}`;
    try {
      this.closeProducer(key);
      const producer = await this.sendTransport.produce({
        track,
        codec: this.pickVideoCodec(),
        appData: { mediaType: 'screen_video', shareId },
      });
      this.producers.set(key, producer);
      producer.on('transportclose', () => {
        this.producers.delete(key);
      });
      console.log(`[SFU Client] Produced screen video track ${track.id} shareId ${shareId} with producerId ${producer.id}`);
      clientLog.info('SFU', `Produced screen video track ${track.id} shareId ${shareId} with producerId ${producer.id}`);
      return producer;
    } catch (err: any) {
      console.error('[SFU Client] Failed to produce screen video track:', err);
      clientLog.error('SFU', 'Failed to produce screen video track', { error: err?.message });
      return null;
    }
  }

  public async produceScreenAudio(track: MediaStreamTrack, shareId: string): Promise<mediasoupTypes.Producer | null> {
    if (!this.sendTransport || !this.canProduceKind('audio')) return null;
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
      console.log(`[SFU Client] Produced screen audio track ${track.id} shareId ${shareId} with producerId ${producer.id}`);
      clientLog.info('SFU', `Produced screen audio track ${track.id} shareId ${shareId} with producerId ${producer.id}`);
      return producer;
    } catch (err: any) {
      console.error('[SFU Client] Failed to produce screen audio track:', err);
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
    if (!this.recvTransport || !this.device || !this.channelId) {
      console.warn(`[SFU Client] Cannot consume: recvTransport=${!!this.recvTransport}, device=${!!this.device}, channelId=${this.channelId}`);
      return;
    }
    const { producerId, producerSessionId, kind, appData } = producerData;

    // Do not consume our own producers
    const mySessionId = this.getMySessionId();
    if (producerSessionId && mySessionId && producerSessionId === mySessionId) {
      console.log(`[SFU Client] Skipping consumption of our own producer ${producerId}`);
      return;
    }

    if (this.consumers.has(producerId) || this.consumerMeta.has(producerId)) {
      console.log(`[SFU Client] Already consuming producer ${producerId}`);
      return;
    }

    try {
      console.log(`[SFU Client] Consuming remote producer ${producerId} (${kind}, mediaType: ${appData?.mediaType}) from session ${producerSessionId}...`);
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

      console.log(`[SFU Client] Consumed producer ${producerId} successfully! Consumer track: (id=${consumer.track.id}, kind=${consumer.track.kind}, enabled=${consumer.track.enabled}, readyState=${consumer.track.readyState}, muted=${consumer.track.muted})`);

      this.consumers.set(producerId, consumer);
      this.consumerMeta.set(producerId, {
        producerSessionId,
        mediaType: appData.mediaType,
        shareId: appData.shareId,
        consumerId: consumer.id,
      });

      consumer.on('trackended', () => {
        console.log(`[SFU Client] Consumer track ended for producer ${producerId}`);
        this.handleRemoteProducerClosed(producerId);
      });

      consumer.on('transportclose', () => {
        console.log(`[SFU Client] Consumer transport closed for producer ${producerId}`);
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
      console.error(`[SFU Client] Error consuming remote producer ${producerId}:`, err);
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

  public isChannelConnected(): boolean {
    return this.isConnected;
  }

  public getCameraSender(): RTCRtpSender | null {
    const producer = this.producers.get('camera');
    return (producer as any)?.rtpSender ?? null;
  }

  public getScreenSender(shareId: string): RTCRtpSender | null {
    const producer = this.producers.get(`screen_video:${shareId}`);
    return (producer as any)?.rtpSender ?? null;
  }

  public getReceiverForTrack(trackId: string): RTCRtpReceiver | null {
    for (const consumer of this.consumers.values()) {
      if (consumer.track.id === trackId) {
        return (consumer as any)?.rtpReceiver ?? null;
      }
    }
    return null;
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
    this.sendTransportState = 'new';
    this.recvTransportState = 'new';
  }

  /**
   * Reports a healthy session as soon as one direction is up, provided the
   * other one is not down.
   *
   * Requiring *both* to be connected reads safer — a rejoin asked for by one
   * transport must never be cancelled by the other succeeding — but a
   * transport's underlying peer connection stays `new` until something
   * negotiates on it, and mediasoup only negotiates on the first `produce()`
   * or `consume()`. A listen-only client never produces and a client whose
   * peers are all silent never consumes, so for them the pair could never both
   * be connected: recovery would never be reported as finished, the other
   * participants would keep their "connecting" badge, and the backoff would
   * stay pinned at its longest delay for the rest of the session.
   */
  private notifyIfHealthy(): void {
    if (this.sendTransportState === 'failed' || this.recvTransportState === 'failed') return;
    if (this.sendTransportState !== 'connected' && this.recvTransportState !== 'connected') return;
    this.callbacks.onConnected();
  }
}
