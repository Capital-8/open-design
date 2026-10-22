# Daemon data directory contract

## Configuration and persistence

The daemon data root contains local database state, managed projects, artifacts,
configuration, and credentials. Keep it writable and persistent across restarts.
Stop the daemon before copying the complete data root for backup or migration;
imported-folder projects also need backups of their external directories.

| Launch mode | Data root selection |
| --- | --- |
| Source daemon | `OD_DATA_DIR` selects the root; without it, `resolveDataDir` uses `<project-root>/.od`. Relative values resolve against the project root; home expansion is supported. Sandbox mode requires an explicit value. |
| `tools-dev` | Pass `OD_DATA_DIR` for explicit isolation. A namespace alone does not select an isolated daemon data root. |
| Packaged app | The packaged launcher selects the namespace-scoped root and passes it to the daemon as `OD_DATA_DIR`; do not infer it from a web port or app display name. |
| Repository Docker Compose | `deploy/docker-compose.yml` mounts the `open_design_data` named volume at `/app/.od`. The actual Docker volume name includes the Compose project prefix. Normal container replacement preserves the volume. |

For an isolated source development run, choose a data root explicitly:

```bash
OD_DATA_DIR="$PWD/.tmp/local-design-data" pnpm tools-dev run web
```

This is an example for a source checkout, not a universal installation path.
For Compose, inspect the volume attached to the running service with
`docker inspect open-design --format '{{json .Mounts}}'`. Preserve that volume
when upgrading; `docker compose down --volumes` removes named-volume data.

User guides may explain verified configuration and launch-specific examples.
Keep example paths labelled by launch mode and link here for the shared contract.
Do not copy legacy fallback paths into new code as an independent convention.

## Implementation ownership

The daemon has one active data-root truth source:

- On daemon startup, `apps/daemon/src/server.ts` resolves `OD_DATA_DIR` into
  `RUNTIME_DATA_DIR`.
- All daemon-owned data paths must derive from `RUNTIME_DATA_DIR` or from a
  constant derived from it, such as `PROJECTS_DIR` or `ARTIFACTS_DIR`.
- `PROJECTS_DIR` is the managed-project root. Imported-folder projects are the
  explicit exception: they use `metadata.baseDir` for the user-selected
  external workspace.
- `ARTIFACTS_DIR`, SQLite, app config, memory, MCP config/tokens, automation
  state, plugin state, connector credentials, generated files, logs owned by
  sandbox mode, and agent runtime homes are daemon data and must remain under
  the resolved daemon data root unless this contract names a specific exception.
- Agent subprocesses receive the resolved daemon data root as `OD_DATA_DIR`.
  They must inherit the daemon's truth source instead of guessing their own
  data path.

Development propagation:

- `tools-dev` consumes sidecar launch/discovery/lifecycle atomics and owns only developer orchestration policy.
- `tools-dev --namespace <name>` does not, by itself, define daemon data
  isolation.
- A development run that needs an isolated daemon data root must pass
  `OD_DATA_DIR` into the daemon process environment. After that, the daemon
  resolves it once and all daemon data paths flow from `RUNTIME_DATA_DIR`.

Packaged propagation:

- `tools-pack` / `apps/packaged` own packaged channel and namespace layout.
- Packaged code resolves the final namespace-scoped daemon data root before
  spawning the daemon.
- The packaged daemon receives that final data root as `OD_DATA_DIR`; daemon
  code must not infer packaged data paths from app names, Electron `userData`,
  ports, channel names, or namespace names.

Sanctioned exceptions:

- `OD_MEDIA_CONFIG_DIR` is a narrow override for `media-config.json` only. It
  is not a second daemon data root.
- `OD_LEGACY_DATA_DIR` is a migration source for legacy data import only. It is
  not an active daemon data root.
- External tool homes such as `CODEX_HOME` are integration inputs, not daemon
  data roots. The daemon must not describe them as OpenDesign runtime data.
- Agent/project-cwd skill staging aliases are not daemon data roots.
- Manifest metadata keys and CSS identifiers are semantic namespaces, not
  filesystem path conventions.

Known escape candidates that must not be reused:

- Module-level defaults that point at a cwd-relative legacy data directory.
- Helper defaults such as `defaultRegistryRoots()` that recompute a data root
  from `process.env.OD_DATA_DIR` or a cwd fallback instead of receiving
  `RUNTIME_DATA_DIR`.
- `openDatabase(projectRoot)` calls that rely on its fallback instead of
  passing the resolved data root.
- Script help text or examples that suggest concrete legacy data directories.

Do not extend these escape patterns. When a fix is obvious, route the path
through `RUNTIME_DATA_DIR` or an explicit data-root argument. When it is not
obvious, resolve the ownership decision with a core maintainer before changing the contract.

## Source entrypoints

- `apps/daemon/src/daemon-paths.ts`: `resolveDataDir` resolves the configured root.
- `apps/daemon/src/server.ts`: resolves `RUNTIME_DATA_DIR`, creates owned paths, and propagates the root.
- `tools/dev/src/data-root.ts`: resolves explicit development overrides.
- `apps/packaged/src/sidecars.ts`: supplies the packaged data root to child processes.
- `deploy/docker-compose.yml`: declares the repository Compose volume mount.
