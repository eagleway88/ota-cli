# Tests

Run pnpm test:verify for strict TypeScript checks, formatting checks, production builds, package/type-consumer checks and all tests.

- unit/: HTTP errors, publisher resource sharing/recovery, package boundaries.
- contract/: OTA API v1 routes, HTTP verbs, JSON types, app scopes and query parameters.
- cli/: real compiled CLI subprocesses against an isolated loopback HTTP fixture.
- ws/: injected Socket.IO-compatible adapter, subscriptions, reconnection and manual ACK.
- fixtures/: controlled API/Socket substitutes and ESM/CJS TypeScript consumers.

test/run.cjs discovers only *.test.cjs; fixtures are not counted as tests.
test/verify-package.cjs is part of the build and checks exports/declarations and configuration examples.
Tests create only their own temporary ota-cli-test-* directories, close test listeners, and remove their temporary data. They do not read production configuration or invoke MySQL/OSS.
No npm publication is performed. Actual OTA API, OSS, Electron/RN runtimes and supported deployment environments require separate integration acceptance.
