// ─── Core Types ───────────────────────────────────────────────────────────────
export type {
  Duration,
  DurationUnit,
  DurationString,
  Store,
  StoreEntry,
  Algorithm,
  AlgorithmResult,
  RateLimitInfo,
  RateLimitResult,
  AllowedResult,
  DeniedResult,
  Clock,
  LimiterHooks,
  LimiterConfig,
  Limiter,
  CheckOptions,
  ShutdownOptions,
} from './core/types.js'

// ─── Pipe / Composition ───────────────────────────────────────────────────────
export { pipe } from './core/pipe.js'
export type { LimiterTransform } from './core/pipe.js'

// ─── Core Utilities ───────────────────────────────────────────────────────────
export { parseDuration } from './core/duration.js'
export { realClock, createClock } from './core/clock.js'
export { createAllowedResult, createDeniedResult, isAllowed, isDenied } from './core/result.js'

// ─── Guards ───────────────────────────────────────────────────────────────
export { isLimiter } from './core/guards.js'

// ─── Errors ───────────────────────────────────────────────────────────────────
export {
  ThrottoError,
  ConfigError,
  StoreError,
  TimeoutError,
  RateLimitExceededError,
} from './core/errors.js'

// ─── Algorithms ───────────────────────────────────────────────────────────────
export {
  fixedWindow,
  slidingWindowCounter,
  slidingWindowLog,
  tokenBucket,
  leakyBucket,
  gcra,
  concurrency,
  releaseTicket,
} from './algorithms/index.js'

export type {
  FixedWindowConfig,
  FixedWindowState,
  SlidingWindowCounterConfig,
  SlidingWindowCounterState,
  SlidingWindowLogConfig,
  SlidingWindowLogState,
  TokenBucketConfig,
  TokenBucketState,
  LeakyBucketConfig,
  LeakyBucketState,
  GcraConfig,
  GcraState,
  ConcurrencyConfig,
  ConcurrencyState,
  ConcurrencyTicket,
} from './algorithms/index.js'

// ─── Stores ───────────────────────────────────────────────────────────────
export { memoryStore } from './stores/memory.js'
export type { MemoryStoreConfig } from './stores/memory.js'

export { redisStore } from './stores/redis.js'
export type { RedisStoreConfig, RedisClient } from './stores/redis.js'

export { upstashStore } from './stores/upstash.js'
export type { UpstashStoreConfig, UpstashRedisClient } from './stores/upstash.js'

export { postgresStore, ensurePostgresTable } from './stores/postgres.js'
export type { PostgresStoreConfig, PgPool, PgClient } from './stores/postgres.js'

export { mysqlStore, ensureMySqlTable } from './stores/mysql.js'
export type { MySqlStoreConfig, MySqlPool, MySqlConnection, MySqlRows } from './stores/mysql.js'

export { sqliteStore, ensureSqliteTable } from './stores/sqlite.js'
export type { SqliteStoreConfig, SqliteDatabase, SqliteStatement } from './stores/sqlite.js'

export { getSchema, getDrizzleSchema, getPrismaSchema } from './stores/schemas/index.js'
export type { SqlStore, SchemaOptions } from './stores/schemas/index.js'

// ─── Limiter ──────────────────────────────────────────────────────────────────
export { createLimiter } from './limiter/create-limiter.js'
export { rateLimit } from './limiter/presets.js'
export type { PresetOptions, SimpleConfig } from './limiter/presets.js'

// ─── Composition Wrappers ─────────────────────────────────────────────────────
export { withAllowlist } from './limiter/allowlist.js'
export type { AllowlistConfig } from './limiter/allowlist.js'

export { withDryRun } from './limiter/dry-run.js'
export type { DryRunHooks } from './limiter/dry-run.js'

// ─── Health ───────────────────────────────────────────────────────────────────
export { createHealthCheck } from './limiter/health.js'
export type { HealthStatus, HealthCheckConfig } from './limiter/health.js'

// ─── Operational Wrappers ─────────────────────────────────────────────────────
export { withThresholds } from './limiter/threshold.js'
export type { ThresholdLevel, ThresholdConfig } from './limiter/threshold.js'

export { withSoftHardLimit } from './limiter/soft-hard.js'
export type { SoftHardResult, SoftHardConfig } from './limiter/soft-hard.js'

export { withConditional } from './limiter/conditional.js'
export type { Reservation, ConditionalConfig } from './limiter/conditional.js'

export { withBatch } from './limiter/batch.js'
export type { BatchItem } from './limiter/batch.js'

// ─── Utilities ────────────────────────────────────────────────────────────────
export { getAlignedWindowStart, getWindowEnd, getWindowIndex } from './limiter/window-alignment.js'
export type { AlignmentStrategy, AlignmentConfig } from './limiter/window-alignment.js'

// ─── Advanced Limiters ────────────────────────────────────────────────────────
export { createCompoundLimiter } from './limiter/compound.js'
export type { CompoundLayer } from './limiter/compound.js'

export { createDynamicLimiter } from './limiter/dynamic.js'
export type { DynamicConfig } from './limiter/dynamic.js'

export { createTieredLimiter } from './limiter/tiered.js'
export type { TierConfig, TieredConfig } from './limiter/tiered.js'

export { createHierarchyLimiter } from './limiter/hierarchy.js'
export type { HierarchyLevel, HierarchyConfig, HierarchyResult } from './limiter/hierarchy.js'

export { createScheduledLimiter } from './limiter/scheduled.js'
export type { ScheduleWhen, ScheduleRule, ScheduledConfig, DayOfWeek } from './limiter/scheduled.js'

export { createLazyLimiter } from './limiter/lazy.js'
export type { LazyConfig } from './limiter/lazy.js'

export { withGracefulShutdown } from './limiter/shutdown.js'
export type { GracefulShutdownConfig } from './limiter/shutdown.js'

// ─── Store Utilities ──────────────────────────────────────────────────────
export { withCache } from './stores/cache-layer.js'
export type { CacheLayerConfig } from './stores/cache-layer.js'

// ─── HTTP Utilities ──────────────────────────────────────────────────────────
export { toHeaders, toErrorBody } from './http/headers.js'
export type { HeaderFormat, HeaderOptions, ErrorBodyOptions } from './http/headers.js'

export { byIp, byUser, byApiKey, byComposite, byCustom, byPath } from './http/key-resolvers.js'
export type { KeyResolver } from './http/key-resolvers.js'

export { shouldSkip } from './http/skip.js'
export type { SkipConfig } from './http/skip.js'

// ─── Patterns ─────────────────────────────────────────────────────────────────
export { throttle } from './patterns/throttle.js'
export type { ThrottleOptions } from './patterns/throttle.js'

export { debounce } from './patterns/debounce.js'
export type { DebounceOptions } from './patterns/debounce.js'

export { createPenaltyBox } from './patterns/penalty-box.js'
export type {
  PenaltyBoxConfig,
  PenaltyLevel,
  PenaltyBox,
  PenaltyStatus,
} from './patterns/penalty-box.js'

export { createQuota } from './patterns/quota.js'
export type { QuotaConfig, QuotaState } from './patterns/quota.js'

export { withCostMapping } from './patterns/cost-limiter.js'
export type { CostMapping } from './patterns/cost-limiter.js'

export { getBackpressure, withBackpressure } from './patterns/backpressure.js'
export type {
  BackpressureConfig,
  BackpressureSignal,
  BackpressureStrategy,
} from './patterns/backpressure.js'

// ─── Override ─────────────────────────────────────────────────────────────────
export { withOverride } from './limiter/override.js'
export type { OverrideAction, OverrideEntry, OverrideLimiter } from './limiter/override.js'

// ─── Export / Import ──────────────────────────────────────────────────────────
export { exportState, importState } from './limiter/export-import.js'
export type {
  ExportedState,
  ExportOptions,
  ImportOptions,
  ImportResult,
} from './limiter/export-import.js'
