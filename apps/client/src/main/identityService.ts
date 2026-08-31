import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, generateKeyPairSync, pbkdf2Sync, randomBytes, sign } from 'crypto';
import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import { deriveClientIdFromPublicKey, normalizePublicKeyHex } from '@monky/shared';

const IDENTITY_FILE_NAME = 'identity.json';
const EXPORT_PREFIX = 'MONKY-ID:';
const PBKDF2_ITERATIONS = 210_000;

interface StoredIdentityRecord {
  version: 1;
  publicKey: string;
  privateKey: string;
  storage: 'safeStorage' | 'plain';
}

interface ExportEnvelope {
  version: 1;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface AppIdentity {
  publicKey: string;
  clientId: string;
}

/** An import may carry the servers/settings backup exported alongside it (#472). */
export interface AppIdentityImport extends AppIdentity {
  extras?: string;
}

interface LoadedIdentity extends AppIdentity {
  privateKeyDerBase64: string;
}

function getIdentityFilePath(): string {
  return path.join(app.getPath('userData'), IDENTITY_FILE_NAME);
}

function createIdentityFromPrivateKey(privateKeyDerBase64: string): LoadedIdentity {
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyDerBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = normalizePublicKeyHex(
    createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('hex')
  );
  return {
    publicKey,
    clientId: deriveClientIdFromPublicKey(publicKey),
    privateKeyDerBase64,
  };
}

function persistIdentity(identity: LoadedIdentity): void {
  const filePath = getIdentityFilePath();
  const storage = safeStorage.isEncryptionAvailable() ? 'safeStorage' : 'plain';
  const privateKey =
    storage === 'safeStorage'
      ? safeStorage.encryptString(identity.privateKeyDerBase64).toString('base64')
      : identity.privateKeyDerBase64;

  const record: StoredIdentityRecord = {
    version: 1,
    publicKey: identity.publicKey,
    privateKey,
    storage,
  };

  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
}

function loadStoredIdentity(): LoadedIdentity | null {
  const filePath = getIdentityFilePath();
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const record = JSON.parse(raw) as StoredIdentityRecord;
  if (!record?.publicKey || !record?.privateKey) {
    return null;
  }

  const privateKeyDerBase64 =
    record.storage === 'safeStorage'
      ? safeStorage.decryptString(Buffer.from(record.privateKey, 'base64'))
      : record.privateKey;

  const identity = createIdentityFromPrivateKey(privateKeyDerBase64);
  if (identity.publicKey !== normalizePublicKeyHex(record.publicKey)) {
    throw new Error('A identidade armazenada está corrompida.');
  }

  return identity;
}

function generateIdentity(): LoadedIdentity {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyHex = normalizePublicKeyHex(publicKey.export({ format: 'der', type: 'spki' }).toString('hex'));
  const privateKeyDerBase64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const identity = {
    publicKey: publicKeyHex,
    clientId: deriveClientIdFromPublicKey(publicKeyHex),
    privateKeyDerBase64,
  };
  persistIdentity(identity);
  return identity;
}

function ensureIdentity(): LoadedIdentity {
  try {
    return loadStoredIdentity() ?? generateIdentity();
  } catch {
    return generateIdentity();
  }
}

function buildExportKey(password: string, salt: Buffer): Buffer {
  if (!password.trim()) {
    throw new Error('Informe uma senha para proteger a identidade.');
  }
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
}

export function hasIdentity(): boolean {
  try {
    return loadStoredIdentity() !== null;
  } catch {
    return false;
  }
}

export function getIdentity(createIfMissing = true): AppIdentity | null {
  const identity = createIfMissing ? ensureIdentity() : loadStoredIdentity();
  if (!identity) return null;
  return {
    publicKey: identity.publicKey,
    clientId: identity.clientId,
  };
}

export function getClientId(): string {
  return ensureIdentity().clientId;
}

export function signChallenge(nonceHex: string): string {
  if (!/^[a-fA-F0-9]{64}$/.test(nonceHex)) {
    throw new Error('Nonce inválido.');
  }

  const identity = ensureIdentity();
  const privateKey = createPrivateKey({
    key: Buffer.from(identity.privateKeyDerBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });

  return sign(null, Buffer.from(nonceHex, 'hex'), privateKey).toString('hex');
}

export function exportIdentity(password: string, extras?: string): string {
  const identity = ensureIdentity();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = buildExportKey(password, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify({
    version: 1,
    publicKey: identity.publicKey,
    privateKeyDerBase64: identity.privateKeyDerBase64,
    // Saved servers and app settings ride along inside the same encrypted
    // envelope (#472). The main process never inspects them: the renderer owns
    // the format and hands over an opaque string.
    extras: extras && extras.length > 0 ? extras : undefined,
  }), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope: ExportEnvelope = {
    version: 1,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };

  return `${EXPORT_PREFIX}${Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64')}`;
}

export function importIdentity(exportedIdentity: string, password: string): AppIdentityImport {
  const normalized = exportedIdentity.trim();
  if (!normalized.startsWith(EXPORT_PREFIX)) {
    throw new Error('Código de identidade inválido.');
  }

  const encodedPayload = normalized.slice(EXPORT_PREFIX.length);
  const envelope = JSON.parse(Buffer.from(encodedPayload, 'base64').toString('utf8')) as ExportEnvelope;
  if (!envelope?.salt || !envelope?.iv || !envelope?.tag || !envelope?.ciphertext) {
    throw new Error('Conteúdo da identidade inválido.');
  }

  const key = buildExportKey(password, Buffer.from(envelope.salt, 'hex'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));

  let payload: { privateKeyDerBase64: string; extras?: string };
  try {
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'hex')),
      decipher.final(),
    ]).toString('utf8');
    payload = JSON.parse(decrypted);
  } catch {
    throw new Error('Senha incorreta ou identidade corrompida.');
  }

  if (!payload?.privateKeyDerBase64) {
    throw new Error('Identidade descriptografada inválida.');
  }

  const identity = createIdentityFromPrivateKey(payload.privateKeyDerBase64);
  persistIdentity(identity);
  return {
    publicKey: identity.publicKey,
    clientId: identity.clientId,
    extras: typeof payload.extras === 'string' ? payload.extras : undefined,
  };
}
