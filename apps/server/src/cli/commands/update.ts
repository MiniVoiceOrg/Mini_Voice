import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import { ANSI, color } from '../constants';
import {
  AUTO_UPDATE_CRON,
  ensurePm2,
  isPm2Available,
  PM2_PROCESS_NAME,
  UPDATER_PROCESS_NAME,
} from '../pm2';
import { confirm } from '../prompts';

export const GITHUB_RELEASES_URL = 'https://api.github.com/repos/MonkyOrg/Monky/releases/latest';

export function getRepoRoot(): string {
  // apps/server/dist/cli/commands/update.js -> 4 levels up is repo root
  const candidate = path.resolve(__dirname, '..', '..', '..', '..');
  if (fs.existsSync(path.join(candidate, 'package.json')) && fs.existsSync(path.join(candidate, '.git'))) {
    return candidate;
  }
  // Try 3 levels up if executed directly from src or dist
  const candidate3 = path.resolve(__dirname, '..', '..', '..');
  if (fs.existsSync(path.join(candidate3, 'package.json')) && fs.existsSync(path.join(candidate3, '.git'))) {
    return candidate3;
  }
  // Fallback: try to find via git
  try {
    const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', cwd: __dirname }).trim();
    return root;
  } catch {
    throw new Error('Não foi possível localizar a raiz do repositório Monky.');
  }
}

export function getLocalVersion(): string {
  const repoRoot = getRepoRoot();
  const pkgPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error('package.json não encontrado na raiz do repositório.');
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return pkg.version || '0.0.0';
}

export async function fetchLatestVersion(): Promise<{ version: string; url: string } | null> {
  try {
    const https = await import('https');
    return new Promise((resolve) => {
      const req = https.get(
        GITHUB_RELEASES_URL,
        {
          headers: { 'User-Agent': 'monky-cli', Accept: 'application/vnd.github.v3+json' },
        },
        (res) => {
          if (res.statusCode !== 200) {
            resolve(null);
            return;
          }
          let data = '';
          res.on('data', (chunk: string) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const release = JSON.parse(data);
              const version = (release.tag_name || '').replace(/^v/, '');
              resolve({ version, url: release.html_url || '' });
            } catch {
              resolve(null);
            }
          });
        }
      );
      req.on('error', () => resolve(null));
      req.setTimeout(10000, () => {
        req.destroy();
        resolve(null);
      });
    });
  } catch {
    return null;
  }
}

export function compareVersions(local: string, remote: string): number {
  const a = local.split(/[.-]/).map((s) => Number.parseInt(s, 10) || 0);
  const b = remote.split(/[.-]/).map((s) => Number.parseInt(s, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (b[i] || 0) - (a[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function checkForUpdate(): Promise<{ hasUpdate: boolean; local: string; remote: string; url: string }> {
  const local = getLocalVersion();
  console.log(color(`Versão local: ${local}`, ANSI.dim));
  console.log(color('Verificando atualizações no GitHub...', ANSI.dim));

  const latest = await fetchLatestVersion();
  if (!latest) {
    console.log(color('Não foi possível verificar atualizações (sem conexão ou limite de API).', ANSI.yellow));
    return { hasUpdate: false, local, remote: local, url: '' };
  }

  const hasUpdate = compareVersions(local, latest.version) > 0;
  if (hasUpdate) {
    console.log(color(`Nova versão disponível: ${latest.version}`, ANSI.green));
    if (latest.url) {
      console.log(`Release: ${latest.url}`);
    }
  } else {
    console.log(color('Você já está na versão mais recente.', ANSI.green));
  }

  return { hasUpdate, local, remote: latest.version, url: latest.url };
}

export async function performUpdate(): Promise<boolean> {
  const repoRoot = getRepoRoot();

  console.log(color('Atualizando servidor Monky...', ANSI.bold));
  console.log();

  // Step 1: git pull
  console.log(color('1/3 Baixando atualizações (git pull)...', ANSI.cyan));
  const pullResult = spawnSync('git', ['pull', '--ff-only'], { cwd: repoRoot, stdio: 'inherit', shell: true });
  if (pullResult.status !== 0) {
    console.log(color('Falha no git pull. Verifique se não há alterações locais.', ANSI.red));
    console.log(color('Dica: use "git stash" para guardar alterações antes de atualizar.', ANSI.dim));
    return false;
  }

  // Step 2: npm install
  console.log();
  console.log(color('2/3 Instalando dependências (npm install)...', ANSI.cyan));
  const installResult = spawnSync('npm', ['install'], { cwd: repoRoot, stdio: 'inherit', shell: true });
  if (installResult.status !== 0) {
    console.log(color('Falha no npm install.', ANSI.red));
    return false;
  }

  // Step 3: npm run build
  console.log();
  console.log(color('3/3 Compilando (npm run build)...', ANSI.cyan));
  const buildResult = spawnSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit', shell: true });
  if (buildResult.status !== 0) {
    console.log(color('Falha no build.', ANSI.red));
    return false;
  }

  console.log();
  console.log(color('Atualização concluída com sucesso!', ANSI.green));
  return true;
}

export async function updateCommand(args: string[]): Promise<void> {
  const checkOnly = args.includes('--check');

  const { hasUpdate } = await checkForUpdate();

  if (checkOnly) {
    return;
  }

  if (!hasUpdate) {
    const force = await confirm('Deseja forçar a atualização mesmo assim?', false);
    if (!force) return;
  }

  const accepted = await confirm('Deseja atualizar agora?', true);
  if (!accepted) {
    console.log(color('Atualização cancelada.', ANSI.yellow));
    return;
  }

  const success = await performUpdate();
  if (!success) return;

  // Restart server if running
  if (isPm2Available()) {
    const listResult = spawnSync('pm2', ['jlist'], { encoding: 'utf8', shell: true });
    if (listResult.status === 0) {
      try {
        const processes = JSON.parse(listResult.stdout);
        const running = processes.find((p: any) => p.name === PM2_PROCESS_NAME && p.pm2_env?.status === 'online');
        if (running) {
          const shouldRestart = await confirm('Servidor está rodando. Deseja reiniciar para aplicar a atualização?', true);
          if (shouldRestart) {
            spawnSync('pm2', ['restart', PM2_PROCESS_NAME], { stdio: 'inherit', shell: true });
            console.log(color('Servidor reiniciado com a nova versão.', ANSI.green));
          }
        }
      } catch { /* ignore */ }
    }
  }
}

export function getUpdaterScriptPath(dataDir: string): string {
  return path.join(dataDir, 'auto-update.sh');
}

export function generateUpdaterScript(repoRoot: string, _dataDir: string): string {
  return `#!/bin/bash
# Monky auto-updater — generated by monky CLI
cd "${repoRoot}"
CURRENT=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")
LATEST=$(curl -sf https://api.github.com/repos/MonkyOrg/Monky/releases/latest | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).tag_name.replace('v','')" 2>/dev/null || echo "$CURRENT")

if [ "$CURRENT" != "$LATEST" ]; then
  echo "[monky-updater] Nova versão $LATEST encontrada (atual: $CURRENT). Atualizando..."
  git pull --ff-only && npm install && npm run build
  if [ $? -eq 0 ]; then
    pm2 restart ${PM2_PROCESS_NAME} 2>/dev/null || true
    echo "[monky-updater] Atualizado para $LATEST e servidor reiniciado."
  else
    echo "[monky-updater] Falha na atualização."
  fi
else
  echo "[monky-updater] Versão $CURRENT está atualizada."
fi
`;
}

export async function enableAutoUpdate(dataDir: string): Promise<void> {
  ensurePm2();

  const repoRoot = getRepoRoot();
  const scriptPath = getUpdaterScriptPath(dataDir);

  await fs.promises.writeFile(scriptPath, generateUpdaterScript(repoRoot, dataDir), { mode: 0o755 });

  // Remove existing updater if any
  spawnSync('pm2', ['delete', UPDATER_PROCESS_NAME], { stdio: 'ignore', shell: true });

  // Register as PM2 cron
  const result = spawnSync('pm2', [
    'start', scriptPath,
    '--name', UPDATER_PROCESS_NAME,
    '--cron', AUTO_UPDATE_CRON,
    '--no-autorestart',
    '--interpreter', 'bash',
  ], { stdio: 'inherit', shell: true });

  if (result.status !== 0) {
    throw new Error('Falha ao registrar auto-update no PM2.');
  }

  spawnSync('pm2', ['save'], { stdio: 'ignore', shell: true });

  console.log(color('Auto-update habilitado!', ANSI.green));
  console.log(`Verificação diária às 4h da manhã.`);
  console.log(`Script: ${scriptPath}`);
  console.log(color('Use "monky config set autoUpdate false" para desabilitar.', ANSI.dim));
}

export async function disableAutoUpdate(): Promise<void> {
  if (!isPm2Available()) {
    console.log(color('PM2 não encontrado. Auto-update já está desabilitado.', ANSI.yellow));
    return;
  }

  spawnSync('pm2', ['delete', UPDATER_PROCESS_NAME], { stdio: 'ignore', shell: true });
  spawnSync('pm2', ['save'], { stdio: 'ignore', shell: true });
  console.log(color('Auto-update desabilitado.', ANSI.green));
}
