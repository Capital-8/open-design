# Backend bridge boundary

Follow the root and [packages guide](../AGENTS.md). The [migration plan](../../specs/current/cloud-backend-boundaries.md) records target behavior and implementation gaps.

## Contract ownership

- The approved capabilities are db, file (singular), proc, auth, runtime and render. Storage was renamed to db and means database persistence, not files. Ask for explicit approval before adding another capability; identify its concrete consumer. Do not add vendor capabilities such as amr or vela.
- This package defines pure TypeScript interfaces, error/state semantics, startup registration and forwarding. It owns no external I/O, vendor clients or app-specific process profiles. Keep Node, database driver, Electron and HTTP-framework types out of public interfaces.
- Implementations live in the single root adapters package. Every public change must update matching interfaces, arguments, states/errors, startup validation, forwarding, implementation and meaningful tests together. Private composition/protocol helpers need not become public methods.
- Biz owns project/session creation, permissions, workspace binding, prompts, task state, persistence decisions, retry and compensation. Runtime operates on existing references; do not add createProject/createSession, renamed execution-creation methods or implicit submit-time creation.
- Auth exposes login facts and protocol operations, not cookie policy, login-before/after behavior, workspace or billing workflows. Execution authorization remains private to runtime; public methods never return provider tokens.
- Render accepts prepared inputs and returns bytes. Content access, product policy and downloads belong to apps/biz. This bridge is unrelated to sidecar control-plane or desktop host-bridge contracts.

## Registration

- Apps declare requirements from enabled consumers, independently from the supplied bindings. There is no universally mandatory db/file/proc set in the approved design. Renderer may register only render.
- Register once per process/module instance before accepting work. Main and renderer have independent bindings; API and jobs sharing one process share one registration. Do not add per-request rebinding or a production reset hook.
- Every supplied capability must implement its complete interface. Missing required capabilities, incomplete implementations and unknown names fail registration atomically. Preserve method receivers and captured bindings; do not leave partial registration after failure.
- All forwarding objects, including db/file/proc, must explicitly reject calls before registration or to an omitted capability. Missing capability is not an instruction to fall back to dependencies or return an empty success.
- Bridge validates contract structure. Apps separately validate supported features and readiness. Do not infer service health from method presence or hard-code cloud process names here.
- `register(bindings, { required })` requires an explicit capability list, including an explicit empty list for consumers with no bridge needs. Render-only registration is supported. App bootstrap separately checks support/readiness before starting consumers; failure after registration requires a fresh process, never registry reset.

## Database target

- Provide typed, narrow record access and a transaction callback carrying transaction-bound operations. Biz opens the transaction; the adapter binds all operations to one physical connection and transaction. Do not expose raw pg clients or a generic raw SQL escape hatch.
- Transaction handles must not silently fall back to the global connection, open independent nested transactions or remain usable after completion. Separate read access from transactional writes.
- Define conflicts, missing records and commit-outcome-unknown explicitly. Successful return means commit is confirmed. Structural registration checks do not prove transaction semantics; verify those against the adapter.
- The transaction covers the business database only. Readonly catalog SQLite, files and Vela/AMR calls are outside it.
- db now provides typed record repositories and a transaction callback; file covers project content/directory/conditional writes and indexed bundled reads; proc remains unused by cloud. Complete only actual POC requirements. Do not replace daemon lifecycle guarantees with a raw spawn or force unused proc implementations into renderer.

## Validation

Tests live in tests/, sibling to src/. Use isolated module instances rather than runtime reset APIs. Cover renderer-only registration, missing requirements, incomplete/unknown capabilities, atomic failure, repeated registration and unavailable-capability calls. Validate each changed public contract with the matching adapter.
