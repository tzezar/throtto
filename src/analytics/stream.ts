import type { AnalyticsEvent } from './collector.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StreamConfig {
  /** Buffer size for pending events. Default: 100 */
  bufferSize?: number | undefined
  /** Filter events before streaming */
  filter?: ((event: AnalyticsEvent) => boolean) | undefined
}

// ─── Event Stream ────────────────────────────────────────────────────────────

export interface AnalyticsStream {
  /** Push an event to all active subscribers */
  push(event: AnalyticsEvent): void
  /** Subscribe to the event stream */
  subscribe(config?: StreamConfig): AsyncGenerator<AnalyticsEvent, void, unknown>
  /** Number of active subscribers */
  subscriberCount(): number
}

/**
 * Creates a real-time analytics event stream using AsyncGenerators.
 *
 * Usage:
 * ```ts
 * const stream = createAnalyticsStream()
 *
 * // Subscribe
 * for await (const event of stream.subscribe({ filter: e => !e.allowed })) {
 *   console.log('Denied:', event.key)
 * }
 * ```
 */
export function createAnalyticsStream(): AnalyticsStream {
  const subscribers = new Set<{
    buffer: AnalyticsEvent[]
    maxBuffer: number
    filter: ((event: AnalyticsEvent) => boolean) | undefined
    resolve: ((value: IteratorResult<AnalyticsEvent, void>) => void) | null
  }>()

  return {
    push(event: AnalyticsEvent): void {
      for (const sub of subscribers) {
        if (sub.filter && !sub.filter(event)) continue

        if (sub.resolve) {
          // Subscriber is waiting - deliver immediately
          const resolve = sub.resolve
          sub.resolve = null
          resolve({ value: event, done: false })
        } else {
          // Buffer the event
          if (sub.buffer.length < sub.maxBuffer) {
            sub.buffer.push(event)
          }
          // Drop oldest if full
          else {
            sub.buffer.shift()
            sub.buffer.push(event)
          }
        }
      }
    },

    subscribe(config: StreamConfig = {}): AsyncGenerator<AnalyticsEvent, void, unknown> {
      const { bufferSize = 100, filter } = config
      const sub = {
        buffer: [] as AnalyticsEvent[],
        maxBuffer: bufferSize,
        filter,
        resolve: null as ((value: IteratorResult<AnalyticsEvent, void>) => void) | null,
      }

      subscribers.add(sub)

      const generator: AsyncGenerator<AnalyticsEvent, void, unknown> = {
        next(): Promise<IteratorResult<AnalyticsEvent, void>> {
          // If there's a buffered event, return it immediately
          if (sub.buffer.length > 0) {
            const event = sub.buffer.shift()!
            return Promise.resolve({ value: event, done: false })
          }

          // Wait for next event
          return new Promise((resolve) => {
            sub.resolve = resolve
          })
        },

        return(): Promise<IteratorResult<AnalyticsEvent, void>> {
          subscribers.delete(sub)
          return Promise.resolve({ value: undefined, done: true })
        },

        throw(): Promise<IteratorResult<AnalyticsEvent, void>> {
          subscribers.delete(sub)
          return Promise.resolve({ value: undefined, done: true })
        },

        [Symbol.asyncIterator]() {
          return this
        },
      }

      return generator
    },

    subscriberCount(): number {
      return subscribers.size
    },
  }
}
