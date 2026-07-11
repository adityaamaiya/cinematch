// Minimal in-memory TTL cache for hot, cheap-to-refetch data (watch providers, trailers).
// ponytail: process-local, lost on restart — fine for a single pm2 instance; reach for Mongo/Redis
// only if we scale out or need persistence across deploys.
interface Slot<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<V> {
  private store = new Map<string, Slot<V>>();
  constructor(private readonly ttlMs: number) {}

  get(key: string): V | undefined {
    const slot = this.store.get(key);
    if (!slot) return undefined;
    if (Date.now() > slot.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return slot.value;
  }

  set(key: string, value: V): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    if (this.store.size > 10_000) {
      const now = Date.now();
      for (const [k, s] of this.store) if (now > s.expiresAt) this.store.delete(k);
    }
  }

  // Return the cached value or compute+store it.
  async remember(key: string, compute: () => Promise<V>): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = await compute();
    this.set(key, value);
    return value;
  }
}
