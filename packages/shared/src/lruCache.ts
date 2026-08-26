/**
 * Estrutura de Cache LRU (Least Recently Used) genérica e performática.
 * 
 * - Capacidade máxima fixa com evicção automática do item menos recentemente acessado.
 * - Expiração passiva por TTL (Time To Live) em tempo de leitura, evitando timers em background.
 * - Métodos auxiliares para inspeção e invalidação manual de entradas.
 */
export class LruCache<K, V> {
  private values = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    public readonly maxEntries: number = 200,
    public readonly ttlMs: number = 1000 * 60 * 60 // 1 hora padrão
  ) {
    if (maxEntries <= 0) {
      throw new Error('maxEntries must be greater than 0');
    }
  }

  public get(key: K): V | undefined {
    const entry = this.values.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.values.delete(key);
      return undefined;
    }

    // Reordena para marcar como mais recentemente usado
    this.values.delete(key);
    this.values.set(key, entry);
    return entry.value;
  }

  public set(key: K, value: V, customTtlMs?: number): void {
    const ttl = customTtlMs !== undefined ? customTtlMs : this.ttlMs;
    const expiresAt = Date.now() + ttl;

    if (this.values.has(key)) {
      this.values.delete(key);
    } else if (this.values.size >= this.maxEntries) {
      const oldestKey = this.values.keys().next().value;
      if (oldestKey !== undefined) {
        this.values.delete(oldestKey);
      }
    }

    this.values.set(key, { value, expiresAt });
  }

  public has(key: K): boolean {
    const entry = this.values.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.values.delete(key);
      return false;
    }

    return true;
  }

  public delete(key: K): boolean {
    return this.values.delete(key);
  }

  public clear(): void {
    this.values.clear();
  }

  public get size(): number {
    return this.values.size;
  }
}
