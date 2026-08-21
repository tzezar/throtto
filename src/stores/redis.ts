import type { Store, StoreEntry } from '../core/types.js'

// ─── Redis Client Interface ──────────────────────────────────────────────────
// Minimal interface compatible with ioredis and other Redis clients

export interface RedisClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ...args: (string | number)[]): Promise<unknown>
  del(...keys: string[]): Promise<number>
  keys(pattern: string): Promise<string[]>
  eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>
  evalsha?(sha: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>
  quit?(): Promise<unknown>
  disconnect?(): void
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface RedisStoreConfig {
  /** The ioredis (or compatible) client instance */
  client: RedisClient
  /** Key prefix. Default: 'throtto:' */
  prefix?: string | undefined
  /** Whether to call client.quit() on shutdown. Default: false */
  disconnectOnShutdown?: boolean | undefined
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
 * Returns: {1, ''} on success, {0, current_value} on failure.
 * Returning the current value on failure eliminates the need for a
 * separate GET round trip on the next retry attempt.
 */
const LUA_CAS = `
local current = redis.call('GET', KEYS[1])
local expected = ARGV[1]
if expected == '' then
  if current == false then
    redis.call('SET', KEYS[1], ARGV[2], 'PX', tonumber(ARGV[3]))
    return {1, ''}
  end
  return {0, current}
else
  if current == expected then
    redis.call('SET', KEYS[1], ARGV[2], 'PX', tonumber(ARGV[3]))
    return {1, ''}
  end
  return {0, current or ''}
end
`

// ─── Store Implementation ────────────────────────────────────────────────────

/**
 * Redis-backed store using ioredis or any compatible client.
 *
 * Features:
 * - Key prefix support for multi-tenant isolation
 * - Lua scripts for atomic compare-and-swap operations
 * - Automatic TTL management via Redis PX option
 * - Connection lifecycle management (optional disconnect on shutdown)
 *
 * Note on atomicity:
 * The `atomic()` method uses a Lua-based compare-and-swap with retries.
 * Under extremely high contention on a single key, retries may exhaust.
 * For most rate limiting use cases, contention is distributed across many keys
 * and this approach works well.
 */
export function redisStore(config: RedisStoreConfig): Store {
  const { client, prefix: storePrefix = 'throtto:', disconnectOnShutdown = false } = config
  const maxRetries = 10

  function prefixKey(key: string): string {
    return `${storePrefix}${key}`
  }

  function serialize(entry: StoreEntry): string {
    return JSON.stringify(entry)
  }

  function deserialize(raw: string): StoreEntry | null {
    try {
      const parsed = JSON.parse(raw) as StoreEntry
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'state' in parsed &&
        'expiresAt' in parsed &&
        'createdAt' in parsed
      ) {
        return parsed
      }
      return null
    } catch {
      return null
    }
  }

  async function evalScript(
    script: string,
    keys: string[],
    args: (string | number)[],
  ): Promise<unknown> {
    return client.eval(script, keys.length, ...keys, ...args)
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
      await client.set(prefixKey(key), serialized, 'PX', ttlMs)
    },

    async delete(key: string): Promise<void> {
      await client.del(prefixKey(key))
    },

    async clear(): Promise<void> {
      const pattern = `${storePrefix}*`
      const matchedKeys = await client.keys(pattern)
      if (matchedKeys.length > 0) {
        await client.del(...matchedKeys)
      }
    },

    async atomic(
      key: string,
      updater: (current: StoreEntry | null) => StoreEntry,
      ttlMs: number,
    ): Promise<StoreEntry> {
      const prefixed = prefixKey(key)

      // Initial GET - only round trip needed before the first CAS attempt.
      // Subsequent retries reuse the current value returned by the Lua script.
      let raw: string | null = await client.get(prefixed)

      for (let attempt = 0; attempt < maxRetries; attempt++) {
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
        const expected = raw ?? ''
        const casResult = (await evalScript(
          LUA_CAS,
          [prefixed],
          [expected, serialized, actualTtl],
        )) as [number, string]

        if (casResult[0] === 1) {
          return updated
        }

        // CAS failed - use the current value returned by the script for the
        // next iteration, avoiding a separate GET round trip.
        raw = casResult[1] === '' ? null : casResult[1]
      }

      // All retries exhausted - force set (last resort)
      const current: StoreEntry | null = raw !== null ? deserialize(raw) : null
      const validCurrent = current !== null && current.expiresAt > Date.now() ? current : null
      const updated = updater(validCurrent)
      const serialized = serialize(updated)
      const fallbackTtl = Math.max(1, updated.expiresAt - Date.now())
      await client.set(prefixed, serialized, 'PX', fallbackTtl)
      return updated
    },

    async keys(prefix?: string): Promise<string[]> {
      const pattern = prefix ? `${storePrefix}${prefix}*` : `${storePrefix}*`
      const redisKeys = await client.keys(pattern)
      return redisKeys.map((k) => k.slice(storePrefix.length))
    },

    async ping(): Promise<boolean> {
      try {
        const result = await client.eval("return redis.call('PING')", 0)
        return result === 'PONG'
      } catch {
        return false
      }
    },

    async shutdown(): Promise<void> {
      if (disconnectOnShutdown && client.quit) {
        await client.quit()
      }
    },
  }

  return store
}
