# Backend adapters

Follow the root and [bridge guide](../packages/bridge/AGENTS.md). The [migration plan](../specs/current/cloud-backend-boundaries.md) owns the target tree, source mapping and order.

## Package and dependency boundaries

- This directory is one workspace package, @open-design/adapters. Do not add a package.json per capability. Use capability subpaths without an eager root barrel or unrelated startup side effects.
- Public capabilities correspond to bridge interfaces, arguments, states and errors. Change contract, registration validation, forwarding, implementation and meaningful tests together. Private helpers do not require public bridge methods.
- Adapters implement equivalent capability goals across environments. Provider-specific protocol helpers belong in packages/dependencies; adapters normalize their results into bridge contracts. Neither adapters nor dependencies own business workflows.
- Do not import biz or app-private source. Inject configuration, credential sources and storage dependencies through bootstrap. Do not modify apps/daemon in this migration.
- Current implementations are Vela device auth, AMR runtime and HTTP rendering, using matching packages/dependencies protocol clients. Auth, runtime and file all import the single dependencies/amr provider module; their public factories/options, bridge interfaces and behavior remain unchanged. Adapters retain login state, private credential/grant caches, scope/reference validation, capability/result normalization and bridge error mapping; endpoint requests and provider DTO parsing belong in dependencies. The internal transport wrapper only preserves injected bridge failures without making dependencies import bridge. PostgreSQL db now provides record access, transaction lifetimes, migration checksums and fenced outbox operations. Persistent auth stores AES-GCM credentials and distinguishes explicit logout from provider invalidation; file implements AMR and digest-verified bundled reads; local render owns Chromium/FFmpeg with blocked external I/O. Readonly catalog SQLite is a build snapshot outside business transactions. Proc is implemented only when a real cloud consumer requires it; no success-shaped placeholders.

## Capability ownership

- db owns connections, SQL, schema migrations, transaction execution, atomic claims and conditional writes. Biz decides what must be atomic. Transaction-bound operations share one connection; never downgrade transaction semantics or blindly retry a callback after an unknown commit.
- Preserve applied migration numbers and checksums. Use new migrations for sessions, encrypted credentials, authorization references and recovery fields. Business storage must not write to Vela's authentication database.
- file owns file I/O, directory queries and conditional saves for declared references. Project access rules and edit lifecycle remain in biz. Preserve POC attachment database storage unless a separate change authorizes another backend.
- auth owns protocol/login facts and private credential handling. Use injected persistent storage backed by db capability; keep SQL in the db adapter. Apps own cookies; biz owns account effects and task reauthorization. Secrets never enter public DTOs or logs.
- runtime submits, queries, cancels, recovers and observes existing execution references. Project/session creation, workspace and billing policy, prompt composition, run/message state, retry and compensation remain outside it, including under renamed creation methods.
- Runtime receives a private credential source. Validate principal, environment, current credential revision and the fixed workspace scope; never select any available session merely by user ID. Short-lived grants may be cached, but persisted expiry/revocation remains authoritative.
- render provides separate HTTP and local-engine implementations. Main uses HTTP; isolated renderer uses the local engine. Engine browser/temp/encoder internals do not automatically require public db/file/proc registrations. Any real cross-capability dependency must be explicit.
- Renderer accepts prepared inputs and returns bytes. No durable render queue is introduced; a timeout or local abort does not prove remote execution stopped.

## Error and lifecycle semantics

- Preserve known rejection versus uncertain external writes. Do not add product retry/compensation loops; the currently documented one-time authorization refresh after explicit upstream 401 is a protocol-level exception.
- Cancel acceptance is not confirmed termination; closing an event stream is not cancelling a run. Unsupported functionality and temporary unavailability are distinct.
- Auth transport failure is not logout. Commit completed session/credential associations before reporting login success. Persistent revocation checks must prevent stale in-flight authorization results from reviving a revoked credential.
- Keep factory initialization and cleanup explicit so app startup can validate only its enabled capabilities. Runtime caches are not durable state or inter-process synchronization.

## Validation

Tests live in tests/, sibling to src/. Use fake transports/clocks and targeted database integration for protocol races, transaction atomicity, idempotency, claim fencing, authorization revocation, unknown outcomes, event cursors and render limits. Unit tests must not perform live login or real upstream mutations. Cross-process acceptance belongs in e2e under its guide.
