import crypto from 'crypto';

export class PasswordService {
  /**
   * Hashes a plain password using scrypt with a unique salt
   */
  public static hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = crypto.scryptSync(password, salt, 64, {
      N: 16384,
      r: 8,
      p: 1,
    });
    return `${salt}:${derivedKey.toString('hex')}`;
  }

  /**
   * Validates a candidate password against the stored salt:hash
   */
  public static verifyPassword(password: string, storedHash: string): boolean {
    if (!storedHash || !storedHash.includes(':')) {
      return false;
    }
    const [salt, key] = storedHash.split(':');
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = crypto.scryptSync(password, salt, 64, {
      N: 16384,
      r: 8,
      p: 1,
    });
    return crypto.timingSafeEqual(keyBuffer, derivedKey);
  }
}
