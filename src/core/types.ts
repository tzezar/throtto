// ─── Duration ─────────────────────────────────────────────────────────────────

export type DurationUnit = 'ms' | 's' | 'm' | 'h' | 'd'
export type DurationString = `${number}${DurationUnit}`
export type Duration = number | DurationString

// ─── Store ────────────────────────────────────────────────────────────────────

export interface StoreEntry {
  state: Record<string, unknown>
  expiresAt: number
  createdAt: number
  /** Algorithm type that created this entry. Used for mismatch detection. */
  algorithmType?: string | undefined
}

export interface Store {
  get(key: string): Promise<StoreEntry | null>
  set(key: string, entry: StoreEntry, ttlMs: number): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  atomic?(
    key: string,
    updater: (current: StoreEntry | null) => StoreEntry,
    ttlMs: number,
  ): Promise<StoreEntry>
  shutdown?(): Promise<void>
  /** List keys matching an optional prefix. */
  keys?(prefix?: string): Promise<string[]>
  /** Check if the store is reachable. */
  ping?(): Promise<boolean>
}

// ─── Algorithm ────────────────────────────────────────────────────────────────

export interface RateLimitInfo {
  limit: number
  remaining: number
  resetAt: number
  retryAfter?: number | undefined
}

export interface AlgorithmResult<TState> {
  allowed: boolean
  state: TState
  info: RateLimitInfo
  ttlMs: number
}

export interface Algorithm<TState = Record<string, unknown>> {
  type: string
  initialState(): TState
  check(state: TState | null, now: number, cost?: number): AlgorithmResult<TState>
  peek?(state: TState | null, now: number): RateLimitInfo
}

// ─── Rate Limit Result ────────────────────────────────────────────────────────

export interface AllowedResult {
  allowed: true
  limit: number
  remaining: number
  resetAt: number
  cost: number
}

export interface DeniedResult {
  allowed: false
  limit: number
  remaining: number
  resetAt: number
  retryAfter: number
  cost: number
}

export type RateLimitResult = AllowedResult | DeniedResult

// ─── Clock ────────────────────────────────────────────────────────────────────

export interface Clock {
  now(): number
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export interface LimiterHooks {
  onAllow?: ((key: string, result: AllowedResult) => void) | undefined
  onDeny?: ((key: string, result: DeniedResult) => void) | undefined
  onError?: ((key: string, error: unknown) => void) | undefined
  onStoreError?: ((error: unknown) => void) | undefined
}

// ─── Limiter Config ───────────────────────────────────────────────────────────

export interface CheckOptions {
  cost?: number | undefined
  key?: string | undefined
}

export interface ShutdownOptions {
  timeout?: number | undefined
}

export interface LimiterConfig<TContext = string> {
  // biome-ignore lint/suspicious/noExplicitAny: framework interop requires any
  algorithm: Algorithm<any>
  store: Store
  prefix?: string | undefined
  key?: TContext extends string
    ? ((ctx: TContext) => string) | undefined
    : (ctx: TContext) => string
  cost?: number | ((ctx: TContext) => number) | undefined
  failMode?: 'open' | 'closed' | undefined
  fallbackStore?: Store | undefined
  hooks?: LimiterHooks | undefined
  clock?: Clock | undefined
  /** Normalize keys before use. Default: none */
  normalizeKey?: 'lowercase' | 'trim' | 'lowercase-trim' | ((key: string) => string) | undefined
}

// ─── Limiter Interface ────────────────────────────────────────────────────────

export interface Limiter<TContext = string> {
  check(ctx: TContext, options?: CheckOptions): Promise<RateLimitResult>
  consume(ctx: TContext, options?: CheckOptions): Promise<AllowedResult>
  peek(ctx: TContext): Promise<RateLimitInfo | null>
  reset(ctx: TContext): Promise<void>
  shutdown(options?: ShutdownOptions): Promise<void>
}
