// CacheStore adapters. The memory store is test/local-only (shared: false, so it never backs a
// retry cursor). The Redis store is shared across instances and implements atomic leases.
import type { LeaseStore } from "./types";

type Clock = () => number;

/** In-process store. Explicitly test/local-only. */
export class MemoryCacheStore implements LeaseStore {
  readonly shared = false;
  private readonly map = new Map<string, { value: string; expires: number }>();
  constructor(private readonly now: Clock = Date.now) {}

  private live(key: string) {
    const e = this.map.get(key);
    if (e && e.expires <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return e;
  }
  async get<T>(key: string): Promise<T | null> {
    const e = this.live(key);
    return e ? (JSON.parse(e.value) as T) : null;
  }
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.map.set(key, { value: JSON.stringify(value), expires: this.now() + ttlSeconds * 1000 });
  }
  async tryLease(key: string, owner: string, ttlMs: number): Promise<boolean> {
    if (this.live(key)) return false;
    this.map.set(key, { value: JSON.stringify(owner), expires: this.now() + ttlMs });
    return true;
  }
  async releaseLease(key: string, owner: string): Promise<void> {
    const e = this.live(key);
    if (e && JSON.parse(e.value) === owner) this.map.delete(key);
  }
  /** Test helper. */
  keys(): string[] {
    return [...this.map.keys()].filter((k) => this.live(k));
  }
}

/**
 * Minimal command surface the Redis store needs. The composition root adapts whichever locked
 * Redis client it uses (node-redis, ioredis, Upstash REST) to this shape.
 */
export interface RedisCommands {
  get(key: string): Promise<string | null>;
  /** SET key value PX ttlMs [NX]; resolves "OK" when set, null when NX prevented it. */
  set(key: string, value: string, opts: { px: number; nx?: boolean }): Promise<"OK" | string | null>;
  /** Atomic compare-and-delete: delete key only when its value equals `value`. */
  delIfEquals(key: string, value: string): Promise<void>;
}

/** Lua for delIfEquals, for adapters that implement it via EVAL. */
export const DEL_IF_EQUALS_LUA = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export class RedisCacheStore implements LeaseStore {
  readonly shared = true;
  constructor(private readonly redis: RedisCommands, private readonly prefix = "mp:") {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(this.prefix + key);
    return raw === null ? null : (JSON.parse(raw) as T);
  }
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.prefix + key, JSON.stringify(value), { px: Math.max(1, Math.round(ttlSeconds * 1000)) });
  }
  async tryLease(key: string, owner: string, ttlMs: number): Promise<boolean> {
    return (await this.redis.set(this.prefix + key, owner, { px: ttlMs, nx: true })) === "OK";
  }
  async releaseLease(key: string, owner: string): Promise<void> {
    await this.redis.delIfEquals(this.prefix + key, owner);
  }
}
