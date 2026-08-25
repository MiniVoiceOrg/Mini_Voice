import path from 'path';
import { LIMITS } from '@monky/shared';
import { MonkyServer, ServerConfig } from './server';
import { Logger } from './infrastructure/logger/Logger';

function parseArgs(): ServerConfig {
  const args = process.argv.slice(2);
  const config: ServerConfig = {
    port: LIMITS.DEFAULT_PORT,
    dataDir: path.join(process.cwd(), 'data'),
    serverName: 'Servidor dos Amigos',
    password: '',
    maxUsers: LIMITS.MAX_USERS_DEFAULT,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' && args[i + 1]) {
      config.port = parseInt(args[++i], 10);
    } else if (arg === '--data' && args[i + 1]) {
      config.dataDir = path.resolve(args[++i]);
    } else if (arg === '--name' && args[i + 1]) {
      config.serverName = args[++i];
    } else if (arg === '--password' && args[i + 1]) {
      config.password = args[++i];
    } else if (arg === '--max-users' && args[i + 1]) {
      config.maxUsers = parseInt(args[++i], 10);
    } else if (arg === '--voice-channel' && args[i + 1]) {
      config.initialVoiceChannel = args[++i];
    } else if (arg === '--text-channel' && args[i + 1]) {
      config.initialTextChannel = args[++i];
    }
  }

  return config;
}

async function main() {
  const config = parseArgs();
  const server = await MonkyServer.create(config);

  process.on('SIGINT', async () => {
    Logger.info('INFO', 'Received SIGINT, shutting down server...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    Logger.info('INFO', 'Received SIGTERM, shutting down server...');
    await server.stop();
    process.exit(0);
  });

  await server.start();
}

if (require.main === module) {
  main().catch((err) => {
    Logger.error('ERROR', 'Fatal server crash', err);
    process.exit(1);
  });
}

export { MonkyServer, ServerConfig };
