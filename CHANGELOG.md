# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0](https://github.com/tzezar/throtto/compare/v1.1.0...v2.0.0) (2026-08-21)


### ⚠ BREAKING CHANGES

* All adapter-specific function names replaced with a single consistent export: rateLimit

### Features

* inline config for all adapters + createLimiter presets + docs fixes ([f1310f7](https://github.com/tzezar/throtto/commit/f1310f7ba6d56a21584aea28f0c251760ff27e88))
* **test:** add integration test runner script ([740874a](https://github.com/tzezar/throtto/commit/740874a428683e1194e3e6f414b71b10043d8594))
* unify adapter API — every adapter exports rateLimit ([8a34f49](https://github.com/tzezar/throtto/commit/8a34f49c5cf80b8463b73b8391b9d692e86f88c1))


### Bug Fixes

* **fastify:** resolve Fastify 5 plugin encapsulation issue ([a3fbfa7](https://github.com/tzezar/throtto/commit/a3fbfa72f39604b77f19b65ef3d94f8e1d86a7c5))

## [1.1.0](https://github.com/tzezar/throtto/compare/v1.0.0...v1.1.0) (2026-08-21)


### Features

* throtto 1.0.0 - framework-agnostic TypeScript rate limiting ([0fae358](https://github.com/tzezar/throtto/commit/0fae3584aeae5eda21202c8e343fc7bae43f46bf))


### Bug Fixes

* allow build scripts in CI ([c63af36](https://github.com/tzezar/throtto/commit/c63af36c316e4d2358f1e21ed3fe0daf4f12a12f))
* allow dependency build scripts via .npmrc ([9e37cf0](https://github.com/tzezar/throtto/commit/9e37cf0591d9d9689a4a4df690c9804321433ae3))
* correct repository URLs ([5c69beb](https://github.com/tzezar/throtto/commit/5c69beba5097fe944ba3e92e5eb9419f0b10a752))
* require Node.js 22+, update CI matrix ([60d65e2](https://github.com/tzezar/throtto/commit/60d65e2796b5d1a23ae1998d94d199a312c91ce4))
* skip build scripts in CI ([835d2ae](https://github.com/tzezar/throtto/commit/835d2ae9548f1f8698195b76f2e926821b11a7b4))
* use absolute URL for logo on npm ([b414c6e](https://github.com/tzezar/throtto/commit/b414c6e03c89d73c5e25d151744d865b1f991d1e))

## 1.0.0 (2026-08-21)


### Features

* throtto 1.0.0 - framework-agnostic TypeScript rate limiting ([0fae358](https://github.com/tzezar/throtto/commit/0fae3584aeae5eda21202c8e343fc7bae43f46bf))


### Bug Fixes

* allow build scripts in CI ([c63af36](https://github.com/tzezar/throtto/commit/c63af36c316e4d2358f1e21ed3fe0daf4f12a12f))
* allow dependency build scripts via .npmrc ([9e37cf0](https://github.com/tzezar/throtto/commit/9e37cf0591d9d9689a4a4df690c9804321433ae3))
* require Node.js 22+, update CI matrix ([60d65e2](https://github.com/tzezar/throtto/commit/60d65e2796b5d1a23ae1998d94d199a312c91ce4))
* skip build scripts in CI ([835d2ae](https://github.com/tzezar/throtto/commit/835d2ae9548f1f8698195b76f2e926821b11a7b4))
* use absolute URL for logo on npm ([b414c6e](https://github.com/tzezar/throtto/commit/b414c6e03c89d73c5e25d151744d865b1f991d1e))
