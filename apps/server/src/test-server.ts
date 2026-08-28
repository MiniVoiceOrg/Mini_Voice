import { generateKeyPairSync, sign } from 'crypto';
import path from 'path';
import fs from 'fs';
import { RawData, WebSocket } from 'ws';
import {
  ADMIN_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  LIMITS,
  LogEntry,
  MessageType,
  Permission,
  ProtocolErrorCode,
  ProtocolMessage,
  PROTOCOL_VERSION,
  hasPermission,
} from '@monky/shared';
import { MonkyServer } from './server';
import { Logger } from './infrastructure/logger/Logger';
import { compareVersions, pickNewestRelease } from './cli/commands/update';
import { generateEcosystem, getPm2ProcessName } from './cli/pm2';
import { parseOption } from './cli/formatters';
import { listServers, registerServer, serverIdFor, unregisterServer } from './cli/registry';
import { PasswordService } from './infrastructure/security/PasswordService';
import { RateLimiter } from './infrastructure/security/RateLimiter';

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
  options?: {
    expectErrorCode?: ProtocolErrorCode;
    /** Reuse an identity to simulate the same person on another device (#309). */
    identity?: ReturnType<typeof createIdentity>;
    deviceId?: string;
    /** Pretend to be a client speaking another protocol version (#355). */
    protocolVersion?: number;
  }
): Promise<any> {
  const identity = options?.identity ?? createIdentity();

  return await withTimeout(new Promise((resolve, reject) => {
    const onMessage = (data: RawData) => {
      const res = JSON.parse(data.toString());

      if (
        options?.expectErrorCode &&
        res.type === MessageType.SERVER_ERROR &&
        res.payload.code === options.expectErrorCode
      ) {
        ws.off('message', onMessage);
        resolve(res);
        return;
      }

      // Signed even when an error is expected: rejections like SERVER_FULL only
      // happen after the challenge is answered, so skipping this step here would
      // hang forever waiting for an error the server never gets to send (#403).
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

      if (options?.expectErrorCode) return;

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
          protocolVersion: options?.protocolVersion ?? PROTOCOL_VERSION,
          publicKey: identity.publicKeyHex,
          nickname,
          password,
          deviceId: options?.deviceId,
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

    // #309: a mesma identidade em dois dispositivos deve gerar duas sessões
    // vivas, em vez de uma derrubar a outra em loop de reconexão.
    const sharedIdentity = createIdentity();
    const wsDeviceA = new WebSocket('ws://127.0.0.1:3999');
    const authA = await authenticateSocket(wsDeviceA, 'req-8a', 'UserMultiDevice', 'senha-secreta-123', {
      identity: sharedIdentity,
      deviceId: 'device-a',
    });

    let deviceAWasClosed = false;
    wsDeviceA.on('close', () => { deviceAWasClosed = true; });

    const wsDeviceB = new WebSocket('ws://127.0.0.1:3999');
    const authB = await authenticateSocket(wsDeviceB, 'req-8b', 'UserMultiDevice', 'senha-secreta-123', {
      identity: sharedIdentity,
      deviceId: 'device-b',
    });

    const userId = authA.payload.currentUser.id;
    if (authB.payload.currentUser.id !== userId) {
      throw new Error('Teste 8: os dois dispositivos deveriam compartilhar o mesmo userId');
    }

    const sessionA = authA.payload.currentUser.sessionId;
    const sessionB = authB.payload.currentUser.sessionId;
    if (!sessionA || !sessionB || sessionA === sessionB) {
      throw new Error(`Teste 8: sessionIds deveriam existir e ser distintos (A=${sessionA}, B=${sessionB})`);
    }

    const ownSessions = authB.payload.server.members.filter((m: any) => m.id === userId);
    if (ownSessions.length !== 2) {
      throw new Error(`Teste 8: esperava 2 sessões da mesma pessoa em members, encontrei ${ownSessions.length}`);
    }

    // Dá tempo de um eventual close chegar antes de afirmar que não houve.
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (deviceAWasClosed) {
      throw new Error('Teste 8: o primeiro dispositivo foi derrubado pelo segundo');
    }
    console.log('✔ Teste 8 passou: Dois dispositivos com a mesma identidade coexistem como sessões distintas');

    // A proteção contra socket zumbi continua valendo por dispositivo: uma nova
    // conexão do *mesmo* deviceId substitui a anterior.
    const wsDeviceAAgain = new WebSocket('ws://127.0.0.1:3999');
    const closedByReplacement = new Promise<void>((resolve) => wsDeviceA.on('close', () => resolve()));
    await authenticateSocket(wsDeviceAAgain, 'req-9', 'UserMultiDevice', 'senha-secreta-123', {
      identity: sharedIdentity,
      deviceId: 'device-a',
    });
    await withTimeout(closedByReplacement, 5000, 'Teste 9: substituição do socket zumbi');
    console.log('✔ Teste 9 passou: Reconexão do mesmo dispositivo substitui o socket anterior');

    wsDeviceAAgain.close();
    wsDeviceB.close();

    // Teste 10: a API /releases devolve a lista ordenada por nome de tag, e nao
    // por data, entao `beta.9` chega antes de `beta.15`. Confiar na posicao 0
    // fazia o `monky update` oferecer uma build antiga como se fosse a ultima.
    const releasesComoAApiDevolve = [
      { tag_name: 'v2.4.0-beta.9' },
      { tag_name: 'v2.4.0-beta.8' },
      { tag_name: 'v2.4.0-beta.15' },
      { tag_name: 'v2.4.0-beta.14' },
    ];
    const maisNova = pickNewestRelease(releasesComoAApiDevolve);
    if (maisNova?.tag_name !== 'v2.4.0-beta.15') {
      throw new Error(`Teste 10: esperava v2.4.0-beta.15, recebi ${maisNova?.tag_name}`);
    }

    // Rascunhos nao tem asset publicado, entao nao podem ser escolhidos.
    const comRascunho = pickNewestRelease([
      { tag_name: 'v9.9.9', draft: true },
      { tag_name: 'v2.4.0-beta.15' },
    ]);
    if (comRascunho?.tag_name !== 'v2.4.0-beta.15') {
      throw new Error(`Teste 10: rascunho deveria ser ignorado, recebi ${comRascunho?.tag_name}`);
    }

    // A nomenclatura nova (#338) convive com a antiga e vence pelo numero.
    const naVirada = pickNewestRelease([{ tag_name: 'v3.0.0-beta001' }, { tag_name: 'v2.4.0-beta.15' }]);
    if (naVirada?.tag_name !== 'v3.0.0-beta001') {
      throw new Error(`Teste 10: esperava v3.0.0-beta001, recebi ${naVirada?.tag_name}`);
    }
    if (compareVersions('2.4.0-beta.15', '2.4.0-beta016') <= 0) {
      throw new Error('Teste 10: beta016 deveria ser considerada mais nova que beta.15');
    }

    // Uma estavel supera a propria prerelease de mesmo numero.
    const estavelVence = pickNewestRelease([{ tag_name: 'v3.0.0-beta005' }, { tag_name: 'v3.0.0' }]);
    if (estavelVence?.tag_name !== 'v3.0.0') {
      throw new Error(`Teste 10: estavel deveria vencer a beta, recebi ${estavelVence?.tag_name}`);
    }

    if (pickNewestRelease([]) !== null) {
      throw new Error('Teste 10: lista vazia deveria devolver null');
    }
    console.log('✔ Teste 10 passou: A release mais nova é escolhida por comparação, não pela ordem da API');

    // Teste 11: o buffer do Logger e o subscribe substituem o monkey patch que
    // o Server GUI fazia em Logger.log/warn/error para capturar os registros.
    Logger.clearBuffer();
    const capturados: LogEntry[] = [];
    const cancelar = Logger.subscribe((entry) => capturados.push(entry));

    Logger.info('INFO', 'mensagem de teste');
    Logger.warn('NETWORK', 'aviso de teste');
    Logger.error('DATABASE', 'erro de teste');

    if (capturados.length !== 3) {
      throw new Error(`Teste 11: esperava 3 entradas no subscribe, recebi ${capturados.length}`);
    }
    if (capturados.map((e) => e.level).join(',') !== 'INFO,WARN,ERROR') {
      throw new Error(`Teste 11: níveis errados: ${capturados.map((e) => e.level).join(',')}`);
    }
    if (capturados[1].category !== 'NETWORK') {
      throw new Error(`Teste 11: categoria errada: ${capturados[1].category}`);
    }

    // Um listener que explode nao pode derrubar o servidor nem impedir os demais.
    const depoisDoQuebrado: LogEntry[] = [];
    const cancelarQuebrado = Logger.subscribe(() => {
      throw new Error('listener quebrado');
    });
    const cancelarSadio = Logger.subscribe((entry) => depoisDoQuebrado.push(entry));
    Logger.info('INFO', 'apesar do listener quebrado');
    if (depoisDoQuebrado.length !== 1) {
      throw new Error('Teste 11: um listener com erro impediu a notificação dos outros');
    }
    cancelarQuebrado();
    cancelarSadio();

    // Cancelar precisa realmente remover a inscricao.
    cancelar();
    const antesDoCancelamento = capturados.length;
    Logger.info('INFO', 'depois de cancelar');
    if (capturados.length !== antesDoCancelamento) {
      throw new Error('Teste 11: o unsubscribe não removeu o listener');
    }

    // O buffer e limitado: um servidor longo nao pode crescer sem limite.
    Logger.clearBuffer();
    for (let i = 0; i < LIMITS.LOG_BUFFER_SIZE + 25; i++) {
      Logger.info('INFO', `entrada ${i}`);
    }
    const buffer = Logger.getRecent();
    if (buffer.length !== LIMITS.LOG_BUFFER_SIZE) {
      throw new Error(`Teste 11: buffer deveria ter ${LIMITS.LOG_BUFFER_SIZE} entradas, tem ${buffer.length}`);
    }
    if (!buffer[buffer.length - 1].message.includes(`entrada ${LIMITS.LOG_BUFFER_SIZE + 24}`)) {
      throw new Error('Teste 11: o buffer deveria manter as entradas mais recentes');
    }
    if (!buffer[0].message.includes('entrada 25')) {
      throw new Error(`Teste 11: as entradas mais antigas deveriam sair primeiro, achei "${buffer[0].message}"`);
    }

    // getRecent devolve uma copia: mexer no retorno nao pode corromper o buffer.
    buffer.length = 0;
    if (Logger.getRecent().length !== LIMITS.LOG_BUFFER_SIZE) {
      throw new Error('Teste 11: getRecent() expôs o buffer interno');
    }

    Logger.clearBuffer();
    if (Logger.getRecent().length !== 0) {
      throw new Error('Teste 11: clearBuffer() não esvaziou o buffer');
    }
    console.log('✔ Teste 11 passou: Buffer e assinaturas do Logger substituem o monkey patch do Server GUI');

    // Teste 12: metricas do servidor expostas sem alcancar internas por cast,
    // que era exatamente como o Server GUI quebrava em silencio.
    const stats = await server.getStats();
    if (stats.port !== 3999) {
      throw new Error(`Teste 12: esperava porta 3999, recebi ${stats.port}`);
    }
    if (stats.startedAt === null || stats.uptimeMs <= 0) {
      throw new Error('Teste 12: servidor em execução deveria ter startedAt e uptime positivos');
    }
    if (stats.channels < 2) {
      throw new Error(`Teste 12: esperava ao menos 2 canais (texto e voz), recebi ${stats.channels}`);
    }
    if (stats.members < 1) {
      throw new Error(`Teste 12: esperava ao menos 1 membro registrado, recebi ${stats.members}`);
    }
    if (stats.messages < 1) {
      throw new Error(`Teste 12: o Teste 4 enviou uma mensagem, então esperava ao menos 1, recebi ${stats.messages}`);
    }
    if (stats.maxUsers > 0 && stats.members > stats.maxUsers) {
      throw new Error('Teste 12: membros registrados não podem passar do limite do servidor');
    }
    console.log('✔ Teste 12 passou: Métricas do servidor expostas por API pública (uptime, membros, canais, mensagens)');

    // Teste 13: o registro de servidores e o que permite mais de um servidor
    // por maquina. Antes o nome do processo PM2 era fixo, entao iniciar um
    // segundo servidor dizia "ja esta em execucao" e parar qualquer um parava
    // o outro.
    const registryHome = path.join(testDataDir, 'monky-home');
    const previousHome = process.env.MONKY_HOME;
    process.env.MONKY_HOME = registryHome;
    try {
      const serverA = path.join(testDataDir, 'srv-a');
      const serverB = path.join(testDataDir, 'srv-b');
      for (const dir of [serverA, serverB]) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'server.db'), '');
      }

      if (serverIdFor(serverA) === serverIdFor(serverB)) {
        throw new Error('Teste 13: pastas diferentes deveriam gerar ids diferentes');
      }
      if (serverIdFor(serverA) !== serverIdFor(path.join(serverA, '.'))) {
        throw new Error('Teste 13: o mesmo caminho deveria gerar o mesmo id');
      }

      registerServer(serverA, { name: 'Servidor A', port: 3000 });
      registerServer(serverB, { name: 'Servidor B', port: 3001 });

      const registered = listServers();
      if (registered.length !== 2) {
        throw new Error(`Teste 13: esperava 2 servidores registrados, recebi ${registered.length}`);
      }
      if (registered[0].name !== 'Servidor A' || registered[1].port !== 3001) {
        throw new Error('Teste 13: os dados registrados não foram preservados');
      }

      registerServer(serverA, { port: 3010 });
      const afterUpdate = listServers();
      if (afterUpdate.length !== 2) {
        throw new Error('Teste 13: registrar de novo deveria atualizar, não duplicar');
      }
      if (afterUpdate[0].port !== 3010 || afterUpdate[0].name !== 'Servidor A') {
        throw new Error('Teste 13: atualizar a porta não deveria apagar o nome');
      }

      // Uma pasta apagada por fora nao pode continuar aparecendo na lista.
      fs.rmSync(serverB, { recursive: true, force: true });
      const afterPrune = listServers();
      if (afterPrune.length !== 1 || afterPrune[0].name !== 'Servidor A') {
        throw new Error('Teste 13: servidores sem banco deveriam sair da lista');
      }

      unregisterServer(serverA);
      if (listServers().length !== 0) {
        throw new Error('Teste 13: unregisterServer não removeu o servidor');
      }

      // O nome do processo PM2 e a chave de tudo: precisa variar por pasta e
      // aparecer no ecosystem gerado.
      const nameA = getPm2ProcessName(serverA);
      const nameB = getPm2ProcessName(serverB);
      if (nameA === nameB) {
        throw new Error('Teste 13: servidores diferentes deveriam ter processos PM2 diferentes');
      }
      const ecosystem = generateEcosystem({ dataDir: serverA, port: 3010, serverName: 'Servidor "A"' });
      if (!ecosystem.includes(`name: '${nameA}'`)) {
        throw new Error('Teste 13: o ecosystem deveria usar o nome de processo derivado da pasta');
      }
      if (!ecosystem.includes('--port 3010')) {
        throw new Error('Teste 13: o ecosystem deveria conter a porta informada');
      }
      if (!ecosystem.includes('\\"A\\"')) {
        throw new Error('Teste 13: aspas no nome do servidor deveriam ser escapadas');
      }
    } finally {
      if (previousHome === undefined) {
        delete process.env.MONKY_HOME;
      } else {
        process.env.MONKY_HOME = previousHome;
      }
    }
    console.log('✔ Teste 13 passou: Registro de servidores e processo PM2 por pasta permitem múltiplos servidores');

    // Teste 14: parseOption engolia a flag seguinte como se fosse valor, entao
    // "monky start --port --name x" iniciava com a porta "--name".
    if (parseOption(['--port', '3000'], '--port') !== '3000') {
      throw new Error('Teste 14: valor normal deveria ser lido');
    }
    if (parseOption(['--no-follow'], '--level') !== undefined) {
      throw new Error('Teste 14: opção ausente deveria devolver undefined');
    }
    let rejeitouFlag = false;
    try {
      parseOption(['--port', '--name', 'x'], '--port');
    } catch {
      rejeitouFlag = true;
    }
    if (!rejeitouFlag) {
      throw new Error('Teste 14: uma flag no lugar do valor deveria ser rejeitada');
    }
    let rejeitouVazio = false;
    try {
      parseOption(['--level'], '--level');
    } catch {
      rejeitouVazio = true;
    }
    if (!rejeitouVazio) {
      throw new Error('Teste 14: opção sem valor deveria ser rejeitada');
    }
    console.log('✔ Teste 14 passou: parseOption rejeita flag ou vazio no lugar do valor');

    // Teste 15: uma versão de protocolo diferente caía no schema e voltava como
    // BAD_REQUEST, então o cliente mostrava "requisição inválida" para o que na
    // verdade é "um dos dois lados está desatualizado" (#355).
    const wsVersao = new WebSocket('ws://127.0.0.1:3999');
    const erroVersao = await authenticateSocket(wsVersao, 'req-versao', 'UserVersao', 'senha-secreta-123', {
      protocolVersion: PROTOCOL_VERSION + 1,
      expectErrorCode: ProtocolErrorCode.PROTOCOL_VERSION_UNSUPPORTED,
    });
    if (erroVersao.payload.serverProtocolVersion !== PROTOCOL_VERSION) {
      throw new Error('Teste 15: o servidor deveria informar a própria versão de protocolo');
    }
    wsVersao.close();
    console.log('✔ Teste 15 passou: Versão de protocolo incompatível responde PROTOCOL_VERSION_UNSUPPORTED');

    // Teste 16: USE_SOUNDBOARD passou a ser exigida para tocar sons (#359). Antes
    // dela a soundboard só dependia do interruptor do servidor, então ela precisa
    // continuar ligada por padrão — caso contrário membros comuns perderiam o
    // recurso silenciosamente ao atualizar.
    if (!hasPermission(DEFAULT_PERMISSIONS, Permission.USE_SOUNDBOARD)) {
      throw new Error('Teste 16: membros sem cargo deveriam continuar podendo usar a soundboard');
    }
    if (!hasPermission(ADMIN_PERMISSIONS, Permission.USE_SOUNDBOARD)) {
      throw new Error('Teste 16: administradores deveriam poder usar a soundboard');
    }
    const semSoundboard = (DEFAULT_PERMISSIONS & ~Permission.USE_SOUNDBOARD) >>> 0;
    if (hasPermission(semSoundboard, Permission.USE_SOUNDBOARD)) {
      throw new Error('Teste 16: um cargo sem a permissão não deveria poder usar a soundboard');
    }
    console.log('✔ Teste 16 passou: USE_SOUNDBOARD é exigida sem tirar a soundboard de quem já tinha');

    // Teste 17: o limite de membros passou a contar quem está cadastrado, e não
    // quem está online (#403). Três coisas precisam valer ao mesmo tempo: o
    // limite barra gente nova, quem já é membro nunca é barrado (senão o
    // servidor tranca os próprios membros do lado de fora ao encher), e o
    // limite pode simplesmente não existir.
    const limiteDir = path.join(testDataDir, 'limite');
    const limiteServer = await MonkyServer.create({
      port: 3998,
      dataDir: limiteDir,
      serverName: 'Servidor com Limite',
      password: 'senha-limite',
      maxUsers: 2,
    });
    await limiteServer.start();

    try {
      const identidadeA = createIdentity();
      const wsLimiteA = new WebSocket('ws://127.0.0.1:3998');
      await authenticateSocket(wsLimiteA, 'req-limite-a', 'LimiteA', 'senha-limite', {
        identity: identidadeA,
        deviceId: 'device-a1',
      });

      const wsLimiteB = new WebSocket('ws://127.0.0.1:3998');
      await authenticateSocket(wsLimiteB, 'req-limite-b', 'LimiteB', 'senha-limite');

      // Os dois saem: é aqui que a regra nova se separa da antiga. Antes o
      // limite contava quem estava online, então desconectar liberaria a vaga;
      // agora conta quem está cadastrado, e sair não devolve nada.
      wsLimiteA.close();
      wsLimiteB.close();
      await new Promise((resolve) => setTimeout(resolve, 200));

      const wsLimiteC = new WebSocket('ws://127.0.0.1:3998');
      await authenticateSocket(wsLimiteC, 'req-limite-c', 'LimiteC', 'senha-limite', {
        expectErrorCode: ProtocolErrorCode.SERVER_FULL,
      });
      wsLimiteC.close();

      // O primeiro membro volta com o servidor lotado: precisa entrar, porque
      // já tem cadastro e não ocupa uma vaga nova.
      const wsLimiteA2 = new WebSocket('ws://127.0.0.1:3998');
      const authLimiteA2 = await authenticateSocket(wsLimiteA2, 'req-limite-a2', 'LimiteA', 'senha-limite', {
        identity: identidadeA,
        deviceId: 'device-a2',
      });
      if (!authLimiteA2.payload?.currentUser) {
        throw new Error('Teste 17: um membro já cadastrado deveria entrar mesmo com o servidor cheio');
      }
      if (authLimiteA2.payload.server?.maxUsers !== 2) {
        throw new Error('Teste 17: o cliente precisa receber o limite configurado para exibi-lo');
      }

      const statsLimite = await limiteServer.getStats();
      if (statsLimite.members !== 2) {
        throw new Error(`Teste 17: esperava 2 membros cadastrados, recebi ${statsLimite.members}`);
      }

      wsLimiteA2.close();
    } finally {
      await limiteServer.stop();
    }

    const semLimiteDir = path.join(testDataDir, 'sem-limite');
    const semLimiteServer = await MonkyServer.create({
      port: 3997,
      dataDir: semLimiteDir,
      serverName: 'Servidor sem Limite',
      password: 'senha-sem-limite',
      maxUsers: LIMITS.MAX_USERS_UNLIMITED,
    });
    await semLimiteServer.start();

    try {
      const sockets: WebSocket[] = [];
      for (let i = 1; i <= 3; i++) {
        const ws = new WebSocket('ws://127.0.0.1:3997');
        await authenticateSocket(ws, `req-sem-limite-${i}`, `SemLimite${i}`, 'senha-sem-limite');
        sockets.push(ws);
      }
      const statsSemLimite = await semLimiteServer.getStats();
      if (statsSemLimite.maxUsers !== LIMITS.MAX_USERS_UNLIMITED) {
        throw new Error('Teste 17: um servidor sem limite não pode ganhar um limite padrão pelo caminho');
      }
      if (statsSemLimite.members !== 3) {
        throw new Error(`Teste 17: esperava 3 membros sem limite, recebi ${statsSemLimite.members}`);
      }
      sockets.forEach((ws) => ws.close());
    } finally {
      await semLimiteServer.stop();
    }
    console.log('✔ Teste 17 passou: Limite conta membros cadastrados, poupa quem já entrou e pode ser desligado');

    // Teste 18: o servidor passou a ditar os servidores ICE que o cliente usa
    // (#425). Duas garantias importam aqui. A primeira é que o STUN sempre vai
    // junto, com ou sem relay: se o AUTH_SUCCESS chegasse sem nada, o cliente
    // cairia na lista embutida dele e a configuração do servidor viraria
    // decoração. A segunda é que credencial de TURN não vaza para um servidor
    // com o relay desligado.
    const turnDir = path.join(testDataDir, 'turn');
    const turnServer = await MonkyServer.create({
      port: 3996,
      dataDir: turnDir,
      serverName: 'Servidor TURN',
      password: 'senha-turn',
    });
    await turnServer.start();

    try {
      const wsTurn = new WebSocket('ws://127.0.0.1:3996');
      const authTurn = await authenticateSocket(wsTurn, 'req-turn-1', 'TurnUser', 'senha-turn');

      const iceServers = authTurn.payload?.iceServers;
      if (!Array.isArray(iceServers) || iceServers.length === 0) {
        throw new Error('Teste 18: o AUTH_SUCCESS precisa trazer a lista de servidores ICE');
      }

      const urls = iceServers.flatMap((entry: { urls: string[] }) => entry.urls);
      if (!urls.some((url: string) => url.startsWith('stun:'))) {
        throw new Error('Teste 18: a lista de servidores ICE precisa incluir STUN');
      }
      if (urls.some((url: string) => url.startsWith('turn:'))) {
        throw new Error('Teste 18: um servidor com o relay desligado não pode anunciar TURN');
      }
      if (iceServers.some((entry: { credential?: string }) => entry.credential !== undefined)) {
        throw new Error('Teste 18: não devem existir credenciais sem relay ativo');
      }

      if (authTurn.payload?.server?.turnEnabled !== false) {
        throw new Error('Teste 18: o relay precisa nascer desligado');
      }

      // O cliente desabilita o toggle a partir daqui (#429). Se este campo
      // faltar, o cliente conclui que o servidor é antigo demais e esconde o
      // recurso — por isso ele tem que vir sempre, inclusive quando o host
      // suporta o relay.
      const availability = authTurn.payload?.server?.turnAvailability;
      if (!availability || typeof availability.supported !== 'boolean') {
        throw new Error('Teste 18: o AUTH_SUCCESS precisa informar a disponibilidade do relay');
      }
      if (!availability.supported && !availability.reason) {
        throw new Error('Teste 18: um relay indisponível precisa dizer o motivo');
      }
      if (availability.supported && availability.reason !== undefined) {
        throw new Error('Teste 18: um relay disponível não deve carregar motivo de indisponibilidade');
      }
      // Quando falta só o coturn, o cliente precisa saber se o servidor
      // consegue instalá-lo sozinho: é isso que decide entre habilitar o
      // toggle e mandar o operador rodar o script na mão (#431).
      if (availability.reason === 'not-installed' && typeof availability.autoInstallable !== 'boolean') {
        throw new Error('Teste 18: um coturn ausente precisa dizer se dá para instalar automaticamente');
      }

      // A instalação do coturn muda a resposta para "este host consegue
      // relayar?", e o cliente só tinha a resposta do login. Sem devolvê-la no
      // broadcast, a tela de configurações continuaria oferecendo instalar o
      // que já está instalado (#438).
      await withTimeout(new Promise<void>((resolve, reject) => {
        const handler = (data: RawData) => {
          const res = JSON.parse(data.toString());
          if (res.type !== MessageType.SERVER_SETTINGS_UPDATED) return;
          wsTurn.off('message', handler);
          const updated = res.payload?.turnAvailability;
          if (!updated || typeof updated.supported !== 'boolean') {
            reject(new Error('Teste 18: o SERVER_SETTINGS_UPDATED precisa devolver a disponibilidade do relay'));
            return;
          }
          resolve();
        };
        wsTurn.on('message', handler);
        // Sem `turnEnabled`: ligar o relay tentaria instalar o coturn, o que
        // depende do host e não cabe num teste automatizado.
        wsTurn.send(JSON.stringify({
          type: MessageType.SERVER_UPDATE_SETTINGS,
          requestId: 'req-turn-2',
          payload: { name: 'Servidor TURN' },
        } satisfies ProtocolMessage));
      }), 5000, 'Teste 18: disponibilidade do relay no broadcast de configurações');

      wsTurn.close();
    } finally {
      await turnServer.stop();
    }
    console.log('✔ Teste 18 passou: ICE servers chegam ao cliente, com STUN, sem vazar TURN quando desligado, e com a disponibilidade do relay');

    // Teste 19: verifyPassword recebia um hash truncado e chegava ao
    // timingSafeEqual com buffers de tamanhos diferentes, que lança exceção em
    // vez de responder "senha errada" (#372).
    const hashValido = PasswordService.hashPassword('senha-secreta-123');
    if (!(await PasswordService.verifyPassword('senha-secreta-123', hashValido))) {
      throw new Error('Teste 19: a senha correta deveria ser aceita');
    }
    if (await PasswordService.verifyPassword('senha-errada', hashValido)) {
      throw new Error('Teste 19: a senha errada deveria ser recusada');
    }
    const [saltValido, chaveValida] = hashValido.split(':');
    for (const hashQuebrado of ['', 'sem-separador', `${saltValido}:`, `${saltValido}:${chaveValida.slice(0, 20)}`]) {
      if (await PasswordService.verifyPassword('senha-secreta-123', hashQuebrado)) {
        throw new Error('Teste 19: um hash malformado não deveria autenticar ninguém');
      }
    }
    console.log('✔ Teste 19 passou: Hash malformado responde senha inválida em vez de lançar exceção');

    // Teste 20: a autenticação não passava pelo rate limiter, então a senha do
    // servidor podia ser testada indefinidamente — e cada tentativa custa uma
    // derivação scrypt (#372).
    const limitadorAuth = new RateLimiter();
    let aceitas = 0;
    for (let i = 0; i < LIMITS.RATE_LIMIT_MAX_AUTH_ATTEMPTS + 3; i++) {
      if (limitadorAuth.checkLimit('auth:198.51.100.7', LIMITS.RATE_LIMIT_MAX_AUTH_ATTEMPTS, LIMITS.RATE_LIMIT_AUTH_WINDOW_MS)) {
        aceitas++;
      }
    }
    if (aceitas !== LIMITS.RATE_LIMIT_MAX_AUTH_ATTEMPTS) {
      throw new Error(`Teste 20: o IP deveria parar em ${LIMITS.RATE_LIMIT_MAX_AUTH_ATTEMPTS} tentativas, parou em ${aceitas}`);
    }
    if (!limitadorAuth.checkLimit('auth:203.0.113.9', LIMITS.RATE_LIMIT_MAX_AUTH_ATTEMPTS, LIMITS.RATE_LIMIT_AUTH_WINDOW_MS)) {
      throw new Error('Teste 20: o limite de um IP não deveria bloquear outro');
    }
    limitadorAuth.dispose();
    console.log('✔ Teste 20 passou: Tentativas de autenticação são limitadas por IP');

    // Teste 21: sem maxPayload valia o padrão da lib ws, 100 MiB, que qualquer
    // cliente não autenticado podia mandar para o servidor bufferizar (#372).
    const maiorAvatarEmBase64 = Math.ceil(LIMITS.MAX_AVATAR_SIZE / 3) * 4;
    if (LIMITS.WS_MAX_PAYLOAD_BYTES <= maiorAvatarEmBase64) {
      throw new Error('Teste 21: o teto do frame precisa caber o maior avatar legítimo em base64');
    }
    if (LIMITS.WS_MAX_PAYLOAD_BYTES >= 100 * 1024 * 1024) {
      throw new Error('Teste 21: o teto do frame precisa ser menor que o padrão de 100 MiB da lib ws');
    }
    console.log('✔ Teste 21 passou: Frame de WebSocket tem teto acima do avatar legítimo e abaixo do padrão da lib');

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
