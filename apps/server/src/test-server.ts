import { generateKeyPairSync, sign } from 'crypto';
import path from 'path';
import fs from 'fs';
import { RawData, WebSocket } from 'ws';
import {
  MessageType,
  ProtocolErrorCode,
  ProtocolMessage,
  PROTOCOL_VERSION,
} from '@monky/shared';
import { MonkyServer } from './server';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout (${ms}ms) aguardando: ${label}`)), ms)
    ),
  ]);
}

function createIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyHex: publicKey.export({ format: 'der', type: 'spki' }).toString('hex'),
    privateKey,
  };
}

async function authenticateSocket(
  ws: WebSocket,
  requestId: string,
  nickname: string,
  password: string,
  options?: { expectErrorCode?: ProtocolErrorCode }
): Promise<any> {
  const identity = createIdentity();

  return await withTimeout(new Promise((resolve, reject) => {
    const onMessage = (data: RawData) => {
      const res = JSON.parse(data.toString());

      if (options?.expectErrorCode) {
        if (res.type === MessageType.SERVER_ERROR && res.payload.code === options.expectErrorCode) {
          ws.off('message', onMessage);
          resolve(res);
        }
        return;
      }

      if (res.type === MessageType.AUTH_CHALLENGE && res.requestId === requestId) {
        const signature = sign(null, Buffer.from(res.payload.nonce, 'hex'), identity.privateKey).toString('hex');
        const response: ProtocolMessage = {
          type: MessageType.AUTH_CHALLENGE_RESPONSE,
          requestId,
          payload: { signature },
        };
        ws.send(JSON.stringify(response));
        return;
      }

      if (res.type === MessageType.AUTH_SUCCESS && res.requestId === requestId) {
        ws.off('message', onMessage);
        resolve(res);
      }
    };

    ws.on('message', onMessage);
    ws.on('error', reject);
    ws.on('open', () => {
      const connectMsg: ProtocolMessage = {
        type: MessageType.AUTH_CONNECT,
        requestId,
        payload: {
          protocolVersion: PROTOCOL_VERSION,
          publicKey: identity.publicKeyHex,
          nickname,
          password,
        },
      };
      ws.send(JSON.stringify(connectMsg));
    });
  }), 5000, `Autenticação ${nickname}`);
}

async function runTests() {
  console.log('=== Início dos Testes do Servidor Monky ===');
  const testDataDir = path.join(__dirname, '../../test-data');
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }

  const server = await MonkyServer.create({
    port: 3999,
    dataDir: testDataDir,
    serverName: 'Servidor de Testes',
    password: 'senha-secreta-123',
    maxUsers: 5,
  });

  await server.start();
  console.log('✔ Servidor iniciado na porta 3999');

  try {
    const ws1 = new WebSocket('ws://127.0.0.1:3999');
    await authenticateSocket(ws1, 'req-1', 'UserTest1', 'senha-errada', {
      expectErrorCode: ProtocolErrorCode.AUTH_INVALID_PASSWORD,
    });
    console.log('✔ Teste 1 passou: Senha incorreta rejeitada com AUTH_INVALID_PASSWORD');
    ws1.close();

    const ws2 = new WebSocket('ws://127.0.0.1:3999');
    const auth2 = await authenticateSocket(ws2, 'req-2', 'UserTest2', 'senha-secreta-123');
    console.log('✔ Teste 2 passou: Conexão autenticada com sucesso! Servidor:', auth2.payload.server.name);
    const textChannelId = auth2.payload.server.channels.find((c: any) => c.type === 'TEXT').id;
    const voiceChannelId = auth2.payload.server.channels.find((c: any) => c.type === 'VOICE').id;

    const ws3 = new WebSocket('ws://127.0.0.1:3999');
    await withTimeout(new Promise<void>((resolve) => {
      authenticateSocket(ws3, 'req-3', 'UserTest2', 'senha-secreta-123').catch(() => {});
      ws3.on('message', (data) => {
        const res = JSON.parse(data.toString());
        if (res.type === MessageType.SERVER_ERROR && res.payload.code === ProtocolErrorCode.NICKNAME_ALREADY_EXISTS) {
          console.log('✔ Teste 3 passou: Nickname duplicado rejeitado com NICKNAME_ALREADY_EXISTS');
          ws3.close();
          resolve();
        }
      });
    }), 5000, 'Teste 3: nickname duplicado');

    await withTimeout(new Promise<void>((resolve) => {
      const sendMsg: ProtocolMessage = {
        type: MessageType.CHAT_SEND,
        requestId: 'req-4',
        payload: {
          channelId: textChannelId,
          content: 'Olá mundo do Monky!',
        },
      };

      const handler = (data: RawData) => {
        const res = JSON.parse(data.toString());
        if (res.type === MessageType.CHAT_MESSAGE && res.payload.content === 'Olá mundo do Monky!') {
          console.log('✔ Teste 4 passou: Mensagem de chat enviada e recebida com sucesso!');
          ws2.off('message', handler);
          resolve();
        }
      };

      ws2.on('message', handler);
      ws2.send(JSON.stringify(sendMsg));
    }), 5000, 'Teste 4: mensagem de chat');

    await withTimeout(new Promise<void>((resolve) => {
      const soundMsg: ProtocolMessage = {
        type: MessageType.SOUNDBOARD_PLAY,
        requestId: 'req-5',
        payload: {
          channelId: voiceChannelId,
          soundName: 'Airhorn',
          audioBase64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
          mimeType: 'audio/wav',
        },
      };

      const handler = (data: RawData) => {
        const res = JSON.parse(data.toString());
        if (res.type === MessageType.SOUNDBOARD_PLAYED && res.payload.soundName === 'Airhorn') {
          console.log('✔ Teste 5 passou: Reprodução de soundboard transmitida com sucesso!');
          ws2.off('message', handler);
          resolve();
        }
      };

      ws2.on('message', handler);
      ws2.send(JSON.stringify(soundMsg));
    }), 5000, 'Teste 5: reprodução de soundboard');

    await withTimeout(new Promise<void>((resolve, reject) => {
      const updateSettingsMsg: ProtocolMessage = {
        type: MessageType.SERVER_UPDATE_SETTINGS,
        requestId: 'req-6-update',
        payload: {
          name: 'Servidor Sem Soundboard',
          allowSoundboard: false,
        },
      };

      const settingsHandler = (data: RawData) => {
        const res = JSON.parse(data.toString());
        if (res.type === MessageType.SERVER_SETTINGS_UPDATED && res.payload.allowSoundboard === false) {
          ws2.off('message', settingsHandler);

          const soundMsg: ProtocolMessage = {
            type: MessageType.SOUNDBOARD_PLAY,
            requestId: 'req-6-play',
            payload: {
              channelId: voiceChannelId,
              soundName: 'Airhorn Blocked',
              audioBase64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
              mimeType: 'audio/wav',
            },
          };

          const soundHandler = (d: RawData) => {
            const r = JSON.parse(d.toString());
            if (r.type === MessageType.SERVER_ERROR && r.payload.message.includes('desabilitada')) {
              console.log('✔ Teste 6 passou: Soundboard bloqueado com sucesso após desabilitação no servidor!');
              ws2.off('message', soundHandler);
              resolve();
            }
          };

          ws2.on('message', soundHandler);
          ws2.send(JSON.stringify(soundMsg));
        }
      };

      ws2.on('message', settingsHandler);
      ws2.send(JSON.stringify(updateSettingsMsg));
    }), 5000, 'Teste 6: desabilitar soundboard no servidor');

    await withTimeout(new Promise<void>((resolve, reject) => {
      const inviteReqMsg: ProtocolMessage = {
        type: MessageType.SERVER_GET_INVITE_INFO,
        requestId: 'req-7-invite',
        payload: {},
      };

      const inviteHandler = (data: RawData) => {
        const res = JSON.parse(data.toString());
        if (res.type === MessageType.SERVER_INVITE_INFO && res.requestId === 'req-7-invite') {
          if (typeof res.payload.port === 'number' && Array.isArray(res.payload.networkInterfaces) && res.payload.networkInterfaces.length > 0) {
            console.log(`✔ Teste 7 passou: Informações de convite do servidor retornadas com sucesso! (Porta: ${res.payload.port}, ${res.payload.networkInterfaces.length} IPs encontrados)`);
            ws2.off('message', inviteHandler);
            resolve();
          } else {
            reject(new Error('Resposta de invite info inválida: ' + JSON.stringify(res.payload)));
          }
        }
      };

      ws2.on('message', inviteHandler);
      ws2.send(JSON.stringify(inviteReqMsg));
    }), 5000, 'Teste 7: obter dados de convite do servidor');

    ws2.close();
    console.log('=== Todos os testes do servidor passaram com sucesso! ===');
  } finally {
    await server.stop();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  }
}

runTests().catch((err) => {
  console.error('Falha nos testes:', err);
  process.exit(1);
});
