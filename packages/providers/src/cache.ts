/** Response cache with TTL. The server backs it with the `provider_cache` table. */
export interface ProviderCache {
  get(provider: string, key: string): Promise<unknown | undefined>;
  set(provider: string, key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

export class MemoryCache implements ProviderCache {
  private readonly entries = new Map<string, { value: unknown; expires: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async get(provider: string, key: string) {
    const entry = this.entries.get(`${provider}:${key}`);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.entries.delete(`${provider}:${key}`);
      return undefined;
    }
    return entry.value;
  }

  async set(provider: string, key: string, value: unknown, ttlSeconds: number) {
    this.entries.set(`${provider}:${key}`, { value, expires: this.now() + ttlSeconds * 1000 });
  }
}
