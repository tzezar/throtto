# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0 (2026-08-21)


### Features

* throtto 1.0.0 - framework-agnostic TypeScript rate limiting ([25002d0](https://github.com/tzezar/throtto/commit/25002d0e7f840476ebc37c8de8858ff2a13d7d60))


### Bug Fixes

* allow build scripts in CI ([61eed53](https://github.com/tzezar/throtto/commit/61eed5370a210cc2bd26f533090285576c302393))
* allow dependency build scripts via .npmrc ([2c1009b](https://github.com/tzezar/throtto/commit/2c1009b4a7272d498e79b6e8cdf7c57162dfb861))
* require Node.js 22+, update CI matrix ([3620c92](https://github.com/tzezar/throtto/commit/3620c921bd6e73ab25e0829a41234499f1b662fb))
* skip build scripts in CI ([58b6df1](https://github.com/tzezar/throtto/commit/58b6df1ed9f5af5e129bcb0ae6c2f808cedee440))

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
