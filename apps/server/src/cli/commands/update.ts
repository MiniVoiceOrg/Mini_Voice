import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import { ANSI, color } from '../constants';
import { GlobalArgs } from '../context';
import {
  AUTO_UPDATE_CRON,
  ensurePm2,
  findPm2Process,
  getCliEntryPath,
  getUpdaterProcessName,
  isPm2Available,
  LEGACY_UPDATER_PROCESS_NAME,
} from '../pm2';
import { confirm } from '../prompts';import { restartServerCommand } from './serverLifecycle';

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

/**
 * Version stamped into the published CLI package.
 *
 * `pack-cli.js` writes the release version into the tarball's package.json, so
 * this is authoritative for the recommended install. The placeholder versions
 * checked out in the repository are ignored on purpose.
 */
function readPackagedVersion(): string | null {
  const candidatePkgs = [
    path.resolve(__dirname, '..', '..', 'package.json'),
    path.resolve(__dirname, '..', '..', '..', 'package.json'),
  ];
  for (const pkgFile of candidatePkgs) {
    if (!fs.existsSync(pkgFile)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      if (pkg.version && pkg.version !== '1.0.0' && pkg.version !== '0.0.0') {
        return pkg.version;
      }
    } catch {}
  }
  return null;
}

/**
 * Version of the checked-out repository, taken from the nearest tag.
 *
 * The repository never bumps `package.json` — releases exist only as tags — so
 * reading it here always returned `1.0.0` and made every check report an
 * update as available.
 */
function readGitVersion(repoRoot: string): string | null {
  try {
    const described = execSync('git describe --tags --abbrev=0', {
      encoding: 'utf8',
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    return described ? described.replace(/^v/, '') : null;
  } catch {
    return null;
  }
}

export function getLocalVersion(): string {
  const packaged = readPackagedVersion();
  if (packaged) return packaged;

  const repoRoot = getRepoRoot();
  if (repoRoot) {
    const fromGit = readGitVersion(repoRoot);
    if (fromGit) return fromGit;
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
  console.log(color('Atualizando Monky CLI...', ANSI.bold));
  console.log();

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

  console.log();
  console.log(color('Atualização concluída com sucesso!', ANSI.green));
  return true;
}

export async function updateCommand(globalArgs: GlobalArgs, args: string[]): Promise<void> {
  const checkOnly = args.includes('--check');
  const includeBeta = args.includes('--beta') || args.includes('-b');
  const assumeYes = args.includes('--yes') || args.includes('-y');

  const { hasUpdate, remote, tgzUrl, isPrerelease } = await checkForUpdate(includeBeta);

  if (checkOnly) {
    return;
  }

  if (!hasUpdate) {
    if (assumeYes) {
      return;
    }
    const force = await confirm('Deseja forçar a reinstalação/atualização mesmo assim?', false);
    if (!force) return;
  }

  const channelLabel = isPrerelease || includeBeta ? ' (Beta)' : '';
  if (!assumeYes) {
    const accepted = await confirm(`Deseja atualizar para a versão ${remote}${channelLabel} agora?`, true);
    if (!accepted) {
      console.log(color('Atualização cancelada.', ANSI.yellow));
      return;
    }
  }

  const success = await performUpdate({
    beta: includeBeta || isPrerelease,
    targetVersion: remote,
    tgzUrl,
  });
  if (!success) return;

  if (!isPm2Available()) return;

  // Restarting goes through the lifecycle command so the ecosystem file is
  // rewritten and the right server is picked when the machine hosts several.
  if (assumeYes) {
    await restartServerCommand(globalArgs);
    return;
  }

  const shouldRestart = await confirm('Deseja reiniciar o servidor para aplicar a atualização?', true);
  if (shouldRestart) {
    await restartServerCommand(globalArgs);
  }
}

export function getUpdaterScriptPath(dataDir: string): string {
  return path.join(dataDir, 'auto-update.cjs');
}

function getLegacyUpdaterScriptPath(dataDir: string): string {
  return path.join(dataDir, 'auto-update.sh');
}

/**
 * Auto-updater run by PM2 on a schedule.
 *
 * It shells out to the CLI itself instead of reimplementing the update, which
 * is what lets it work for tarball installs too — the previous bash script
 * hardcoded `git pull`, so it required a Git checkout and never ran on Windows.
 */
export function generateUpdaterScript(options: { dataDir: string; cliEntry: string; beta: boolean }): string {
  const args = [options.cliEntry, '--data', options.dataDir, 'update', '--yes'];
  if (options.beta) args.push('--beta');

  return `// Monky auto-updater — gerado pelo "monky config set autoUpdate true".
// Não edite: o arquivo é reescrito sempre que o auto-update é reabilitado.
const { spawnSync } = require('child_process');

const args = ${JSON.stringify(args, null, 2)};

console.log('[monky-updater] Verificando atualizações...');
const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
`;
}

/**
 * Whether PM2 has an updater registered for this server.
 */
export function isAutoUpdateEnabled(dataDir: string): boolean {
  if (!isPm2Available()) return false;
  return (
    findPm2Process(getUpdaterProcessName(dataDir)) !== null ||
    findPm2Process(LEGACY_UPDATER_PROCESS_NAME) !== null
  );
}

export async function enableAutoUpdate(dataDir: string): Promise<void> {
  ensurePm2();

  const scriptPath = getUpdaterScriptPath(dataDir);
  const beta = parseSemver(getLocalVersion()).isBeta;
  await fs.promises.writeFile(
    scriptPath,
    generateUpdaterScript({ dataDir, cliEntry: getCliEntryPath(), beta }),
    'utf8'
  );

  const legacyScript = getLegacyUpdaterScriptPath(dataDir);
  if (fs.existsSync(legacyScript)) {
    try {
      await fs.promises.unlink(legacyScript);
    } catch {}
  }

  const processName = getUpdaterProcessName(dataDir);
  for (const name of [processName, LEGACY_UPDATER_PROCESS_NAME]) {
    spawnSync('pm2', ['delete', name], { stdio: 'ignore', shell: true });
  }

  const result = spawnSync(
    'pm2',
    [
      'start',
      scriptPath,
      '--name',
      processName,
      '--cron',
      AUTO_UPDATE_CRON,
      '--no-autorestart',
      '--interpreter',
      'node',
    ],
    { stdio: 'inherit', shell: true }
  );

  if (result.status !== 0) {
    throw new Error('Falha ao registrar auto-update no PM2.');
  }

  spawnSync('pm2', ['save'], { stdio: 'ignore', shell: true });

  console.log(color('Auto-update habilitado!', ANSI.green));
  console.log(`Verificação diária às 4h da manhã.`);
  console.log(`Canal: ${beta ? 'beta (inclui prereleases)' : 'estável'}`);
  console.log(`Script: ${scriptPath}`);
  console.log(color('Use "monky config set autoUpdate false" para desabilitar.', ANSI.dim));
}

export async function disableAutoUpdate(dataDir: string): Promise<void> {
  if (!isPm2Available()) {
    console.log(color('PM2 não encontrado. Auto-update já está desabilitado.', ANSI.yellow));
    return;
  }

  for (const name of [getUpdaterProcessName(dataDir), LEGACY_UPDATER_PROCESS_NAME]) {
    spawnSync('pm2', ['delete', name], { stdio: 'ignore', shell: true });
  }
  spawnSync('pm2', ['save'], { stdio: 'ignore', shell: true });
  console.log(color('Auto-update desabilitado.', ANSI.green));
}
