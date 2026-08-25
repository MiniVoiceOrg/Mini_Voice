import path from 'path';
import fs from 'fs';
import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import {
  MessageType,
  ProtocolErrorCode,
  ProtocolMessage,
  PROTOCOL_VERSION,
} from '@monky/shared';
import { MonkyServer } from './server';

/** Rejects if the given promise does not settle within `ms`, preventing a hung test from blocking forever. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout (${ms}ms) aguardando: ${label}`)), ms)
    ),
  ]);
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
    // Test 1: Connect with wrong password
    const ws1 = new WebSocket('ws://127.0.0.1:3999');
    await withTimeout(new Promise<void>((resolve, reject) => {
      ws1.on('open', () => {
        const connectMsg: ProtocolMessage = {
          type: MessageType.AUTH_CONNECT,
          requestId: 'req-1',
          payload: {
            protocolVersion: PROTOCOL_VERSION,
            clientId: uuidv4(),
            nickname: 'UserTest1',
            password: 'senha-errada',
          },
        };
        ws1.send(JSON.stringify(connectMsg));
      });

      ws1.on('message', (data) => {
        const res = JSON.parse(data.toString());
        if (res.type === MessageType.SERVER_ERROR && res.payload.code === ProtocolErrorCode.AUTH_INVALID_PASSWORD) {
          console.log('✔ Teste 1 passou: Senha incorreta rejeitada com AUTH_INVALID_PASSWORD');
          ws1.close();
          resolve();
        } else {
          reject(new Error(`Esperado AUTH_INVALID_PASSWORD, recebido: ${JSON.stringify(res)}`));
        }
      });
    }), 5000, 'Teste 1: senha incorreta');

    // Test 2: Connect with correct password
    const ws2 = new WebSocket('ws://127.0.0.1:3999');
    let user2Id = '';
    let textChannelId = '';
    let voiceChannelId = '';

    await withTimeout(new Promise<void>((resolve, reject) => {
      ws2.on('open', () => {
        const connectMsg: ProtocolMessage = {
          type: MessageType.AUTH_CONNECT,
          requestId: 'req-2',
          payload: {
            protocolVersion: PROTOCOL_VERSION,
            clientId: uuidv4(),
            nickname: 'UserTest2',
            password: 'senha-secreta-123',
          },
        };
        ws2.send(JSON.stringify(connectMsg));
      });

      ws2.on('message', (data) => {
        const res = JSON.parse(data.toString());
        if (res.type === MessageType.AUTH_SUCCESS) {
          console.log('✔ Teste 2 passou: Conexão autenticada com sucesso! Servidor:', res.payload.server.name);
          user2Id = res.payload.currentUser.id;
          textChannelId = res.payload.server.channels.find((c: any) => c.type === 'TEXT').id;
          voiceChannelId = res.payload.server.channels.find((c: any) => c.type === 'VOICE').id;
          resolve();
        }
      });
    }), 5000, 'Teste 2: autenticação');

    // Test 3: Connect another user with same nickname (must fail)
    const ws3 = new WebSocket('ws://127.0.0.1:3999');
    await withTimeout(new Promise<void>((resolve, reject) => {
      ws3.on('open', () => {
        const connectMsg: ProtocolMessage = {
          type: MessageType.AUTH_CONNECT,
          requestId: 'req-3',
          payload: {
            protocolVersion: PROTOCOL_VERSION,
            clientId: uuidv4(),
            nickname: 'UserTest2', // Same nickname!
            password: 'senha-secreta-123',
          },
        };
        ws3.send(JSON.stringify(connectMsg));
      });

      ws3.on('message', (data) => {
        const res = JSON.parse(data.toString());
        if (res.type === MessageType.SERVER_ERROR && res.payload.code === ProtocolErrorCode.NICKNAME_ALREADY_EXISTS) {
          console.log('✔ Teste 3 passou: Nickname duplicado rejeitado com NICKNAME_ALREADY_EXISTS');
          ws3.close();
          resolve();
        }
      });
    }), 5000, 'Teste 3: nickname duplicado');

    // Test 4: Send chat message and receive broadcast
    await withTimeout(new Promise<void>((resolve, reject) => {
      const sendMsg: ProtocolMessage = {
        type: MessageType.CHAT_SEND,
        requestId: 'req-4',
        payload: {
          channelId: textChannelId,
          content: 'Olá mundo do Monky!',
        },
      };

      const handler = (data: any) => {
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

    // Test 5: Soundboard Play and receive broadcast
    await withTimeout(new Promise<void>((resolve, reject) => {
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

      const handler = (data: any) => {
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

    // Test 6: Disable Soundboard via server settings and verify play is rejected
    await withTimeout(new Promise<void>((resolve, reject) => {
      const updateSettingsMsg: ProtocolMessage = {
        type: MessageType.SERVER_UPDATE_SETTINGS,
        requestId: 'req-6-update',
        payload: {
          name: 'Servidor Sem Soundboard',
          allowSoundboard: false,
        },
      };

      const settingsHandler = (data: any) => {
        const res = JSON.parse(data.toString());
        if (res.type === MessageType.SERVER_SETTINGS_UPDATED && res.payload.allowSoundboard === false) {
          ws2.off('message', settingsHandler);

          // Try playing soundboard now
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

          const soundHandler = (d: any) => {
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
