import { createDecipheriv, createPrivateKey, createPublicKey, pbkdf2Sync } from 'crypto';
import { deriveClientIdFromPublicKey, normalizePublicKeyHex } from '@monky/shared';
import { EXPORT_PREFIX, PBKDF2_ITERATIONS } from './constants';

export interface ExportEnvelope {
  version: 1;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface ExportPayload {
  version?: number;
  publicKey?: string;
  privateKeyDerBase64: string;
}

export interface DecryptedIdentity {
  publicKey: string;
  clientId: string;
  privateKeyDerBase64: string;
}

export function buildExportKey(password: string, salt: Buffer): Buffer {
  if (!password.trim()) {
    throw new Error('Informe a senha da identidade.');
  }
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
}

export function decryptIdentityExport(exportedIdentity: string, password: string): DecryptedIdentity {
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

  let payload: ExportPayload;
  try {
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'hex')),
      decipher.final(),
    ]).toString('utf8');
    payload = JSON.parse(decrypted) as ExportPayload;
  } catch {
    throw new Error('Senha incorreta ou identidade corrompida.');
  }

  if (!payload?.privateKeyDerBase64) {
    throw new Error('Identidade descriptografada inválida.');
  }

  const privateKey = createPrivateKey({
    key: Buffer.from(payload.privateKeyDerBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = normalizePublicKeyHex(
    createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('hex')
  );

  if (payload.publicKey && normalizePublicKeyHex(payload.publicKey) !== publicKey) {
    throw new Error('A identidade descriptografada não corresponde à chave pública informada.');
  }

  return {
    publicKey,
    clientId: deriveClientIdFromPublicKey(publicKey),
    privateKeyDerBase64: payload.privateKeyDerBase64,
  };
}
