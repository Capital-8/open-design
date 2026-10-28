# Share/comment local mainline

`ui/share-mainline.test.ts` covers six capability checkpoints in three independently seeded local CI
workflows: public publish → update → stop/resume; bidirectional comments with
identity and reload checks in each direction; read-only publication denial.
A failed workflow must not be reported as passing its unexecuted later steps.
It starts two real Open Design Web/daemon runtimes via the existing tools-dev
cluster, with independent SQLite/data roots and browser contexts. No product
HTTP route is fulfilled by Playwright. Provider generation is not used.

The temporary Vela executable and AMR hub are external-service fixtures.
The HTTPS receiver serves the actual immutable files copied by resource push;
it is **not** the production AMR Viewer. Comment directions currently exercise
member OD Web client ↔ owner OD Web client, not public Viewer ↔ packaged app.
Consequently a green local CI run does not finish the original six-case live
acceptance suite, and cannot validate server permission enforcement, Go CLI,
DB migration, cloud comment page, packaging or long-timeout behavior.

The checked-in private key and certificate are public, synthetic localhost
fixtures, generated only for this test service. They are not credentials and
must never be reused outside an isolated loopback test server.

Use repository Node 24 and pnpm 10.33.2. From `e2e/`:

```sh
pnpm exec playwright install chromium
pnpm exec playwright test -c playwright.config.ts ui/share-mainline.test.ts --workers=1 --retries=0
```

The browser uses Playwright's unique temporary profile, mock keychain and
Chromium sandbox. Playwright closes the owned browser; afterAll stops only the
owned tools-dev namespaces and temporary service. Failures preserve evidence.
CI enrolls this file in the existing single-worker `project-collab` group in
`e2e/lib/playwright/suites.ts`. The workflow topology and dependencies are
unchanged. CI executes one pass; the five local repeats are measurement only.
For a complete CI measurement, dispatch `ci.yml` with `ci_mode=full` and leave
`workloads` empty, then record the actual executed and skipped jobs.

The harness warms the two isolated servers' immutable UI shells concurrently,
inside the measured startup lifecycle. It does not share build/data/browser
state between clients. Only preparation navigates to the project/file. Publish and comment actions
operate on that already-open surface, including after canonical URL changes;
explicit persistence reloads remain mandatory.
The two clients may load a committed team snapshot and open their comment
panels concurrently. Tests keep independent projects and do not depend on a
previous test. Phase timings and outcomes are attached to each result.

For timing comparisons, include fresh command startup, shell compilation and
cleanup; exclude installation/downloads consistently. Report workflow counts
separately from the six checkpoint counts. The previous six-test baseline and
the three-workflow implementation retain the same six capabilities, but are
not six independently initialized tests anymore. Do not compare test-body
sums alone: concurrent shell warmup moves compilation into startup, while
still counting it in the complete command.
