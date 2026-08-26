import { Permission } from '@monky/shared';
import { ANSI, color, PERMISSION_OPTIONS } from './constants';

export function parseOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
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
