import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'crypto';

/**
 * Password-protected envelope shared by the identity export and the servers /
 * settings backup (#472).
 *
 * Both carry secrets — the identity carries the private key, the backup carries
 * the passwords of saved servers — so they get the exact same treatment:
 * PBKDF2-SHA256 to stretch the password and AES-256-GCM to seal the payload,
 * with the tag catching any tampering. Keeping a single implementation is what
 * stops one of the two from silently drifting into weaker parameters.
 */

const PBKDF2_ITERATIONS = 210_000;

/** Marks a servers/settings backup file (#472). */
export const BACKUP_ENVELOPE_PREFIX = 'MONKY-BACKUP:';

interface Envelope {
  version: 1;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

function deriveKey(password: string, salt: Buffer): Buffer {
  if (!password.trim()) {
    throw new Error('Informe uma senha para proteger o conteúdo.');
  }
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
}

/** Encrypts `plaintext` and returns `<prefix><base64 envelope>`. */
export function sealEnvelope(plaintext: string, password: string, prefix: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(password, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const envelope: Envelope = {
    version: 1,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };

  return `${prefix}${Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64')}`;
}

/**
 * Reverses {@link sealEnvelope}. Throws `invalidMessage` when the payload is not
 * an envelope at all and `wrongPasswordMessage` when it is one but does not
 * open, so the caller can tell "wrong file" from "wrong password".
 */
export function openEnvelope(
  payload: string,
  password: string,
  prefix: string,
  invalidMessage: string,
  wrongPasswordMessage: string
): string {
  const normalized = payload.trim();
  if (!normalized.startsWith(prefix)) {
    throw new Error(invalidMessage);
  }

  let envelope: Envelope;
  try {
    envelope = JSON.parse(
      Buffer.from(normalized.slice(prefix.length), 'base64').toString('utf8')
    ) as Envelope;
  } catch {
    throw new Error(invalidMessage);
  }

  if (!envelope?.salt || !envelope?.iv || !envelope?.tag || !envelope?.ciphertext) {
    throw new Error(invalidMessage);
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(password, Buffer.from(envelope.salt, 'hex')),
    Buffer.from(envelope.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error(wrongPasswordMessage);
  }
}
