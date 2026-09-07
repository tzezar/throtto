import type { ClusterPeer, ClusterTransport } from '../../src/stores/cluster/index.js'

/**
 * In-process stand-in for the Node `cluster` IPC channel.
 *
 * Messages are cloned through JSON exactly like Node's default IPC
 * serialization and delivered asynchronously, so the tests exercise the same
 * interleaving a real fork would produce.
 */

export interface MockWorkerTransport extends ClusterTransport {
  /** Simulate a closed IPC channel (`send()` starts returning false). */
  disconnect(): void
  reconnect(): void
  /** Simulate a primary that is alive but never answers (hung event loop). */
  setResponsive(responsive: boolean): void
  /** Number of envelopes this worker put on the wire. */
  readonly sent: number
}

export interface MockChannel {
  primary: ClusterTransport
  createWorker(): MockWorkerTransport
  /** Stop the primary from receiving anything (simulates a dead primary). */
  killPrimary(): void
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function createMockChannel(): MockChannel {
  let primaryHandler: ((message: unknown, peer: ClusterPeer) => void) | null = null
  let primaryAlive = true

  const primary: ClusterTransport = {
    role: 'primary',
    listen(handler) {
      primaryHandler = handler
    },
    subscribe() {
      /* primary never subscribes */
    },
    send() {
      return false
    },
    isConnected() {
      return true
    },
    close() {
      primaryHandler = null
    },
  }

  function createWorker(): MockWorkerTransport {
    let workerHandler: ((message: unknown) => void) | null = null
    let connected = true
    let responsive = true
    let sent = 0

    const peer: ClusterPeer = {
      send(message) {
        if (!connected || !responsive) return false
        const copy = clone(message)
        queueMicrotask(() => workerHandler?.(copy))
        return true
      },
    }

    return {
      role: 'worker',
      get sent() {
        return sent
      },
      listen() {
        /* worker never listens */
      },
      subscribe(handler) {
        workerHandler = handler
      },
      send(message) {
        if (!connected) return false
        sent++
        if (!responsive || !primaryAlive || primaryHandler === null) {
          // Accepted by the channel but silently dropped - the caller has to
          // fall back to its response timeout, like a hung/absent primary.
          return true
        }
        const copy = clone(message)
        queueMicrotask(() => primaryHandler?.(copy, peer))
        return true
      },
      isConnected() {
        return connected
      },
      close() {
        workerHandler = null
      },
      disconnect() {
        connected = false
      },
      reconnect() {
        connected = true
      },
      setResponsive(value: boolean) {
        responsive = value
      },
    }
  }

  return {
    primary,
    createWorker,
    killPrimary() {
      primaryAlive = false
    },
  }
}
