import type { Store, StoreEntry } from '../core/types.js'

// ─── Upstash Redis Client Interface ─────────────────────────────────────────
// Minimal interface compatible with @upstash/redis

export interface UpstashRedisClient {
  get<T = unknown>(key: string): Promise<T | null>
  set(key: string, value: string, opts?: { px?: number | undefined }): Promise<string | null>
  del(...keys: string[]): Promise<number>
  eval<T = unknown>(script: string, keys: string[], args: (string | number)[]): Promise<T>
  keys(pattern: string): Promise<string[]>
  ping?(): Promise<string>
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface UpstashStoreConfig {
  /** The @upstash/redis client instance */
  client: UpstashRedisClient
  /** Key prefix. Default: 'throtto:' */
  prefix?: string | undefined
}

// ─── Lua Scripts ─────────────────────────────────────────────────────────────

/**
 * Lua script for conditional set (compare-and-swap).
 * Only sets if current value matches expected.
 *
 * KEYS[1] = key
 * ARGV[1] = expected current value (or empty string for "key doesn't exist")
 * ARGV[2] = new value
 * ARGV[3] = TTL in milliseconds
 *
 * Returns: 1 if set succeeded, 0 if CAS failed
 */
const LUA_CAS = `
local current = redis.call('GET', KEYS[1])
local expected = ARGV[1]
if expected == '' then
  if current == false then
    redis.call('SET', KEYS[1], ARGV[2], 'PX', tonumber(ARGV[3]))
    return 1
  end
  return 0
else
  if current == expected then
    redis.call('SET', KEYS[1], ARGV[2], 'PX', tonumber(ARGV[3]))
    return 1
  end
  return 0
end
`

// ─── Store Implementation ────────────────────────────────────────────────────

/**
 * Upstash Redis store for serverless/edge environments.
 *
 * Features:
 * - HTTP-based (no persistent TCP connections)
 * - Works in Cloudflare Workers, Vercel Edge, Deno Deploy, etc.
 * - Key prefix support for multi-tenant isolation
 * - Lua script support via Upstash REST API for atomic CAS operations
 * - Automatic TTL management
 *
 * Note: Upstash's `get()` may auto-deserialize JSON. This store handles
 * both string and pre-parsed object returns transparently.
 */
export function upstashStore(config: UpstashStoreConfig): Store {
  const { client, prefix = 'throtto:' } = config
  const maxRetries = 10

  function prefixKey(key: string): string {
    return `${prefix}${key}`
  }

  function serialize(entry: StoreEntry): string {
    return JSON.stringify(entry)
  }

  function deserialize(raw: unknown): StoreEntry | null {
    try {
      let parsed: unknown

      if (typeof raw === 'string') {
        parsed = JSON.parse(raw)
      } else if (typeof raw === 'object' && raw !== null) {
        // Upstash may auto-parse JSON
        parsed = raw
      } else {
        return null
      }

      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'state' in parsed &&
        'expiresAt' in parsed &&
        'createdAt' in parsed
      ) {
        return parsed as StoreEntry
      }
      return null
    } catch {
      return null
    }
  }

  const store: Store = {
    async get(key: string): Promise<StoreEntry | null> {
      const raw = await client.get(prefixKey(key))
      if (raw === null) return null

      const entry = deserialize(raw)
      if (entry === null) return null

      // Check if expired (Redis TTL should handle this, but be safe)
      if (entry.expiresAt <= Date.now()) {
        await client.del(prefixKey(key))
        return null
      }

      return entry
    },

    async set(key: string, entry: StoreEntry, ttlMs: number): Promise<void> {
      const serialized = serialize(entry)
      await client.set(prefixKey(key), serialized, { px: ttlMs })
    },

    async delete(key: string): Promise<void> {
      await client.del(prefixKey(key))
    },

    async clear(): Promise<void> {
      const pattern = `${prefix}*`
      const keys = await client.keys(pattern)
      if (keys.length > 0) {
        await client.del(...keys)
      }
    },

    async atomic(
      key: string,
      updater: (current: StoreEntry | null) => StoreEntry,
      ttlMs: number,
    ): Promise<StoreEntry> {
      const prefixed = prefixKey(key)

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        // Get current raw value (as string for CAS comparison)
        const raw = await client.get<string>(prefixed)
        const current: StoreEntry | null = raw !== null ? deserialize(raw) : null

        // Check expiry
        const validCurrent = current !== null && current.expiresAt > Date.now() ? current : null

        // Apply updater
        const updated = updater(validCurrent)
        const serialized = serialize(updated)

        // Compute actual TTL from the entry's expiresAt rather than
        // the caller-supplied ttlMs, which may be stale or zero.
        const actualTtl = Math.max(1, updated.expiresAt - Date.now())

        // CAS: only set if value hasn't changed since we read it
        const expected = typeof raw === 'string' ? raw : raw !== null ? JSON.stringify(raw) : ''
        const result = await client.eval<number>(
          LUA_CAS,
          [prefixed],
          [expected, serialized, actualTtl],
        )

        if (result === 1) {
          return updated
        }

        // CAS failed, retry
      }

      // All retries exhausted - force set (last resort)
      const raw = await client.get<string>(prefixed)
      const current: StoreEntry | null = raw !== null ? deserialize(raw) : null
      const validCurrent = current !== null && current.expiresAt > Date.now() ? current : null
      const updated = updater(validCurrent)
      const serialized = serialize(updated)
      const fallbackTtl = Math.max(1, updated.expiresAt - Date.now())
      await client.set(prefixed, serialized, { px: fallbackTtl })
      return updated
    },

    async ping(): Promise<boolean> {
      try {
        if (!client.ping) return false
        const result = await client.ping()
        return result === 'PONG'
      } catch {
        return false
      }
    },

    async shutdown(): Promise<void> {
      // No-op: HTTP-based client has no persistent connection to close
    },
  }

  return store
}
