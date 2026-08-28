import fs from 'fs';
import { spawnSync } from 'child_process';
import { ANSI, color } from '../constants';
import { GlobalArgs } from '../context';
import {
  findLegacyProcessFor,
  getPm2ProcessName,
  getUpdaterProcessName,
  isPm2Available,
  LEGACY_PM2_PROCESS_NAME,
} from '../pm2';
import { unregisterServer } from '../registry';
import { resolveTargetServer } from '../target';
import { ask, confirm } from '../prompts';
import { countOnlineUsers, resolveServerPort } from '../onlineUsers';

export async function destroyCommand(globalArgs: GlobalArgs): Promise<void> {
  // resolveTargetServer only returns directories that actually hold a Monky
  // database, which keeps this "rm -rf" from ever pointing at an arbitrary
  // folder someone typed by mistake.
  const target = await resolveTargetServer(globalArgs, 'destruir');
  const dataDir = target.dataDir;

  console.log(color('⚠️  ATENÇÃO: Esta ação é IRREVERSÍVEL!', ANSI.red));
  console.log(color(`Todos os dados do servidor em "${dataDir}" serão apagados:`, ANSI.red));
  console.log(`  - Banco de dados (mensagens, membros, cargos)`);
  console.log(`  - Arquivos anexados`);
  console.log(`  - Avatares`);
  console.log(`  - Configurações`);
  console.log();

  // Warn about live sessions before the typed confirmation, so the owner knows
  // what is at stake while deciding (#334).
  const onlineUsers = await countOnlineUsers(resolveServerPort(target));
  if (onlineUsers !== null && onlineUsers > 0) {
    const people = onlineUsers === 1 ? '1 pessoa conectada' : `${onlineUsers} pessoas conectadas`;
    console.log(color(`Há ${people} neste servidor agora — todas serão desconectadas.`, ANSI.yellow));
    console.log();
  }

  const confirmText = await ask(`Digite "DESTROY" para confirmar`);
  if (confirmText !== 'DESTROY') {
    console.log(color('Operação cancelada.', ANSI.yellow));
    return;
  }

  const doubleConfirm = await confirm('Tem certeza absoluta? Isso não pode ser desfeito.', false);
  if (!doubleConfirm) {
    console.log(color('Operação cancelada.', ANSI.yellow));
    return;
  }

  if (isPm2Available()) {
    const names = [getPm2ProcessName(dataDir), getUpdaterProcessName(dataDir)];
    // The pre-registry process is only removed when it belongs to this data
    // directory — another server could be the one still using the old name.
    if (findLegacyProcessFor(dataDir)) {
      names.push(LEGACY_PM2_PROCESS_NAME);
    }
    for (const name of names) {
      spawnSync('pm2', ['delete', name], { stdio: 'ignore', shell: true });
    }
    spawnSync('pm2', ['save'], { stdio: 'ignore', shell: true });
  }

  await fs.promises.rm(dataDir, { recursive: true, force: true });
  unregisterServer(dataDir);

  console.log(color('Servidor destruído com sucesso. Todos os dados foram apagados.', ANSI.green));
}
