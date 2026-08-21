export interface ThrottleOptions {
  /** Minimum interval between invocations (ms) */
  interval: number
  /** Fire on the leading edge. Default: true */
  leading?: boolean | undefined
  /** Fire on the trailing edge. Default: false */
  trailing?: boolean | undefined
}

declare function setTimeout(fn: () => void, ms: number): unknown
declare function clearTimeout(handle: unknown): void

/**
 * Throttle a function - at most once per interval.
 *
 * @example
 * ```ts
 * const throttled = throttle(saveData, { interval: 1000 })
 * throttled() // fires immediately (leading)
 * throttled() // ignored
 * throttled() // ignored
 * // After 1000ms, fires again (trailing) if trailing=true
 * ```
 */
export function throttle<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
  options: ThrottleOptions,
): ((...args: TArgs) => TReturn | undefined) & { cancel(): void; flush(): void } {
  const { interval, leading = true, trailing = false } = options
  let lastCallTime = 0
  let timer: unknown = null
  let lastArgs: TArgs | null = null
  let lastResult: TReturn | undefined

  function invoke(args: TArgs): TReturn {
    lastCallTime = Date.now()
    lastResult = fn(...args)
    return lastResult
  }

  function throttled(...args: TArgs): TReturn | undefined {
    const now = Date.now()
    const elapsed = now - lastCallTime

    if (elapsed >= interval) {
      // Enough time has passed
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (leading) {
        return invoke(args)
      }
    }

    // Schedule trailing call
    lastArgs = args
    if (trailing && timer === null) {
      timer = setTimeout(() => {
        timer = null
        if (lastArgs) {
          invoke(lastArgs)
          lastArgs = null
        }
      }, interval - elapsed)
    }

    return lastResult
  }

  throttled.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    lastArgs = null
  }

  throttled.flush = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
      if (lastArgs) {
        invoke(lastArgs)
        lastArgs = null
      }
    }
  }

  return throttled
}
