import { LIMITS, Permission } from '@monky/shared';
import { ANSI, color, PERMISSION_OPTIONS } from './constants';
import { t } from './i18n/index';
import type { SfuPortProblem } from '../infrastructure/sfu/SfuManager';
import {
  SFU_MIN_NODE_MAJOR,
  SfuPreflightIssue,
  SfuPreflightResult,
} from '../infrastructure/sfu/SfuPreflight';

/**
 * Translated counterpart of the server-side `describeSfuPortProblem`.
 *
 * The manager reports a structured problem precisely so the operator reads it
 * in their own language instead of the Portuguese string the server sends to
 * the desktop client (#515).
 */
export function describeSfuPortProblem(problem: SfuPortProblem): string {
  if (problem.code === 'turn-overlap') {
    return t('sfu.portOverlap', {
      minPort: String(problem.minPort),
      maxPort: String(problem.maxPort),
      turnMinPort: String(problem.turnMinPort),
      turnMaxPort: String(problem.turnMaxPort),
    });
  }
  return t('sfu.portBindFailed', {
    port: String(problem.port),
    minPort: String(problem.minPort),
    maxPort: String(problem.maxPort),
  });
}

/**
 * Value of a `--flag value` pair.
 *
 * A value that looks like another flag is rejected instead of accepted, so
 * `monky start --port --name x` fails clearly rather than parsing `--name` as
 * the port.
 */
export function parseOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined) {
    throw new Error(`Informe um valor após ${name}.`);
  }
  if (value.startsWith('--')) {
    throw new Error(`Informe um valor após ${name} (recebido: ${value}).`);
  }
  return value;
}

export function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'sim', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'nao', 'não', 'off'].includes(normalized)) return false;
  throw new Error(`Valor booleano inválido: ${value}`);
}

export function parsePositiveInt(key: string, value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Valor inválido para ${key}: ${value}`);
  }
  return parsed;
}

/**
 * Parses the membership cap, where 0 means "no limit" (#403).
 *
 * Kept apart from `parsePositiveInt` because 0 is a legitimate value here and
 * an error everywhere else.
 */
export function parseMemberLimit(key: string, value: string): number {
  const normalized = value.trim().toLowerCase();
  if (normalized === '' || normalized === '0' || normalized === 'ilimitado' || normalized === 'unlimited') {
    return LIMITS.MAX_USERS_UNLIMITED;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Valor inválido para ${key}: ${value} (use 0 para sem limite).`);
  }
  return parsed;
}

export function formatDate(timestamp?: number | null): string {
  if (!timestamp) return '-';
  return new Date(timestamp).toISOString();
}

export function formatBool(value: boolean): string {
  return value ? color('true', ANSI.green) : color('false', ANSI.yellow);
}

export function pad(value: string, size: number): string {
  return value.length >= size ? value : value.padEnd(size, ' ');
}

export function permissionLabel(name: keyof typeof Permission): string {
  return name
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

export function encodePermissions(names: string[]): number {
  let permissions = 0;
  for (const selected of names) {
    const option = PERMISSION_OPTIONS.find((entry) => permissionLabel(entry.name) === selected || entry.name === selected);
    if (option) {
      permissions |= option.value;
    }
  }
  return permissions;
}

export function parsePermissionNames(input: string): string[] {
  if (!input.trim()) return [];
  const selected = new Set<string>();
  for (const token of input.split(',').map((item) => item.trim()).filter(Boolean)) {
    const byEnum = PERMISSION_OPTIONS.find((entry) => entry.name.toLowerCase() === token.toLowerCase());
    if (byEnum) {
      selected.add(permissionLabel(byEnum.name));
      continue;
    }

    const byLabel = PERMISSION_OPTIONS.find((entry) => permissionLabel(entry.name).toLowerCase() === token.toLowerCase());
    if (byLabel) {
      selected.add(permissionLabel(byLabel.name));
      continue;
    }

    throw new Error(`Permissão inválida: ${token}`);
  }
  return [...selected];
}

export function normalizeRoleColor(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^#?[0-9a-fA-F]{6}$/.test(trimmed)) {
    throw new Error('Cor inválida. Use formato #RRGGBB.');
  }
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

export function printVoiceModeComparisonTable(): void {
  const rows = [
    { data: '🎤 Áudio (voz)', p2p: 'Direto entre peers', sfu: 'Passa pelo servidor' },
    { data: '📹 Vídeo (câmera)', p2p: 'Direto entre peers', sfu: 'Passa pelo servidor' },
    { data: '🖥️ Compartilhamento de tela', p2p: 'Direto entre peers', sfu: 'Passa pelo servidor' },
    { data: '💬 Mensagens de chat', p2p: 'Passa pelo servidor', sfu: 'Passa pelo servidor' },
    { data: '📎 Arquivos e anexos', p2p: 'Armazenados no servidor', sfu: 'Armazenados no servidor' },
    { data: '🔗 Sinalização WebRTC', p2p: 'Passa pelo servidor', sfu: 'Passa pelo servidor' },
    { data: '👤 Perfis e avatares', p2p: 'Armazenados no servidor', sfu: 'Armazenados no servidor' },
    { data: '⚙️ Canais, cargos, configurações', p2p: 'Armazenados no servidor', sfu: 'Armazenados no servidor' },
    { data: '🟢 Status e presença', p2p: 'Passa pelo servidor', sfu: 'Passa pelo servidor' },
  ];

  console.log();
  console.log(color('┌───────────────────────────────────────┬─────────────────────────┬─────────────────────────┐', ANSI.dim));
  console.log(color('│ Dado                                  │ P2P Mesh                │ SFU                     │', ANSI.bold));
  console.log(color('├───────────────────────────────────────┼─────────────────────────┼─────────────────────────┤', ANSI.dim));
  for (const r of rows) {
    const d = pad(r.data, 37);
    const p = pad(r.p2p, 23);
    const s = pad(r.sfu, 23);
    console.log(`│ ${d} │ ${p} │ ${s} │`);
  }
  console.log(color('└───────────────────────────────────────┴─────────────────────────┴─────────────────────────┘', ANSI.dim));
}

/** Problem and matching fix for a preflight issue, in the CLI language. */
function describeSfuIssue(issue: SfuPreflightIssue): { problem: string; hint: string } {
  switch (issue.code) {
    case 'node-version':
      return {
        problem: t('sfu.preflightNodeVersion', {
          found: issue.found ?? '?',
          required: SFU_MIN_NODE_MAJOR,
        }),
        hint: t('sfu.preflightHintNode', { required: SFU_MIN_NODE_MAJOR }),
      };
    case 'worker-missing':
      return {
        problem: t('sfu.preflightWorkerMissing', { path: issue.workerPath ?? '?' }),
        hint: t('sfu.preflightHintWorker'),
      };
    case 'mediasoup-unresolved':
    default:
      return {
        problem: t('sfu.preflightMediasoupUnresolved'),
        hint: t('sfu.preflightHintReinstall'),
      };
  }
}

/**
 * Reports an environment that cannot run the SFU, at the moment the mode is
 * picked.
 *
 * `SfuManager` falls back to P2P rather than refusing to start, so without
 * this the operator only notices when calls quietly degrade.
 */
export function printSfuPreflight(result: SfuPreflightResult): void {
  if (result.ok) return;

  console.log();
  console.log(color(t('sfu.preflightTitle'), ANSI.bold));
  for (const issue of result.issues) {
    const { problem, hint } = describeSfuIssue(issue);
    console.log(color(`  ✖ ${problem}`, ANSI.red));
    console.log(color(`    → ${hint}`, ANSI.dim));
  }
  console.log(color(t('sfu.preflightConsequence'), ANSI.yellow));
}

/** One-line reason for listings, or an empty string when the SFU can run. */
export function sfuPreflightSummary(result: SfuPreflightResult): string {
  if (result.ok) return '';
  return result.issues.map((issue) => describeSfuIssue(issue).problem).join(' ');
}
