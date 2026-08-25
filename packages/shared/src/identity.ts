export function normalizePublicKeyHex(publicKey: string): string {
  return publicKey.trim().toLowerCase();
}

export function deriveClientIdFromPublicKey(publicKey: string): string {
  return normalizePublicKeyHex(publicKey).slice(0, 32);
}
