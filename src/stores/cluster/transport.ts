/**
 * Transport abstraction between workers and the primary process.
 *
 * The default implementation speaks Node's `cluster` IPC channel, but any
 * request/response bus works - PM2's message bus, `child_process.fork()`,
 * `MessagePort`, or an in-memory pair for tests.
 */

// ─── Public interface ────────────────────────────────────────────────────────

export type ClusterRole = 'primary' | 'worker'

/** Handle used by the primary to reply to the worker that sent a request. */
export interface ClusterPeer {
  send(message: unknown): boolean
}

export interface ClusterTransport {
  /** Which side of the channel this process sits on. */
  readonly role: ClusterRole
  /** Primary only: start receiving requests. Never called on workers. */
  listen(handler: (message: unknown, peer: ClusterPeer) => void): void | Promise<void>
  /** Worker only: start receiving responses. Never called on the primary. */
  subscribe(handler: (message: unknown) => void): void | Promise<void>
  /** Worker only: send a request. Returns false when the channel is closed. */
  send(message: unknown): boolean
  /** Worker only: whether the IPC channel is currently open. */
  isConnected(): boolean
  /** Detach listeners and release resources. */
  close(): void | Promise<void>
}

// ─── Minimal Node shapes ─────────────────────────────────────────────────────
// Declared locally because tsconfig uses "types": [] (no global @types/node).

interface NodeProcessLike {
  env?: Record<string, string | undefined> | undefined
  connected?: boolean | undefined
  send?: ((message: unknown) => boolean) | undefined
  on(event: string, listener: (message: unknown) => void): unknown
  removeListener(event: string, listener: (message: unknown) => void): unknown
}

export interface NodeClusterWorker {
  id: number
  isConnected(): boolean
  send(message: unknown): boolean
}

export interface NodeCluster {
  isPrimary?: boolean | undefined
  isMaster?: boolean | undefined
  on(event: string, listener: (worker: NodeClusterWorker, message: unknown) => void): unknown
  removeListener(
    event: string,
    listener: (worker: NodeClusterWorker, message: unknown) => void,
  ): unknown
}

function getProcess(): NodeProcessLike | undefined {
  return (globalThis as { process?: NodeProcessLike }).process
}

/**
 * Detect whether this process is a cluster worker.
 *
 * Presence of an IPC channel (`process.send`) is the only reliable synchronous
 * signal: Node deletes `NODE_UNIQUE_ID` from a worker's environment during
 * bootstrap, and PM2 rewrites the environment as well. Any process holding an
 * IPC channel to a parent is therefore treated as a worker.
 *
 * Pass `role` explicitly when a process has an IPC channel for unrelated
 * reasons (for example a primary started by a supervisor in fork mode).
 */
export function detectRole(): ClusterRole {
  const proc = getProcess()
  if (!proc || typeof proc.send !== 'function') return 'primary'
  if (proc.connected === false) return 'primary'
  return 'worker'
}

// `node:cluster` is resolved through an indirection so bundlers targeting
// browsers/edge runtimes never try to inline a Node core module. Only the
// primary process loads it; workers talk to `process` directly.
const CLUSTER_SPECIFIER = 'node:cluster'

async function loadNodeCluster(): Promise<NodeCluster> {
  const specifier: string = CLUSTER_SPECIFIER
  const imported = await import(specifier)
  const resolved = (imported.default ?? imported) as NodeCluster
  if (typeof resolved?.on !== 'function') {
    throw new Error('node:cluster is not available in this runtime')
  }
  return resolved
}

// ─── Node cluster transport ──────────────────────────────────────────────────

export interface NodeClusterTransportConfig {
  /** Override auto-detection. */
  role?: ClusterRole | undefined
  /** Inject a `node:cluster` compatible module (useful for PM2 shims/tests). */
  cluster?: NodeCluster | undefined
}

export function nodeClusterTransport(config: NodeClusterTransportConfig = {}): ClusterTransport {
  const role = config.role ?? detectRole()
  const proc = getProcess()

  let primaryListener: ((worker: NodeClusterWorker, message: unknown) => void) | null = null
  let workerListener: ((message: unknown) => void) | null = null
  let clusterModule: NodeCluster | null = config.cluster ?? null

  return {
    role,

    async listen(handler): Promise<void> {
      clusterModule ??= await loadNodeCluster()
      primaryListener = (worker, message) => {
        handler(message, {
          send: (response) => {
            try {
              return worker.isConnected() ? worker.send(response) : false
            } catch {
              return false
            }
          },
        })
      }
      clusterModule.on('message', primaryListener)
    },

    subscribe(handler): void {
      if (!proc) throw new Error('No process object available for cluster IPC')
      workerListener = (message) => handler(message)
      proc.on('message', workerListener)
    },

    send(message: unknown): boolean {
      if (!proc || typeof proc.send !== 'function') return false
      if (proc.connected === false) return false
      try {
        return proc.send(message) !== false
      } catch {
        return false
      }
    },

    isConnected(): boolean {
      if (!proc || typeof proc.send !== 'function') return false
      return proc.connected !== false
    },

    close(): void {
      if (clusterModule && primaryListener) {
        clusterModule.removeListener('message', primaryListener)
        primaryListener = null
      }
      if (proc && workerListener) {
        proc.removeListener('message', workerListener)
        workerListener = null
      }
    },
  }
}
