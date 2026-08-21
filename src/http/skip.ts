// ─── Skip Utility ───────────────────────────────────────────────────────────

/**
 * Configuration for request skipping.
 */
export interface SkipConfig {
  /** Paths to skip rate limiting for (exact match). Example: ['/health', '/metrics'] */
  skipPaths?: string[] | undefined
  /** HTTP methods to skip rate limiting for. Example: ['OPTIONS'] */
  skipMethods?: string[] | undefined
}

/**
 * Check if a request should skip rate limiting based on path and method.
 */
export function shouldSkip(path: string, method: string, config: SkipConfig): boolean {
  if (config.skipMethods) {
    const upper = method.toUpperCase()
    for (const m of config.skipMethods) {
      if (m.toUpperCase() === upper) return true
    }
  }
  if (config.skipPaths) {
    for (const p of config.skipPaths) {
      if (path === p) return true
    }
  }
  return false
}
