# External dependency protocols

Read the root, [packages guide](../AGENTS.md), and [cloud migration plan](../../specs/current/cloud-backend-boundaries.md). Subpaths amr, renderer, github and filesys implement external protocols only; the root exports errors. AMR project/session calls have real facade consumers, while complete creation flows remain in biz. Filesys receives prepared packages from build/publish scripts and never imports business code.

- AMR and Vela are one provider module under amr/. Export independently constructed auth, authorization, workspace, billing, project, runtime, file and resource clients through that entrypoint. Keep apiUrl, webUrl and runtimeUrl distinct; preserve control-key versus Runtime-grant authority, wire headers, error codes and refresh semantics. Do not restore a parallel vela subpath.
- Use one package for provider/service protocols; do not create a separate package for the renderer transport. GitHub public metadata is limited to the fixed anonymous endpoint used by POC. Do not add a package.json per provider or scaffold unused CLI/provider clients.
- Own provider-specific URLs, request/response DTOs, protocol parsing, bounded transport behavior and protocol errors. Generated upstream schemas belong here, not in shared app contracts.
- Facades and adapters may consume this package. It must not depend on biz, bridge, adapters or app-private implementation.
- Do not decide ownership, workspace selection, quota eligibility, task state, persistence, retry/compensation policy or HTTP responses to the Open Design frontend.
- AMR remote project/session creation and Vela workspace/billing calls are protocol operations here. Their complete workflows and decisions remain in biz, connected by app facades.
- For runtime/file/auth capabilities, raw protocol helpers are consumed by the matching adapter; facades must not bypass an existing bridge capability to call the same operation here.
- Receive credentials, transports and any future CLI runner explicitly through server-side composition. Do not read browser cookies, global current-user state or application credential files. A future CLI implementation must use an injected runner; do not add it for the current HTTP-only cloud migration.
- DependencyError and HttpFailure are protocol errors, independent of BridgeError. Adapters map code, uncertain, requestId and HTTP status at their boundary. Do not import bridge even for error types.
- Report known rejection versus unknown mutation outcome accurately. Do not add automatic mutation retry loops that compound biz retries or manufacture undocumented provider endpoints/idempotency guarantees. Preserve the existing AMR exception: one replay after an explicit first 401 using an injected authorization callback and the same deadline; the client owns no grant cache.
- Tests belong in tests/, sibling to src/. Use fake transports and protocol fixtures; do not send live login requests or real mutations in unit tests.
