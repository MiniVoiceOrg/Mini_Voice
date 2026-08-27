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

export const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/MonkyOrg/Monky/releases?per_page=100';
export const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/MonkyOrg/Monky/releases/latest';

export function getRepoRoot(): string | null {
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
    const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', cwd: __dirname, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (root && fs.existsSync(path.join(root, 'package.json'))) {
      return root;
    }
  } catch {
    // Not in a git repo (e.g. standalone global tarball install)
  }
  return null;
}

export function getLocalVersion(): string {
  // 1. Try from apps/server/package.json (bundled or installed standalone package)
  const candidatePkgs = [
    path.resolve(__dirname, '..', '..', 'package.json'),
    path.resolve(__dirname, '..', '..', '..', 'package.json'),
  ];
  for (const pkgFile of candidatePkgs) {
    if (fs.existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
        if (pkg.version && pkg.version !== '1.0.0' && pkg.version !== '0.0.0') {
          return pkg.version;
        }
      } catch {}
    }
  }

  // 2. Try from root package.json if in a git repo
  const repoRoot = getRepoRoot();
  if (repoRoot) {
    const pkgPath = path.join(repoRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return pkg.version || '0.0.0';
      } catch {}
    }
  }

  // 3. Fallback to package.json in server dir
  for (const pkgFile of candidatePkgs) {
    if (fs.existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
        if (pkg.version) return pkg.version;
      } catch {}
    }
  }

  return '0.0.0';
}

export async function fetchLatestVersion(
  includeBeta = false
): Promise<{ version: string; url: string; tgzUrl?: string; isPrerelease: boolean } | null> {
  const endpoint = includeBeta ? GITHUB_RELEASES_URL : GITHUB_LATEST_RELEASE_URL;

  try {
    const https = await import('https');
    return new Promise((resolve) => {
      const req = https.get(
        endpoint,
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
              const parsed = JSON.parse(data);
              const release = Array.isArray(parsed) ? pickNewestRelease(parsed) : parsed;
              if (!release) {
                resolve(null);
                return;
              }
              const version = (release.tag_name || '').replace(/^v/, '');
              const tgzAsset = (release.assets || []).find((a: any) =>
                a.name?.endsWith('.tgz') && a.name?.includes('monky-cli')
              );
              const tgzUrl =
                tgzAsset?.browser_download_url ||
                `https://github.com/MonkyOrg/Monky/releases/download/v${version}/monky-cli-${version}.tgz`;

              resolve({
                version,
                url: release.html_url || '',
                tgzUrl,
                isPrerelease: !!release.prerelease,
              });
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

export function parseSemver(v: string): {
  major: number;
  minor: number;
  patch: number;
  isBeta: boolean;
  betaNumber: number;
} {
  const clean = String(v || '').replace(/^v/, '').trim();
  const [main, prerelease] = clean.split('-');
  const [major = 0, minor = 0, patch = 0] = main.split('.').map((n) => Number.parseInt(n, 10) || 0);
  let betaNumber = 0;
  if (prerelease) {
    const match = /beta\.?(\d+)/i.exec(prerelease);
    betaNumber = match ? Number.parseInt(match[1], 10) : 0;
  }
  return { major, minor, patch, isBeta: prerelease != null, betaNumber };
}

export function compareVersions(local: string, remote: string): number {
  const a = parseSemver(local);
  const b = parseSemver(remote);

  if (a.major !== b.major) return b.major - a.major;
  if (a.minor !== b.minor) return b.minor - a.minor;
  if (a.patch !== b.patch) return b.patch - a.patch;

  // Same base major.minor.patch:
  // If one is beta and the other is stable, the stable release is strictly newer
  if (a.isBeta && !b.isBeta) return 1;
  if (!a.isBeta && b.isBeta) return -1;
  if (a.isBeta && b.isBeta) {
    return b.betaNumber - a.betaNumber;
  }
  return 0;
}

export interface GitHubReleaseSummary {
  tag_name?: string;
  html_url?: string;
  prerelease?: boolean;
  draft?: boolean;
  assets?: { name?: string; browser_download_url?: string }[];
}

/**
 * Picks the newest release from the GitHub listing.
 *
 * The `/releases` endpoint does not return the list in chronological order — it
 * orders by tag name, so `v2.4.0-beta.9` came back ahead of `v2.4.0-beta.15`.
 * Reading `parsed[0]` therefore offered an old build as if it were the latest,
 * while the desktop client, which compares every entry, resolved correctly. The
 * two now use the same strategy: compare, never trust the order.
 *
 * Drafts are skipped because they are visible to maintainers only and have no
 * downloadable assets.
 */
export function pickNewestRelease<T extends GitHubReleaseSummary>(releases: T[]): T | null {
  let newest: T | null = null;
  for (const release of releases || []) {
    if (!release || release.draft || !release.tag_name) continue;
    if (!newest || compareVersions(newest.tag_name as string, release.tag_name) > 0) {
      newest = release;
    }
  }
  return newest;
}

export async function checkForUpdate(
  includeBeta = false
): Promise<{ hasUpdate: boolean; local: string; remote: string; url: string; tgzUrl?: string; isPrerelease: boolean }> {
  const local = getLocalVersion();
  console.log(color(`Versão local: ${local}`, ANSI.dim));
  console.log(
    color(
      `Verificando atualizações no GitHub (${includeBeta ? 'Canal Beta/Prerelease' : 'Canal Estável'})...`,
      ANSI.dim
    )
  );

  const latest = await fetchLatestVersion(includeBeta);
  if (!latest) {
    console.log(color('Não foi possível verificar atualizações (sem conexão ou limite de API).', ANSI.yellow));
    return { hasUpdate: false, local, remote: local, url: '', isPrerelease: false };
  }

  const hasUpdate = compareVersions(local, latest.version) > 0;
  if (hasUpdate) {
    const tagDesc = latest.isPrerelease ? ' (Beta)' : '';
    console.log(color(`Nova versão disponível: ${latest.version}${tagDesc}`, ANSI.green));
    if (latest.url) {
      console.log(`Release: ${latest.url}`);
    }
  } else {
    console.log(color('Você já está na versão mais recente.', ANSI.green));
  }

  return {
    hasUpdate,
    local,
    remote: latest.version,
    url: latest.url,
    tgzUrl: latest.tgzUrl,
    isPrerelease: latest.isPrerelease,
  };
}

export async function performUpdate(
  options: { beta?: boolean; targetVersion?: string; tgzUrl?: string } = {}
): Promise<boolean> {
  const repoRoot = getRepoRoot();

  console.log(color('Atualizando servidor Monky...', ANSI.bold));
  console.log();

  if (repoRoot) {
    // Mode A: Git clone / monorepo installation
    console.log(color('Ambiente: Repositório Git local', ANSI.dim));
    console.log(color('1/3 Baixando atualizações...', ANSI.cyan));

    let pullResult;
    if (options.beta && options.targetVersion) {
      spawnSync('git', ['fetch', '--tags', 'origin'], { cwd: repoRoot, stdio: 'inherit', shell: true });
      pullResult = spawnSync('git', ['checkout', `v${options.targetVersion}`], {
        cwd: repoRoot,
        stdio: 'inherit',
        shell: true,
      });
    } else {
      pullResult = spawnSync('git', ['pull', '--ff-only'], { cwd: repoRoot, stdio: 'inherit', shell: true });
    }

    if (pullResult.status !== 0) {
      console.log(color('Falha ao baixar atualizações do Git. Verifique se não há alterações locais.', ANSI.red));
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

    // Step 3: Compilar APENAS o servidor e shared (evita compilar client / electron)
    console.log();
    console.log(color('3/3 Compilando servidor (npm run build:server)...', ANSI.cyan));
    let buildResult = spawnSync('npm', ['run', 'build:server'], { cwd: repoRoot, stdio: 'inherit', shell: true });
    if (buildResult.status !== 0) {
      // Fallback para clones sem o script build:server
      buildResult = spawnSync(
        'npm',
        ['run', 'build', '--workspace=packages/shared', '--workspace=apps/server'],
        { cwd: repoRoot, stdio: 'inherit', shell: true }
      );
      if (buildResult.status !== 0) {
        console.log(color('Falha no build do servidor.', ANSI.red));
        return false;
      }
    }
  } else {
    // Mode B: Standalone global tarball install (npm install -g ...)
    console.log(color('Ambiente: Pacote Monky CLI standalone', ANSI.dim));
    const tgzUrl =
      options.tgzUrl ||
      (options.targetVersion
        ? `https://github.com/MonkyOrg/Monky/releases/download/v${options.targetVersion}/monky-cli-${options.targetVersion}.tgz`
        : null);

    if (!tgzUrl) {
      console.log(color('URL do pacote da release não encontrada.', ANSI.red));
      return false;
    }

    console.log(color(`Instalando versão a partir de: ${tgzUrl}`, ANSI.cyan));
    const installResult = spawnSync('npm', ['install', '-g', tgzUrl], { stdio: 'inherit', shell: true });
    if (installResult.status !== 0) {
      console.log(color('Falha ao instalar pacote global do Monky CLI.', ANSI.red));
      return false;
    }
  }

  console.log();
  console.log(color('Atualização concluída com sucesso!', ANSI.green));
  return true;
}

export async function updateCommand(args: string[]): Promise<void> {
  const checkOnly = args.includes('--check');
  const includeBeta = args.includes('--beta') || args.includes('-b');

  const { hasUpdate, remote, tgzUrl, isPrerelease } = await checkForUpdate(includeBeta);

  if (checkOnly) {
    return;
  }

  if (!hasUpdate) {
    const force = await confirm('Deseja forçar a reinstalação/atualização mesmo assim?', false);
    if (!force) return;
  }

  const channelLabel = isPrerelease || includeBeta ? ' (Beta)' : '';
  const accepted = await confirm(`Deseja atualizar para a versão ${remote}${channelLabel} agora?`, true);
  if (!accepted) {
    console.log(color('Atualização cancelada.', ANSI.yellow));
    return;
  }

  const success = await performUpdate({
    beta: includeBeta || isPrerelease,
    targetVersion: remote,
    tgzUrl,
  });
  if (!success) return;

  // Restart server if running via PM2
  if (isPm2Available()) {
    const listResult = spawnSync('pm2', ['jlist'], { encoding: 'utf8', shell: true });
    if (listResult.status === 0) {
      try {
        const processes = JSON.parse(listResult.stdout);
        const running = processes.find(
          (p: any) => p.name === PM2_PROCESS_NAME && p.pm2_env?.status === 'online'
        );
        if (running) {
          const shouldRestart = await confirm(
            'Servidor está rodando via PM2. Deseja reiniciar para aplicar a atualização?',
            true
          );
          if (shouldRestart) {
            spawnSync('pm2', ['restart', PM2_PROCESS_NAME], { stdio: 'inherit', shell: true });
            console.log(color('Servidor reiniciado com a nova versão.', ANSI.green));
          }
        }
      } catch {
        /* ignore */
      }
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
  echo "[monky-updater] Nova versão $LATEST encontrada (atual: $CURRENT). Atualizando servidor..."
  git pull --ff-only && npm install && npm run build:server
  if [ $? -eq 0 ]; then
    pm2 restart ${PM2_PROCESS_NAME} 2>/dev/null || true
    echo "[monky-updater] Atualizado para $LATEST e servidor reiniciado."
  else
    echo "[monky-updater] Falha na atualização do servidor."
  fi
else
  echo "[monky-updater] Versão $CURRENT está atualizada."
fi
`;
}

export async function enableAutoUpdate(dataDir: string): Promise<void> {
  ensurePm2();

  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    throw new Error('Auto-update automático via PM2 requer instalação via repositório Git.');
  }

  const scriptPath = getUpdaterScriptPath(dataDir);
  await fs.promises.writeFile(scriptPath, generateUpdaterScript(repoRoot, dataDir), { mode: 0o755 });

  // Remove existing updater if any
  spawnSync('pm2', ['delete', UPDATER_PROCESS_NAME], { stdio: 'ignore', shell: true });

  // Register as PM2 cron
  const result = spawnSync(
    'pm2',
    [
      'start',
      scriptPath,
      '--name',
      UPDATER_PROCESS_NAME,
      '--cron',
      AUTO_UPDATE_CRON,
      '--no-autorestart',
      '--interpreter',
      'bash',
    ],
    { stdio: 'inherit', shell: true }
  );

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
