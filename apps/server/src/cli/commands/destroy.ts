import fs from 'fs';
import { spawnSync } from 'child_process';
import { ANSI, color, DEFAULT_DATA_INPUT } from '../constants';
import { GlobalArgs, resolveInputPath } from '../context';
import { isPm2Available, PM2_PROCESS_NAME, UPDATER_PROCESS_NAME } from '../pm2';
import { ask, confirm } from '../prompts';

export async function destroyCommand(globalArgs: GlobalArgs): Promise<void> {
  const dataDir = globalArgs.dataDirSpecified
    ? globalArgs.dataDir
    : resolveInputPath(await ask('Caminho dos dados do servidor a destruir', DEFAULT_DATA_INPUT));

  if (!fs.existsSync(dataDir)) {
    console.log(color(`Pasta não encontrada: ${dataDir}`, ANSI.yellow));
    return;
  }

  console.log(color('⚠️  ATENÇÃO: Esta ação é IRREVERSÍVEL!', ANSI.red));
  console.log(color(`Todos os dados do servidor em "${dataDir}" serão apagados:`, ANSI.red));
  console.log(`  - Banco de dados (mensagens, membros, cargos)`);
  console.log(`  - Arquivos anexados`);
  console.log(`  - Avatares`);
  console.log(`  - Configurações`);
  console.log();

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

  // Stop server if running
  if (isPm2Available()) {
    spawnSync('pm2', ['stop', PM2_PROCESS_NAME], { stdio: 'ignore', shell: true });
    spawnSync('pm2', ['delete', PM2_PROCESS_NAME], { stdio: 'ignore', shell: true });
    spawnSync('pm2', ['delete', UPDATER_PROCESS_NAME], { stdio: 'ignore', shell: true });
    spawnSync('pm2', ['save'], { stdio: 'ignore', shell: true });
  }

  // Delete data directory
  await fs.promises.rm(dataDir, { recursive: true, force: true });

  console.log(color('Servidor destruído com sucesso. Todos os dados foram apagados.', ANSI.green));
}
