# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0 (2026-08-21)


### Features

* throtto 1.0.0 - framework-agnostic TypeScript rate limiting ([0fae358](https://github.com/tzezar/throtto/commit/0fae3584aeae5eda21202c8e343fc7bae43f46bf))


### Bug Fixes

* allow build scripts in CI ([c63af36](https://github.com/tzezar/throtto/commit/c63af36c316e4d2358f1e21ed3fe0daf4f12a12f))
* allow dependency build scripts via .npmrc ([9e37cf0](https://github.com/tzezar/throtto/commit/9e37cf0591d9d9689a4a4df690c9804321433ae3))
* require Node.js 22+, update CI matrix ([60d65e2](https://github.com/tzezar/throtto/commit/60d65e2796b5d1a23ae1998d94d199a312c91ce4))
* skip build scripts in CI ([835d2ae](https://github.com/tzezar/throtto/commit/835d2ae9548f1f8698195b76f2e926821b11a7b4))
* use absolute URL for logo on npm ([b414c6e](https://github.com/tzezar/throtto/commit/b414c6e03c89d73c5e25d151744d865b1f991d1e))

## [1.0.0] - 2026-08-21

### Added

- **Core**: 7 rate limiting algorithms - Fixed Window, Sliding Window Counter, Sliding Window Log, Token Bucket, Leaky Bucket, GCRA, Concurrency
- **Limiter API**: `createLimiter` low-level builder, `rateLimit` presets (string shorthand `'100/minute'` and object config), `pipe()` functional composition
- **Stores**: Memory, Redis, Upstash, PostgreSQL, MySQL, SQLite - all with `ping()` health check, SQL stores with `cleanup()` for expired entries
- **Schema export**: SQL, Drizzle ORM, and Prisma schema generation via API and CLI (`npx @tzezar/throtto schema`)
- **Framework adapters** (18): Express, Fastify, Hono, Next.js, SvelteKit, Remix, Astro, NestJS, Elysia, H3, tRPC, WebSocket, Koa, Lambda, CloudFlare Workers, Bun, Deno, Generic HTTP - all with `skipPaths`/`skipMethods`, Express/Hono/Fastify support inline `{ limit, window }` config
- **Composition wrappers**: `withAllowlist`, `withDryRun`, `withOverride` (force allow/deny), `withThresholds`, `withSoftHardLimit`, `withConditional`, `withBatch`, `withGracefulShutdown`, `createHealthCheck`
- **Advanced limiters**: `createCompoundLimiter` (multi-layer with mixed algorithms), `createTieredLimiter` (free/pro/enterprise), `createDynamicLimiter` (per-key config with LRU cache), `createHierarchyLimiter` (org->team->user), `createScheduledLimiter` (time-based rules), `createLazyLimiter` (late init)
- **Patterns**: `throttle`, `debounce`, `createPenaltyBox` (with maxEntries + decay), `createQuota` (with maxKeys), `withCostMapping`, `withBackpressure`/`getBackpressure`
- **HTTP utilities**: `toHeaders` (draft-7 RFC 9309 / draft-6 / legacy `X-RateLimit-*`), `toErrorBody` (simple + RFC 7807), key resolvers (`byIp` with `trustDepth`, `byUser`, `byApiKey`, `byComposite`, `byCustom`, `byPath`), `shouldSkip`
- **Analytics**: `withAnalytics` wrapper, collector (ring buffer with sampling), exporters (Prometheus, JSON, CSV), `createAnalyticsStream` (AsyncGenerator)
- **Decorators**: `@Throttle`, `@SkipThrottle`, `@ThrottleCost`, `withThrottle` (function wrapper), `createDecoratorContext`
- **Testing**: `testClock` (advance/set/tick), `mockStore` (failure injection, latency, call tracking), `assertAllowed`/`assertDenied`/`exhaust` helpers, `createTestLimiter` one-liner
- **Admin**: `withOverride` (force allow/deny at runtime), `exportState`/`importState` for backup/migration
- **DX**: Key normalization (`lowercase`/`trim`/`lowercase-trim`/custom), algorithm mismatch detection, config validation with helpful error messages, `isLimiter` type guard, cache layer (`withCache`), `failMode` (open/closed) with `fallbackStore`
