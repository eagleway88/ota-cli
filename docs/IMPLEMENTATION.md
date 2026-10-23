# OTA API v1 implementation

- [x] Separate App and Manage contracts, transport and API Key authentication.
- [x] Application-aware Socket SDK and reconnection lifecycle.
- [x] Shared-artifact publishing, per-stage recovery, release CLI.
- [x] Query/message CLI, complete tests, examples and package verification.

This branch targets 1.0.0. Only /api/v1 contracts are exposed.
Database provisioning and API Key administration remain server-local operations.
No npm publication is performed by development or verification commands.

Verification: strict TypeScript, formatting, production build, ESM/CJS declaration consumers, browser bundles and all 45 tests pass on Node.js 22. The npm dry-run contains only dist, README and package.json (38 entries). Test services are isolated local fixtures; actual OTA API/OSS/Electron/RN integration remains deployment acceptance work.
