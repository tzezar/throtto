# throtto Examples

Step-by-step guides showing how to use throtto in real scenarios.

| Example | What you'll learn |
|---|---|
| [Basic rate limiting](./basic.md) | `rateLimit()`, check/consume/peek/reset, presets, cost, key normalization |
| [Express integration](./express.md) | Middleware setup, inline config, custom keys, per-route limits |
| [Composition](./composition.md) | `pipe()`, wrappers, override, dry-run, production setup |
| [Storage adapters](./stores.md) | Memory, Redis, Upstash, PostgreSQL, cache layer, schema generation |
| [Testing](./testing.md) | `createTestLimiter`, controllable clock, mock store, Vitest examples |
| [Advanced limiters](./tiered.md) | Compound, tiered, dynamic, hierarchy, scheduled, lazy |
| [Custom adapter](./custom-adapter.md) | Write your own framework adapter (~30 lines) |

For detailed API documentation, see the [`docs/`](../docs/) directory.
