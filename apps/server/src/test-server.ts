import path from 'path';
import fs from 'fs';
import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import {
  MessageType,
  ProtocolErrorCode,
  ProtocolMessage,
  PROTOCOL_VERSION,
} from '@mini-voice/shared';
import { MiniVoiceServer } from './server';

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
  console.log('=== Início dos Testes do Servidor Mini Voice ===');
  const testDataDir = path.join(__dirname, '../../test-data');
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }

  const server = await MiniVoiceServer.create({
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
          content: 'Olá mundo do Mini Voice!',
        },
      };

      const handler = (data: any) => {
        const res = JSON.parse(data.toString());
        if (res.type === MessageType.CHAT_MESSAGE && res.payload.content === 'Olá mundo do Mini Voice!') {
          console.log('✔ Teste 4 passou: Mensagem de chat enviada e recebida com sucesso!');
          ws2.off('message', handler);
          resolve();
        }
      };

      ws2.on('message', handler);
      ws2.send(JSON.stringify(sendMsg));
    }), 5000, 'Teste 4: mensagem de chat');

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
