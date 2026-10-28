# Cloud backend app

Read the root, [apps guide](../AGENTS.md), and [migration plan](../../specs/current/cloud-backend-boundaries.md). Stages three through eight implement HTTP/facades, business workflows, durable jobs, isolated rendering and resource commands. See the migration plan for verified guarantees and resource-source blockers.

## Process and startup ownership

- One app package has two entrypoints: `src/server.ts` for HTTP plus run jobs, and `src/renderer-server.ts` for the isolated renderer. Keep one active run worker; multiple processes do not imply replica-safe scheduling.
- Each process constructs its dependencies and registers its required bridge capabilities once. Main selects capabilities from enabled modules; renderer registers only render with the local engine implementation. Main uses the HTTP render implementation. Never configure renderer to call itself through the HTTP adapter.
- Use separate main/renderer configuration and bootstrap modules. Renderer startup must not require database URLs, Vela credentials or unrelated adapters. Avoid eager imports that initialize unrelated infrastructure.
- Capability registration checks structure. App startup separately checks supported features and resource readiness; a getCapabilities response is not universally a network health check. Clean up resources on startup failure; readiness policy belongs here.
- Executable server/renderer-server entries compose real consumers. Public startMain/startRenderer remain import-safe composition APIs. Local lifecycle is tools-dev cloud; its wrapper stays in sidecar/, outside business code. Do not add success-shaped default adapters.

## Request and background boundaries

- Routes/http own parsing, HTTP validation, cookies, error/status translation, SSE and downloads. Keep request/response objects out of biz.
- Facades are grouped by use case, not one-to-one with routes. They may call biz, registered bridge capabilities and dependencies. They select app-specific data sources, normalize and assemble facts, and execute actions decided by biz. They do not decide permissions, quota eligibility, state transitions, retry or compensation.
- Covered operations use bridge -> adapter. Facades call dependencies directly only for operations outside existing capabilities, including AMR remote project/session creation and workspace/billing protocols, all from the unified dependencies/amr provider module. This is an architectural assignment, not a fallback after a bridge error.
- User submission and background dispatch are distinct paths. The former invokes biz to create the run/message/outbox transaction; the latter executes an existing durable intent with the frozen input and idempotency key. Do not call the user submission use case from the worker.
- Jobs own polling, concurrency, ownership/lease renewal, subscription handles and graceful shutdown. Technical claim/renew operations may use bridge.db. Biz owns business completion, retry timing and recovery; completion plus outbox acknowledgement is one biz transaction.
- Worker ownership loss must stop claiming/subscriptions and notify the app lifecycle once. Executable and sidecar wrappers drain within 60 seconds and exit nonzero; adapters/jobs must not call process.exit or reset durable claims. Kubernetes owns crash restart; tools-dev does not automatically restart failed processes.
- Keep external execution outside database transactions. Pass its outcome back to biz; a later database failure must not be relabelled as an upstream execution failure.
- Renderer jobs manage bounded execution of prepared inputs via bridge.render. Engine code belongs to adapters/render; HTTP stays in this app. Preserve synchronous request/response semantics; no durable render queue or automatic replay is added in this migration.

## Identity and recovery

- Browser cookies, internal session references and credential references are distinct. Provider secrets never enter browser JSON, outbox payloads, logs, facades or biz.
- Bootstrap injects persistent auth-state storage and stable credential encryption configuration. SQL belongs to the db adapter. Runtime receives its private credential source through composition.
- Biz governs reauthorization, fixed project/workspace bindings and the effect of logout on tasks. A temporary provider outage is not logout; missing credentials are not proof that a remote run failed.
- Rebuild subscriptions and scheduling from committed records after restart. Do not reset live leases or reinterpret unknown upstream results as safe new submissions.
- Readiness is not blocked on every user's login. Pause only work requiring unavailable authorization. Stop claiming on shutdown, drain within a bound, and do not equate aborting local I/O with cancelling the remote run.

## Scope and validation

- Leave apps/daemon unchanged and do not import its private source. Prefer existing shared packages and migrate only POC-used functionality. Preserve explicit unsupported responses for unimplemented compatibility endpoints.
- App tests belong in `tests/`, sibling to `src/`. Cross-process/app integration belongs in e2e under its own guidance. Use focused checks; do not run full daemon/web suites for this migration without an explicit request.
