# Contributing to throtto

Thank you for your interest in contributing to throtto! This document provides guidelines and instructions for contributing to this TypeScript rate limiting library.

## Getting Started

1. **Fork & clone** the repository
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Git hooks are installed automatically via `lefthook` (runs on `pnpm install` via `prepare` script). Pre-commit runs lint + typecheck, pre-push runs tests + build.
4. Verify everything works:
   ```bash
   pnpm run test && pnpm run typecheck && pnpm run build
   ```

> **Requirements:** Node.js >= 20, pnpm

## Development Commands

| Command                | Description                          |
| ---------------------- | ------------------------------------ |
| `pnpm run test`        | Run all tests (vitest)               |
| `pnpm run test:watch`  | Watch mode                           |
| `pnpm run test:coverage` | Tests with coverage report         |
| `pnpm run typecheck`   | Type checking (`tsc --noEmit`)       |
| `pnpm run build`       | Build (`tsup`)                       |
| `pnpm run lint`        | Lint (`biome check`)                 |
| `pnpm run format`      | Format (`biome format --write`)      |
| `pnpm run bench`       | Run benchmarks                       |
| `pnpm run size`        | Check bundle size (fails if > 15KB)  |

## TypeScript Constraints

This project uses strict TypeScript settings that you **must** follow. Builds and CI will fail otherwise.

### No Global Node Types (`"types": []`)

The `tsconfig.json` sets `"types": []`, which means no global Node.js types (like `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`) are available. If your code uses any of these, add a `declare function` statement at the top of the file:

```typescript
declare function setTimeout(callback: () => void, ms: number): number;
declare function clearTimeout(id: number): void;
declare function setInterval(callback: () => void, ms: number): number;
declare function clearInterval(id: number): void;
```

### Exact Optional Property Types (`exactOptionalPropertyTypes: true`)

Optional properties must explicitly include `| undefined` in their type when the value can be `undefined`:

```typescript
// ✅ Correct
interface Options {
  timeout?: number | undefined;
}

// ❌ Wrong - will cause a type error
interface Options {
  timeout?: number;
}
// assigning { timeout: undefined } to this type will fail
```

### Verbatim Module Syntax (`verbatimModuleSyntax: true`)

Use `import type` for type-only imports. TypeScript will error if you import a type using a regular import:

```typescript
// ✅ Correct
import type { Algorithm } from "./types.js";
import { someFunction } from "./utils.js";

// ❌ Wrong
import { Algorithm } from "./types.js";
```

### ESM Import Extensions

This is an ESM-only package (`"type": "module"`). All relative imports **must** use `.js` extensions, even when importing `.ts` files:

```typescript
// ✅ Correct
import { tokenBucket } from "./algorithms/token-bucket.js";

// ❌ Wrong
import { tokenBucket } from "./algorithms/token-bucket";
import { tokenBucket } from "./algorithms/token-bucket.ts";
```

## Project Structure

```
src/
  core/       - types, errors, duration, clock, result, pipe, guards
  algorithms/ - 7 algorithm implementations
  stores/     - memory, redis, upstash, postgres, mysql, sqlite
  limiter/    - createLimiter, presets, composition wrappers, advanced limiters
  patterns/   - throttle, debounce, backpressure, penalty-box, quota, cost
  http/       - headers, key-resolvers, skip
  adapters/   - 18 framework adapters
  analytics/  - withAnalytics, collector, exporters, stream
  decorators/ - @Throttle, @SkipThrottle, @ThrottleCost
  testing/    - testClock, mockStore, helpers, createTestLimiter
  cli/        - schema generation CLI
tests/        - mirrors src/ structure
```

## How to Add a New Algorithm

1. Create `src/algorithms/my-algorithm.ts` implementing the `Algorithm<TState>` interface
2. Export from `src/algorithms/index.ts`
3. Add to `rateLimit()` presets in `src/limiter/presets.ts`
4. Re-export types from `src/index.ts`
5. Add tests in `tests/algorithms/my-algorithm.test.ts`

```typescript
// src/algorithms/my-algorithm.ts
import type { Algorithm } from "../core/types.js";

interface MyAlgorithmState {
  // ...
}

/**
 * My algorithm description.
 *
 * @example
 * ```typescript
 * const algorithm = myAlgorithm({ limit: 10, window: "1m" });
 * ```
 */
export function myAlgorithm(options: MyAlgorithmOptions): Algorithm<MyAlgorithmState> {
  // ...
}
```

## How to Add a New Store

1. Create `src/stores/my-store.ts` implementing the `Store` interface
2. Add an export entry in `package.json` under `"./stores/my-store"`
3. Add a corresponding entry in `tsup.config.ts`
4. Re-export from `src/index.ts`
5. Add tests in `tests/stores/my-store.test.ts`

## How to Add a New Framework Adapter

1. Create `src/adapters/my-framework.ts`
2. Accept a config object following the existing pattern:
   ```typescript
   interface MyFrameworkOptions {
     limiter?: Limiter | undefined;
     limit?: number | undefined;
     window?: Duration | undefined;
     skipPaths?: string[] | undefined;
     skipMethods?: string[] | undefined;
     // ...
   }
   ```
3. Use `shouldSkip()` from `src/http/skip.ts` for path/method skipping
4. Use `toHeaders()` and `toErrorBody()` from `src/http/headers.ts` for standard rate limit response headers and error bodies
5. Add an export entry in `package.json` and `tsup.config.ts`
6. Add tests in `tests/adapters/my-framework.test.ts`

## Code Style

- **Biome** handles formatting and linting - run `pnpm run lint` and `pnpm run format` before submitting
- **Functional composition API** - no classes for core APIs
- **JSDoc required** - every exported function needs JSDoc with at least one `@example`
- **Zero runtime dependencies** in core - external dependencies are only allowed in store and adapter packages

## Pull Request Process

1. **Open an issue first** for significant changes to discuss the approach
2. Create a feature branch from `main`
3. Make your changes with tests
4. Ensure all checks pass:
   ```bash
   pnpm run test && pnpm run typecheck && pnpm run lint
   ```
5. Submit a PR with a clear description of the changes

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/) - this drives automatic versioning and changelogs via [release-please](https://github.com/googleapis/release-please):

- `feat:` - new feature (bumps minor version)
- `fix:` - bug fix (bumps patch version)
- `feat!:` or `BREAKING CHANGE:` - breaking change (bumps major version)
- `perf:` - performance improvement
- `docs:` - documentation changes
- `test:` - adding or updating tests
- `chore:` - maintenance tasks
- `refactor:` - code restructuring without behavior changes

On merge to `main`, release-please opens a Release PR that accumulates changes. Merging that PR publishes to npm automatically.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
