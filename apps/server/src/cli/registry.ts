import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SERVER_DB_NAME } from './constants';

/**
 * Registry of every Monky server created on this machine.
 *
 * The CLI is installed globally, so it cannot assume the server lives in the
 * current working directory. Each server is identified by its data directory,
 * and the PM2 process name is derived from it — that is what allows more than
 * one server per machine.
 */
export interface RegisteredServer {
  id: string;
  dataDir: string;
  name?: string;
  port?: number;
  createdAt: number;
}

export const LEGACY_PM2_PROCESS_NAME = 'monky-server';

export function getRegistryDir(): string {
  return process.env.MONKY_HOME || path.join(os.homedir(), '.monky');
}

export function getRegistryPath(): string {
  return path.join(getRegistryDir(), 'servers.json');
}

export function canonicalDataDir(dataDir: string): string {
  return path.resolve(dataDir);
}

/**
 * Stable short id for a data directory.
 *
 * Windows paths are case-insensitive, so they are lowercased before hashing to
 * keep `C:\Srv` and `c:\srv` pointing at the same server.
 */
export function serverIdFor(dataDir: string): string {
  const canonical = canonicalDataDir(dataDir);
  const normalized = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  return crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 8);
}

export function hasServerDatabase(dataDir: string): boolean {
  return fs.existsSync(path.join(dataDir, SERVER_DB_NAME));
}

function readRegistryFile(): RegisteredServer[] {
  const registryPath = getRegistryPath();
  if (!fs.existsSync(registryPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    if (!Array.isArray(parsed?.servers)) return [];
    return parsed.servers.filter((entry: RegisteredServer) => entry && typeof entry.dataDir === 'string');
  } catch {
    return [];
  }
}

function writeRegistryFile(servers: RegisteredServer[]): void {
  const registryPath = getRegistryPath();
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify({ version: 1, servers }, null, 2), 'utf8');
}

export function registerServer(dataDir: string, details: { name?: string; port?: number } = {}): RegisteredServer {
  const canonical = canonicalDataDir(dataDir);
  const id = serverIdFor(canonical);
  const servers = readRegistryFile();
  const existing = servers.find((entry) => entry.id === id);

  if (existing) {
    existing.dataDir = canonical;
    if (details.name !== undefined) existing.name = details.name;
    if (details.port !== undefined) existing.port = details.port;
    writeRegistryFile(servers);
    return existing;
  }

  const created: RegisteredServer = {
    id,
    dataDir: canonical,
    name: details.name,
    port: details.port,
    createdAt: Date.now(),
  };
  servers.push(created);
  writeRegistryFile(servers);
  return created;
}

export function unregisterServer(dataDir: string): void {
  const id = serverIdFor(dataDir);
  const servers = readRegistryFile();
  const remaining = servers.filter((entry) => entry.id !== id);
  if (remaining.length !== servers.length) {
    writeRegistryFile(remaining);
  }
}

/**
 * Registers servers that exist on disk but are missing from the registry.
 *
 * Installations created before the registry existed, and data directories
 * copied between machines, would otherwise be invisible to the CLI.
 */
export function adoptServers(candidates: string[]): RegisteredServer[] {
  const adopted: RegisteredServer[] = [];
  for (const candidate of candidates) {
    if (!candidate || !hasServerDatabase(candidate)) continue;
    adopted.push(registerServer(candidate));
  }
  return adopted;
}

/**
 * Every known server, dropping entries whose data directory no longer exists.
 */
export function listServers(): RegisteredServer[] {
  const servers = readRegistryFile();
  const alive = servers.filter((entry) => hasServerDatabase(entry.dataDir));
  if (alive.length !== servers.length) {
    writeRegistryFile(alive);
  }
  return alive.sort((a, b) => a.createdAt - b.createdAt);
}

export function findServerByDataDir(dataDir: string): RegisteredServer | null {
  const id = serverIdFor(dataDir);
  return listServers().find((entry) => entry.id === id) ?? null;
}
