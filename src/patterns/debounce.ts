export interface DebounceOptions {
  /** Delay before invocation (ms) */
  wait: number
  /** Maximum time to wait before forcing invocation (ms) */
  maxWait?: number | undefined
  /** Fire on the leading edge instead of trailing. Default: false */
  leading?: boolean | undefined
}

declare function setTimeout(fn: () => void, ms: number): unknown
declare function clearTimeout(handle: unknown): void

/**
 * Debounce a function - delays invocation until after `wait` ms of silence.
 *
 * @example
 * ```ts
 * const debounced = debounce(search, { wait: 300 })
 * debounced('a')
 * debounced('ab')
 * debounced('abc') // only this triggers after 300ms of no calls
 * ```
 */
export function debounce<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
  options: DebounceOptions,
): ((...args: TArgs) => TReturn | undefined) & {
  cancel(): void
  flush(): void
  pending(): boolean
} {
  const { wait, maxWait, leading = false } = options
  let timer: unknown = null
  let maxTimer: unknown = null
  let lastArgs: TArgs | null = null
  let lastResult: TReturn | undefined
  let firstCallTime = 0
  let isPending = false

  function invoke(args: TArgs): TReturn {
    isPending = false
    firstCallTime = 0
    if (maxTimer !== null) {
      clearTimeout(maxTimer)
      maxTimer = null
    }
    lastResult = fn(...args)
    return lastResult
  }

  function debounced(...args: TArgs): TReturn | undefined {
    lastArgs = args
    const now = Date.now()

    if (!isPending && leading) {
      isPending = true
      firstCallTime = now
      return invoke(args)
    }

    isPending = true
    if (firstCallTime === 0) firstCallTime = now

    // Reset the wait timer
    if (timer !== null) {
      clearTimeout(timer)
    }

    timer = setTimeout(() => {
      timer = null
      if (lastArgs) {
        invoke(lastArgs)
        lastArgs = null
      }
    }, wait)

    // Set max wait timer if configured
    if (maxWait !== undefined && maxTimer === null) {
      const remaining = maxWait - (now - firstCallTime)
      if (remaining > 0) {
        maxTimer = setTimeout(() => {
          maxTimer = null
          if (timer !== null) {
            clearTimeout(timer)
            timer = null
          }
          if (lastArgs) {
            invoke(lastArgs)
            lastArgs = null
          }
        }, remaining)
      }
    }

    return lastResult
  }

  debounced.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (maxTimer !== null) {
      clearTimeout(maxTimer)
      maxTimer = null
    }
    lastArgs = null
    isPending = false
    firstCallTime = 0
  }

  debounced.flush = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (maxTimer !== null) {
      clearTimeout(maxTimer)
      maxTimer = null
    }
    if (lastArgs) {
      invoke(lastArgs)
      lastArgs = null
    }
  }

  debounced.pending = () => isPending

  return debounced
}
