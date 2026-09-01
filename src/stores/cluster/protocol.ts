import type { StoreEntry } from '../../core/types.js'

/**
 * Wire protocol shared by the primary process and its workers.
 *
 * Every message is a plain JSON-serializable object so it survives Node's
 * default IPC serialization. `advanced` (structured clone) serialization works
 * too - the payloads are a strict subset of what it supports.
 */
export const CLUSTER_PROTOCOL = 'throtto/cluster@1'

// ─── Requests (worker -> primary) ────────────────────────────────────────────

export type ClusterRequest =
  | { op: 'get'; key: string }
  | { op: 'set'; key: string; entry: StoreEntry }
  /** Optimistic fast path: write only if the key is still at `expected`. */
  | { op: 'cas'; key: string; expected: number | null; entry: StoreEntry }
  /** Fair path: take a FIFO turn on the key and read its current value. */
  | { op: 'lock'; key: string }
  /** Write the value computed while holding `token`, then release the key. */
  | { op: 'commit'; key: string; token: number; entry: StoreEntry }
  /** Release `token` without writing (the updater threw). */
  | { op: 'unlock'; key: string; token: number }
  | { op: 'delete'; key: string }
  | { op: 'clear' }
  | { op: 'keys'; prefix: string | null }
  | { op: 'ping' }

export type ClusterRequestOp = ClusterRequest['op']

// ─── Responses (primary -> worker) ───────────────────────────────────────────

export type ClusterResponse =
  | { op: 'get'; entry: StoreEntry | null; version: number | null }
  | { op: 'set'; version: number }
  /**
   * `ok: false` carries the primary's current entry and version so the worker
   * can retry immediately without an extra `get` round trip.
   */
  | { op: 'cas'; ok: boolean; version: number | null; entry: StoreEntry | null }
  /** Sent once the key is free. May be deferred while another worker holds it. */
  | { op: 'lock'; token: number; entry: StoreEntry | null; version: number | null }
  /** `ok: false` means the lock had already expired and nothing was written. */
  | { op: 'commit'; ok: boolean; version: number | null }
  | { op: 'unlock' }
  | { op: 'delete' }
  | { op: 'clear' }
  | { op: 'keys'; keys: string[] }
  | { op: 'ping'; ok: boolean }

export type ClusterResponseFor<TOp extends ClusterRequestOp> = Extract<ClusterResponse, { op: TOp }>

// ─── Envelopes ───────────────────────────────────────────────────────────────

export interface ClusterRequestEnvelope {
  protocol: string
  namespace: string
  id: number
  request: ClusterRequest
}

export interface ClusterResponseEnvelope {
  protocol: string
  namespace: string
  id: number
  response: ClusterResponse | null
  error: string | null
}

// ─── Guards ──────────────────────────────────────────────────────────────────

function isEnvelope(value: unknown, namespace: string): value is { namespace: string; id: number } {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.protocol === CLUSTER_PROTOCOL &&
    candidate.namespace === namespace &&
    typeof candidate.id === 'number'
  )
}

export function isClusterRequest(
  value: unknown,
  namespace: string,
): value is ClusterRequestEnvelope {
  if (!isEnvelope(value, namespace)) return false
  const request = (value as Record<string, unknown>).request
  return typeof request === 'object' && request !== null && 'op' in request
}

export function isClusterResponse(
  value: unknown,
  namespace: string,
): value is ClusterResponseEnvelope {
  if (!isEnvelope(value, namespace)) return false
  const candidate = value as Record<string, unknown>
  return 'response' in candidate && 'error' in candidate
}
