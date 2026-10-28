# Shared backend business layer

Read the root guide and the [cloud migration plan](../specs/current/cloud-backend-boundaries.md). This is the single root business package, registered in the workspace. Account/workspaces/billing, project/conversation, runs/journal, catalog/prompts, files/attachments, exports and public metadata now have concrete consumers.

## Ownership and dependencies

- Own account mappings/privacy, workspace authority, billing interpretation/admission, project/conversation lifecycle, prompts, resource binding, files/attachments, exports, run/message/event state, idempotency, retry and recovery decisions.
- Use registered bridge capabilities for infrastructure. Do not import apps, concrete adapters, dependencies/vendor clients, or HTTP/CLI transports. App-specific data sources are assembled by facades and passed as facts or external outcomes. Do not branch on cloud/local deployment inside business rules.
- Shared app DTOs belong in packages/contracts; capability and persistence interfaces belong in packages/bridge; vendor DTOs belong in packages/dependencies. Do not put SQL, pg connection types or Express objects in business interfaces.
- Remote project/session creation is an external step in a business creation workflow. Runtime operates on existing references; renaming creation methods does not make them runtime capabilities.

## Transactions and durable workflows

- The business use case owns the transaction boundary. Collaborating modules receive the same required transaction handle; never accept an optional tx that silently falls back to an autocommit connection, nest independent transactions, or rebind the global bridge.
- For submission, atomically persist the run, original user message, project active-run state, outbox intent and events. Freeze model input and selected resources once. Use scoped client idempotency keys plus database constraints; repeated equal input returns the original run and changed input conflicts.
- Keep HTTP/CLI/runtime execution outside database transactions. Record intent, execute through a facade, then re-lock/recheck state and commit the outcome. Do not copy the POC's in-transaction runtime.recover call.
- Commit result handling must distinguish rolled back from commit outcome unknown. Confirm uncertain writes by stable identity; never blindly replay callbacks containing external or irreversible effects.
- Outbox completion is not run completion. Atomically apply business results, events, subsequent intents and acknowledgement; check claim token and re-enqueue generation where applicable. Preserve consistent lock ordering.
- Normal status polling is not a failed attempt. Biz decides retry eligibility, budgets, backoff, next available time and recovery; jobs only schedules persisted decisions. Unknown remote outcomes cannot be marked terminal solely because a retry budget expired.
- Events become externally visible only after commit. Merge messages/events with persistent cursor and deduplication; snapshots cannot rewind newer committed progress without an explicit guarded recovery.

## Authorization and recovery

- Store task authorization references with a stable principal, provider environment and original workspace binding. Never store cookies or provider secrets in business records or use the browser's currently selected workspace as recovered-task authority.
- Read credential authorization metadata through db.credentials.authorization when deciding whether an explicit logout forbids rebinding. Do not read ciphertext or decrypted secrets in biz.
- Account/session/credential state determines whether new upstream actions are allowed, not whether an already-running remote task has terminated. Record waiting-for-reauthorization separately from remote task status.
- On re-login, validate stable identity and original workspace permission before rebinding eligible work. Do not automatically restart terminal runs or explicitly stopped/revoked work.
- Workspace/billing facts may require freshness checks. POC Vela admission is not a debit or ledger reservation; do not invent settlement or copy non-transactional in-memory proof consumption as an atomic database write.

## Scope and checks

- Reuse shared packages first. Needed daemon-private pure logic may be adapted here without changing daemon source or call paths; cross-app private imports are forbidden.
- Only migrate behavior used by POC. Keep tests in tests/, not src/. Focus on invariants: transaction failure, concurrency, idempotency, unknown outcomes, cancellation, authorization expiry and cursor recovery.
