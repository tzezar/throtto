import type { Store, StoreEntry } from '../core/types.js'

export interface ExportedState {
  version: 1
  exportedAt: number
  entries: Array<{
    key: string
    entry: StoreEntry
    ttlMs: number
  }>
}

export interface ExportOptions {
  /** Filter keys by prefix */
  prefix?: string | undefined
  /** Only export non-expired entries. Default: true */
  skipExpired?: boolean | undefined
}

export interface ImportOptions {
  /** Strategy for existing keys. Default: 'skip' */
  conflictStrategy?: 'overwrite' | 'skip' | 'keep-newer' | undefined
  /** Adjust TTLs relative to import time. Default: true */
  adjustTtl?: boolean | undefined
}

export interface ImportResult {
  imported: number
  skipped: number
  errors: Array<{ key: string; error: string }>
}

export async function exportState(
  store: Store,
  keys: string[],
  options?: ExportOptions,
): Promise<ExportedState>
export async function exportState(store: Store, options?: ExportOptions): Promise<ExportedState>
export async function exportState(
  store: Store,
  keysOrOptions?: string[] | ExportOptions,
  maybeOptions?: ExportOptions,
): Promise<ExportedState> {
  let keys: string[]
  let options: ExportOptions | undefined

  if (Array.isArray(keysOrOptions)) {
    keys = keysOrOptions
    options = maybeOptions
  } else {
    if (!store.keys) {
      throw new Error(
        'exportState: either provide explicit keys or use a store that implements keys().',
      )
    }
    options = keysOrOptions
    keys = await store.keys(options?.prefix)
  }

  const prefix = options?.prefix
  const skipExpired = options?.skipExpired ?? true
  const now = Date.now()

  const entries: ExportedState['entries'] = []

  for (const key of keys) {
    if (prefix !== undefined && !key.startsWith(prefix)) {
      continue
    }

    const entry = await store.get(key)
    if (entry === null) continue

    if (skipExpired && entry.expiresAt <= now) {
      continue
    }

    const ttlMs = Math.max(0, entry.expiresAt - now)
    entries.push({ key, entry, ttlMs })
  }

  return {
    version: 1,
    exportedAt: now,
    entries,
  }
}

export async function importState(
  store: Store,
  data: ExportedState,
  options?: ImportOptions,
): Promise<ImportResult> {
  const conflictStrategy = options?.conflictStrategy ?? 'skip'
  const adjustTtl = options?.adjustTtl ?? true

  let imported = 0
  let skipped = 0
  const errors: ImportResult['errors'] = []

  for (const item of data.entries) {
    try {
      let ttlMs: number

      if (adjustTtl) {
        ttlMs = Math.max(0, item.entry.expiresAt - data.exportedAt)
      } else {
        ttlMs = item.ttlMs
      }

      if (conflictStrategy === 'skip') {
        const existing = await store.get(item.key)
        if (existing !== null) {
          skipped++
          continue
        }
      } else if (conflictStrategy === 'keep-newer') {
        const existing = await store.get(item.key)
        if (existing !== null && existing.createdAt >= item.entry.createdAt) {
          skipped++
          continue
        }
      }

      const entry: StoreEntry = adjustTtl
        ? {
            state: item.entry.state,
            createdAt: item.entry.createdAt,
            expiresAt: Date.now() + ttlMs,
          }
        : item.entry

      await store.set(item.key, entry, ttlMs)
      imported++
    } catch (err) {
      errors.push({
        key: item.key,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { imported, skipped, errors }
}
