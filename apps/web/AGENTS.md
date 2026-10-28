# apps/web/AGENTS.md

Read the root `AGENTS.md` and `apps/AGENTS.md` first. This file owns the web
application's desktop/web reuse and build-selection rules. More specific
directory guidance, including `src/components/chat/AGENTS.md`, still applies.

## Shared code and environment variants

- Keep components, hooks, and frontend logic unchanged when the same
  implementation works in both targets. Do not create two copies merely
  because two deployment environments exist.
- When behavior differs, move the smallest differing component or operation
  into a directory named after the feature, with desktop and web implementations
  and one public `index.ts`. Do not accumulate environment branches in a single
  component or function, or duplicate a large shared page to isolate a small
  difference.
- Component variants use `Desktop.tsx` and `Web.tsx` (spell `Desktop` exactly).
  Logic without JSX uses `desktop.ts` and `web.ts`; use `.tsx` only for JSX.
  Put genuinely common code and types in optional `shared.ts` and `types.ts`.

```text
src/components/
  SharedButton.tsx             # compatible: keep one implementation
  Mail/
    index.ts                  # stable public export
    Desktop.tsx
    Web.tsx
    types.ts                  # optional shared props
src/runtime/
  createProject/
    index.ts                  # stable public export
    desktop.ts
    web.ts
    types.ts                  # optional shared inputs/results
    shared.ts                 # optional shared implementation
```

- Once a feature is split, remove the competing `Mail.tsx` or
  `createProject.ts` entry. Consumers import the directory entry, never its
  `Desktop`, `Web`, `desktop`, or `web` file. Build configuration and focused
  variant tests may address implementations directly.
- Both variants must satisfy the same public exports, props or function
  signatures, return semantics, and error contract. Shared helpers must not
  import the public entry or the other variant. Shared API DTOs still belong
  in `@open-design/contracts`.
- If a feature exists in only one target, the other UI variant may explicitly
  render nothing. A callable unsupported operation must report unsupported
  behavior through its contract, never pretend that a write or export succeeded.

## Select implementations during the build

`build/target.ts` owns discovery and resolution; `build/cli.ts` wires package
commands. The resolver scans `src/` for the complete variant directories above.
Adding a pair creates `@web-target/<directory relative to src>` automatically;
restart the dev server after adding/removing a pair so configuration is reloaded.
For the isolated web project, also restart after changing route file topology
under `app/`; edits to already linked route files continue to use hot reload.

- Use one explicit build target, `desktop` or `web`, supplied by the build/dev
  command using `--target desktop|web` or `OD_WEB_TARGET`. Explicit command
  arguments take precedence. Existing package commands default to `desktop`
  for compatibility; invalid or empty values fail. `tools-dev` uses
  `--web-target` and the same environment variable. Keep selection outside `src/`.
- Keep one authoritative mapping from feature entry to selected implementation.
  Prefer static module aliases resolved by the bundler. Each feature's `index.ts`
  re-exports its selected alias; it must not import both variants and choose
  between them at runtime. For example, after creating the Mail pair:

  ```ts
  // Mail/index.ts
  export { Mail } from '@web-target/components/Mail';
  export type { MailProps } from './types';
  ```

  Build tooling maps this to `Mail/Desktop.tsx` or `Mail/Web.tsx`. The operation
  example uses `@web-target/runtime/createProject`. Include the directory path
  in the alias so equally named features do not collide.
- Do not add `isDesktop`, `isWeb`, `isCloud`, user-agent/host sniffing, or
  `process.env.NEXT_PUBLIC_*` target switches to frontend components, hooks,
  business logic, or their index files. A runtime registry, ternary selecting
  two imports, or dynamic import of a computed environment path is not a
  substitute for build selection. Migrate existing switches with their feature.
- Keep Next development and production resolution aligned. Package builds use
  Turbopack; `tools-dev` currently defaults to webpack and can opt into
  Turbopack with `OD_WEB_DEV_BUNDLER`. Both use the same discovered map, as do
  generated TypeScript paths and Vitest aliases. Use the target-aware package
  typecheck command rather than invoking `tsc` against the base config directly.
- Only the selected variant may be reachable through the production module
  graph. Do not barrel-export both implementations or import desktop-only
  dependencies from shared files and rely on a hidden button/tree-shaking.
- Separate output/cache identity by build target, including generated module
  maps and TypeScript incremental state where applicable. Do not overwrite
  tracked `index.ts` files during builds: concurrent targets must not race over
  shared source. Read `tools/pack/AGENTS.md` and `tools/pack/CACHE.md` before
  changing packaged build/cache behavior.
- Target selection is fixed for an artifact. Changing a server environment
  variable after deployment cannot switch its compiled frontend. Both dev
  launchers and packaged/cloud build callers must propagate the intended target
  explicitly; retain the root lifecycle command rules. `tools-pack` fixes the
  target to `desktop` and includes it in its build-cache identity.

### Commands and output ownership

```bash
pnpm tools-dev run web --namespace desktop-dev --web-target desktop
pnpm tools-dev run web --namespace browser-dev --web-target web
pnpm --filter @open-design/web build --target desktop
pnpm --filter @open-design/web build --target web
pnpm --filter @open-design/web typecheck --target desktop
pnpm --filter @open-design/web typecheck --target web
pnpm --filter @open-design/web test --target web tests/build/target.test.ts
```

- Use distinct namespaces for simultaneously running dev targets. An existing
  server with the other target is rejected instead of silently reused.
- Desktop production retains `apps/web/.next` and `apps/web/out` for existing
  packagers. Web production uses the isolated Next project at
  `.tmp/web-targets/web/build/project/` under the workspace root; static exports
  are its `out/`, and Next cache/server output is its `.next/`. Deploy the
  selected target's output, not whichever `out/` happened to exist previously.
- The isolated project links source inputs and generates its own config entry;
  it does not fork application source. This also isolates `next-env.d.ts` and
  Next's static-export intermediate cache, which `distDir` alone cannot do.
- Generated typecheck config/incremental state and Vitest cache live under
  `.tmp/web-targets/<target>/typecheck/` and `vitest/`. Dev output and generated
  config use the existing tools-dev namespace plus the target. These are all
  ignored outputs; never commit them or use them as package source-hash inputs.

## Preserve runtime and backend boundaries

- `desktop`/`web` is a product build choice. It is independent of
  `NODE_ENV`, static export versus server/standalone output, Next server versus
  browser execution, release channel, and API origin. Do not infer one from
  another. Electron's renderer also executes browser JavaScript.
- Preserve the supported browser-to-local-daemon flow. Do not assume every
  browser talks to cloud or every local backend has an Electron host. When
  assigning existing behavior to targets, cover this flow explicitly; keep
  host-bridge validation and unavailable-method handling in the narrow host
  integration boundary instead of spreading environment flags through UI.
- Build selection does not replace runtime state: sign-in, authorization,
  account/workspace changes, feature availability, cancellation, and actual
  failures still need handling. Browser-global guards for safe evaluation are
  allowed at integration boundaries, not as a second product-target selector.
- Desktop renderer variants still call `@open-design/host` for privileged host
  operations and HTTP providers for backend operations. Neither variant may
  import daemon private source, database drivers, Node filesystem/process APIs,
  or the backend `@open-design/bridge` registry into the browser bundle.
- Preserve Next App Router entry filenames and existing client boundaries;
  select variants below those entries. Do not introduce browser-global side
  effects into modules evaluated during server rendering or static generation.
- An API-origin/proxy change belongs to deployment or server configuration.
  If an HTTP operation has compatible semantics in both backends, keep its
  frontend implementation shared instead of splitting it just for the URL.

## Migration and verification

- Establish build resolution before migrating a feature. Then extract the
  differing behavior, keep the public import stable, move its callers to that
  entry, and remove its old environment switch in the same migration.
- Preserve semantics while moving code: login popup activation and cleanup,
  session handoff, export cancellation/error/fallback behavior, preview sandbox
  boundaries, and server-authoritative authorization must not change merely
  because the files moved.
- Keep tests in `apps/web/tests/`, following root test ownership rules. Test
  both implementations and the public entry under each target. Tests that
  mutate a frontend environment flag at runtime must become separate target
  runs or direct implementation tests; built artifacts cannot switch targets.
- For a resolver migration, validate focused tests, type checking, and both
  target builds, including absence of the unselected implementation from each
  production dependency graph. Exercise affected flows in Electron, cloud web,
  and browser-to-local-daemon where applicable. Do not run the full web suite
  locally unless requested, per the root instructions.

### Current feature entries

- `runtime/cloud-device-login/`: device authorization lifecycle; local host-owned
  authorization versus browser popup and session handoff.
- `runtime/amr-funding-feedback/`: local funding hints/cache versus server-owned
  cloud admission. The web result stays `unknown`, never fabricated approval.
- `runtime/exports/`: shared export helpers plus selected PDF/MP4 handling and
  archive/renderer error policy. Consumers keep importing `runtime/exports`.
- `components/MessageFilePreview/`: unchanged message DOM in desktop and sandboxed
  project-file preview in web. `Preview.tsx` is private to the web implementation.
- `components/MotionExportButton/`: web MP4 control; desktop renders nothing.

Implementation tests live under `tests/runtime/<feature>/desktop.test.ts` and
`web.test.ts`, or `tests/components/<Feature>/desktop.test.tsx` and `web.test.tsx`.
They import concrete variants; genuinely common helper tests use `shared.test.ts`.
Both implementations run in the normal suite regardless of the selected target.
Consumer fixtures may inject implementations explicitly.

`tests/targets/` owns real public-entry and consumer integration tests. Keep
feature entries and their aliases real; mock HTTP, browser/host boundaries, or
unrelated UI chrome only. Run this directory in separate desktop and web
processes. Tests may inspect the startup target to assert its expected behavior,
but must not change it mid-process. `vi.stubEnv()` remains appropriate for
configuration inputs such as the authorization origin, never target selection.

CI's existing two web shards run the desktop suite and the web entry suite.
Shard 1 then builds desktop, shard 2 builds web; each verifies its fresh browser
bundle with `OD_WEB_VERIFY_BUILD=1` and `tests/build/production-artifact.test.ts`.
The small resolver fixture remains in `tests/build/target-build.test.ts` to check
mapping/cache behavior independently of product code. Keep all execution steps
in the corresponding convergence success contract so cached validation cannot
omit target checks.

```bash
pnpm --filter @open-design/web test --target desktop tests/runtime/cloud-device-login tests/runtime/amr-funding-feedback tests/runtime/exports tests/components/MessageFilePreview tests/components/MotionExportButton tests/targets
pnpm --filter @open-design/web test --target web tests/targets
OD_WEB_OUTPUT_MODE=export pnpm --filter @open-design/web build --target web
OD_WEB_VERIFY_BUILD=1 pnpm --filter @open-design/web test --target web tests/build/production-artifact.test.ts
```

### Native host integration entries

Host detection and native action imports belong only in selected `desktop.ts`
or `Desktop.tsx` implementations. Shared callers use feature operations, not
renamed `isDesktop`/host flags. Runtime operation results and actual mounted
view handles may still control UI state. Protocol constants and type-only host
imports are shared contracts.

- `runtime/exports/` selects PDF preference, native print/capture and image save.
  Shared export algorithms use `runtime/export-download/` for native completion
  or browser downloads; browser helpers never import their enclosing entry.
- `runtime/project-folders/` owns directory picking/import. A present host's
  cancellation or token failure must not fall back to an unauthorised raw path.
- `runtime/project-directory/`, `diagnostics-export/`, `external-navigation/`
  and `connector-authorization/` own their respective native/browser operations.
- `components/BrowserSurface/` owns webview versus iframe rendering;
  `runtime/brand-browser/` owns native retry/focus/data-clear policy.
- `lib/updater/`, `runtime/preview-navigation/`, `client-context/` and
  `campaign-support/` isolate the remaining host integrations.

Desktop implementations preserve browser-to-local-daemon fallbacks. The web
implementation must ignore an accidentally present host bridge. Test both
variants directly, then run real entry tests under both targets, including a
desktop target with no host. `tests/host-boundary.test.ts` checks source ownership;
the production artifact check also rejects native-only markers in web output.
