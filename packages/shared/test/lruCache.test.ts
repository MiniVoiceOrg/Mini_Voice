import assert from 'node:assert';
import { LruCache } from '../dist/index.js';

console.log('=== Início dos Testes de LruCache ===');

// 1. Basic get/set
const cache = new LruCache<string, number>(3, 10000);
cache.set('a', 1);
cache.set('b', 2);
assert.strictEqual(cache.get('a'), 1);
assert.strictEqual(cache.get('b'), 2);
assert.strictEqual(cache.get('c'), undefined);
assert.strictEqual(cache.size, 2);
console.log('✔ get / set básicos funcionam');

// 2. LRU Eviction
const lru = new LruCache<string, string>(2, 10000);
lru.set('k1', 'v1');
lru.set('k2', 'v2');
assert.strictEqual(lru.get('k1'), 'v1'); // k1 accessed, k2 is oldest
lru.set('k3', 'v3'); // should evict k2

assert.strictEqual(lru.get('k1'), 'v1');
assert.strictEqual(lru.get('k2'), undefined);
assert.strictEqual(lru.get('k3'), 'v3');
assert.strictEqual(lru.size, 2);
console.log('✔ Descarte LRU funciona corretamente');

// 3. TTL Expiry
async function testTtl() {
  const ttlCache = new LruCache<string, string>(5, 50);
  ttlCache.set('temp', 'value');
  assert.strictEqual(ttlCache.has('temp'), true);
  assert.strictEqual(ttlCache.get('temp'), 'value');

  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.strictEqual(ttlCache.has('temp'), false);
  assert.strictEqual(ttlCache.get('temp'), undefined);
  console.log('✔ Expiração passiva por TTL funciona');
}

// 4. Utility methods
const utilCache = new LruCache<string, number>(5, 10000);
utilCache.set('x', 10);
utilCache.set('y', 20);
assert.strictEqual(utilCache.has('x'), true);
assert.strictEqual(utilCache.has('z'), false);
assert.strictEqual(utilCache.delete('x'), true);
assert.strictEqual(utilCache.has('x'), false);
assert.strictEqual(utilCache.size, 1);
utilCache.clear();
assert.strictEqual(utilCache.size, 0);
console.log('✔ Métodos has, delete e clear funcionam');

testTtl().then(() => {
  console.log('=== Todos os testes do LruCache passaram com sucesso! ===');
});
