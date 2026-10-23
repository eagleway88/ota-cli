# Architecture

- contracts/: public protocol types and local structural validation.
- transport/: canonical API URL, API Key handling, error normalization and request metadata; no automatic write retries.
- app/: public client checks/reports; no credentials or management operations.
- manage/: application-bound backend operations.
- node/: directory packing, SHA-256 resource reuse, per-stage publication state and bounded task waiting.
- ws/: explicit adapter, desired subscription state, reconnection and application-isolated messaging.
- cli/: configuration/profile resolution, commands and redacted JSON/diagnostic output.

One npm package exposes separate App / Manage / Node / Socket entry points. Node and CLI imports do not enter the App/Socket bundles. The CLI calls SDK operations instead of defining a second protocol.

Shared resources are keyed by canonical API root + exact app name + final ZIP digest within one Publisher instance. Source directories are prepared once per real path. Resources may be reused by multiple policy-specific releases in the same application. There is no cross-application or permanent implicit resource cache.

Publication states precede each network write. Draft creation uses the saved idempotency key; publishing uses the saved release ID. Source/intent/server identity is checked before resume. Upload responses cannot be recovered through an artifact query API, so unknown upload outcomes require human review. File locks prevent concurrent use of the same state file; a stale lock is never removed automatically.

The tool does not provide database access, API Key administration, global audit HTTP access, server file logs, or a management UI. Those remain outside the outward-facing tool's authority.
