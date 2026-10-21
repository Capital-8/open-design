import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  LAUNCHER_SCHEMA_VERSION, LAUNCHER_HOST_CONTRACT_VERSION,
  compareLauncherVersions, normalizeLauncherVersion, normalizeNamespace,
  parseLauncherDelegatedArgs, publishLauncherHost, resolveLauncherPaths, resolveLauncherVersionPaths,
  selectLauncherRuntimeTarget, validateLauncherRuntimeDescriptor, validateLauncherAttemptDescriptor,
  type LauncherCleanupDescriptor, type LauncherAttemptDescriptor, type LauncherHostIdentity, type LauncherHostRunningCode,
  type LauncherHostRelaunchRequest, type LauncherHostSelection, type LauncherPaths, type LauncherRuntimeDescriptor,
} from "@open-design/launcher-proto";

type ElectronApp = {
  getPath(name: "userData"): string;
  setPath(name: "userData", path: string): void;
  setAppPath(path: string): void;
  requestSingleInstanceLock(data?: Record<string, unknown>): boolean;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  exit(code: number): void;
};
export type LauncherEntryOptions = {
  app: ElectronApp;
  appRoot: string;
  bundledEntry: string;
  platform?: NodeJS.Platform;
  executablePath?: string;
  resourcesPath?: string;
  electronVersion?: string;
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  publish?: (host: LauncherHostIdentity) => void;
  openInstalled?: (appPath: string, argv: readonly string[]) => Promise<void>;
};
export type LauncherEntry = { entry: string; source: "bundled" | "payload" | "legacy" };
type RawConfig = { appVersion?: string; namespace?: string; namespaceBaseRoot?: string; launcherHostContract?: number };
type HostBinding = { contractVersion: number; installedAppPath: string; outerVersion: string; electronVersion: string };
type HostedPayload = { running: LauncherHostRunningCode; entry: string };

function updateEnvironmentArgs(): string[] {
  // LaunchServices does not inherit the caller's environment automatically.
  // Carry updater overrides explicitly, without inheriting sidecar ownership.
  return Object.entries(process.env).flatMap(([key, value]) =>
    key.startsWith("OD_UPDATE_") && value != null ? ["--env", `${key}=${value}`] : []);
}

function readJson(path: string): unknown {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try { writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 }); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
}
function within(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function safePath(root: string, path: unknown): string {
  if (typeof path !== "string" || isAbsolute(path)) throw new Error("invalid launcher payload path");
  const result = resolve(root, path);
  if (!within(root, result) || !within(realpathSync(root), realpathSync(result))) throw new Error("launcher payload path escapes its version root");
  return result;
}
function channelFrom(version: string): "stable" | "beta" | "prerelease" {
  return version.includes("-beta.") ? "beta" : version.includes("-prerelease.") ? "prerelease" : "stable";
}
function payload(paths: LauncherPaths, version: string, electronVersion: string, entry: string): HostedPayload {
  const versionPaths = resolveLauncherVersionPaths({ ...paths, version });
  const manifest = readJson(versionPaths.manifestPath) as Record<string, unknown> | null;
  if (manifest == null || manifest.schemaVersion !== LAUNCHER_SCHEMA_VERSION || manifest.platform !== "darwin" ||
      manifest.channel !== paths.channel || manifest.namespace !== paths.namespace || manifest.version !== version ||
      manifest.electronVersion !== electronVersion || manifest.launcherHostContract !== LAUNCHER_HOST_CONTRACT_VERSION) {
    throw new Error(`payload ${version} is not compatible with this installed launcher; update the installer`);
  }
  const target = manifest.entry as { cwd?: unknown; executable?: unknown } | undefined;
  const bundle = safePath(versionPaths.versionRoot, target?.cwd);
  const executablePath = safePath(versionPaths.versionRoot, target?.executable);
  const resourcesPath = join(bundle, "Contents", "Resources");
  const appRoot = join(resourcesPath, "app");
  const raw = readJson(join(resourcesPath, "open-design-config.json")) as RawConfig | null;
  if (raw?.appVersion !== version || raw.launcherHostContract !== LAUNCHER_HOST_CONTRACT_VERSION) throw new Error("payload host metadata mismatch");
  // The entry is a package specifier in server mode, a relative file in standalone mode.
  const main = entry.startsWith(".") ? resolve(appRoot, entry) : join(appRoot, "node_modules", entry, "dist", "index.mjs");
  if (!within(appRoot, main) || !statSync(main).isFile() || !statSync(executablePath).isFile()) throw new Error("payload entry is incomplete");
  return { entry: pathToFileURL(main).href, running: { appRoot, resourcesPath, executablePath, source: "payload", version } };
}
async function openInstalled(path: string, argv: readonly string[]): Promise<void> {
  const args = [...updateEnvironmentArgs(), ...(argv.includes("--headless") ? ["-g", "-j"] : []), path, ...(argv.length === 0 ? [] : ["--args", ...argv])];
  const child = spawn("/usr/bin/open", args, { stdio: "ignore", detached: true });
  await new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("spawn", resolve); });
  child.unref();
}
export async function relaunchInstalledApp(path: string, request: LauncherHostRelaunchRequest): Promise<void> {
  if (!Number.isSafeInteger(request.appPid) || request.appPid <= 0) throw new Error("invalid launcher predecessor pid");
  const delegated = request.delegated == null ? [] : ["--args", "--od-launcher-delegated-generation", String(request.delegated.generation), "--od-launcher-delegated-version", request.delegated.version];
  // LaunchServices must create the successor's own responsibility coalition.
  const script = 'pid="$1"; shift; deadline=$(($(date +%s) + 60)); while kill -0 "$pid" 2>/dev/null; do [ "$(date +%s)" -lt "$deadline" ] || exit 1; sleep 0.05; done; exec /usr/bin/open "$@"';
  const child = spawn("/bin/sh", ["-c", script, "od-launcher", String(request.appPid), ...updateEnvironmentArgs(), path, ...delegated], {
    detached: true, stdio: "ignore", env: { HOME: process.env.HOME, PATH: "/usr/bin:/bin" },
  });
  await new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("spawn", resolve); });
  child.unref();
}

/** Installed macOS process owns the lock, version journal and GUI for its lifetime. */
export async function selectAppEntry(options: LauncherEntryOptions): Promise<LauncherEntry | null> {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv.slice(1);
  const legacy: LauncherEntry = { entry: options.bundledEntry, source: "legacy" };
  if ((options.platform ?? process.platform) !== "darwin" || env.ELECTRON_RUN_AS_NODE === "1" ||
      env.OD_SIDECAR_SUPERVISED_CONTEXT != null || argv.includes("--mcp-install")) return legacy;
  const resourcesPath = options.resourcesPath ?? (process as NodeJS.Process & { resourcesPath: string }).resourcesPath;
  const executablePath = options.executablePath ?? process.execPath;
  const electronVersion = options.electronVersion ?? process.versions.electron ?? "";
  const raw = (readJson(env.OD_PACKAGED_CONFIG_PATH || join(resourcesPath, "open-design-config.json")) ?? {}) as RawConfig;
  const version = normalizeLauncherVersion(raw.appVersion ?? "");
  const namespace = normalizeNamespace(env.OD_PACKAGED_NAMESPACE ?? raw.namespace ?? "default");
  const namespaceBaseRoot = resolve(env.OD_PACKAGED_NAMESPACE_BASE_ROOT || raw.namespaceBaseRoot || join(options.app.getPath("userData"), "namespaces"));
  const paths = resolveLauncherPaths({ channel: channelFrom(version), namespace, root: resolve(namespaceBaseRoot, "..") });
  const bindingPath = join(paths.stateRoot, "hosted.json");
  const installedAppPath = resolve(executablePath, "..", "..", "..");
  // A new payload delivered to an old outer remains legacy. Direct launches
  // may only redirect when a real, compatible installed host has claimed it.
  if (within(paths.versionsRoot, executablePath)) {
    const binding = readJson(bindingPath) as HostBinding | null;
    if (binding?.contractVersion === LAUNCHER_HOST_CONTRACT_VERSION && !within(paths.versionsRoot, binding.installedAppPath)) {
      const config = readJson(join(binding.installedAppPath, "Contents", "Resources", "open-design-config.json")) as RawConfig | null;
      if (config?.launcherHostContract === LAUNCHER_HOST_CONTRACT_VERSION) {
        await (options.openInstalled ?? openInstalled)(binding.installedAppPath, argv.filter(arg => arg.startsWith("opendesign://") || arg === "--headless"));
        options.app.exit(0); return null;
      }
    }
    return legacy;
  }
  // userData determines Electron's lock key. No launcher state changes before lock ownership.
  options.app.setPath("userData", join(namespaceBaseRoot, namespace, "user-data"));
  if (!options.app.requestSingleInstanceLock({ argv: [...argv], version })) { options.app.exit(0); return null; }
  let secondListener: ((argv: readonly string[]) => void) | null = null;
  const pending: string[][] = [];
  options.app.on("second-instance", (_event, args) => {
    if (!Array.isArray(args) || !args.every(arg => typeof arg === "string")) return;
    if (secondListener == null) pending.push(args); else secondListener(args);
  });
  const expected = { channel: paths.channel, namespace };
  const oldBinding = readJson(bindingPath) as HostBinding | null;
  const installed = oldBinding?.contractVersion === LAUNCHER_HOST_CONTRACT_VERSION && oldBinding.installedAppPath === installedAppPath && oldBinding.outerVersion === version && oldBinding.electronVersion === electronVersion;
  const pointer = { version, generation: 0 };
  const baseline: LauncherRuntimeDescriptor = { schemaVersion: LAUNCHER_SCHEMA_VERSION, ...expected, active: pointer, lastSuccessful: pointer };
  let runtime = (() => {
    const value = readJson(paths.runtimePath);
    if (value == null) return baseline;
    return validateLauncherRuntimeDescriptor(value as LauncherRuntimeDescriptor, expected);
  })();
  const attempt = (() => {
    try { return validateLauncherAttemptDescriptor(readJson(paths.attemptsPath) as LauncherAttemptDescriptor, expected); } catch { return null; }
  })();
  // A new installation is an architecture boundary even when versions match.
  // Keep a newer compatible payload; never silently downgrade newer incompatible app data.
  if (!installed) {
    if (runtime.active != null && compareLauncherVersions(runtime.active.version, version) > 0) {
      payload(paths, runtime.active.version, electronVersion, options.bundledEntry);
      runtime = { ...runtime, lastSuccessful: pointer };
    } else runtime = baseline;
    // Installer adoption inventories orphaned and partial payload directories,
    // not just the two legacy pointers. Deletion stays in the existing deferred
    // cleanup executor, after readiness and with running-resource protection.
    const cleanup: LauncherCleanupDescriptor = {
      version: 1, ...expected, currentVersion: version, updatedAt: new Date().toISOString(), versions: [],
    };
    if (existsSync(paths.versionsRoot)) {
      for (const dir of readdirSync(paths.versionsRoot, { withFileTypes: true })) {
        if (!dir.isDirectory() || dir.isSymbolicLink()) continue;
        if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(dir.name)) continue;
        try { if (normalizeLauncherVersion(dir.name) !== dir.name || compareLauncherVersions(dir.name, version) > 0) continue; } catch { continue; }
        cleanup.versions.push({ version: dir.name, generation: 0, reason: "older-than-bound-package", state: "deprecated", updatedAt: cleanup.updatedAt });
      }
    }
    writeJson(paths.cleanupPath, cleanup);
    writeJson(paths.runtimePath, runtime);
    rmSync(paths.attemptsPath, { force: true });
    rmSync(paths.handoffPath, { force: true });
    writeJson(paths.installPath, { schemaVersion: LAUNCHER_SCHEMA_VERSION, ...expected, launchPath: installedAppPath });
    writeJson(bindingPath, { contractVersion: LAUNCHER_HOST_CONTRACT_VERSION, installedAppPath, outerVersion: version, electronVersion } satisfies HostBinding);
  }
  const selected = selectLauncherRuntimeTarget({ runtime, attempted: installed ? attempt : null, delegated: parseLauncherDelegatedArgs(argv) });
  let target = selected.selected ? selected.pointer : pointer;
  let running: LauncherHostRunningCode = { appRoot: options.appRoot, resourcesPath, executablePath, source: "bundled", version };
  let entry = options.bundledEntry;
  let selection: LauncherHostSelection | null = null;
  let rolledBackFromVersion = installed && attempt != null && runtime.active?.version === attempt.version && runtime.active.generation === attempt.generation && selected.selected && selected.reason === "last-successful" ? attempt.version : null;
  if (compareLauncherVersions(target.version, version) > 0) {
    let resolved: HostedPayload | null;
    let reason: LauncherHostSelection["reason"] = selected.selected && selected.reason !== "active-resume" ? selected.reason : "active";
    try { resolved = payload(paths, target.version, electronVersion, options.bundledEntry); }
    catch {
      // A selected payload can be missing/corrupt before its own code runs.
      // Preserve evidence and recover through a hosted last-good or bundled app,
      // never through the legacy subprocess chain.
      rolledBackFromVersion = target.version;
      writeJson(paths.attemptsPath, { schemaVersion: LAUNCHER_SCHEMA_VERSION, ...expected, ...target, startedAt: new Date().toISOString() });
      target = runtime.lastSuccessful ?? pointer;
      reason = "last-successful";
      try { resolved = compareLauncherVersions(target.version, version) > 0 ? payload(paths, target.version, electronVersion, options.bundledEntry) : null; }
      catch { target = pointer; resolved = null; }
    }
    if (resolved != null) {
      running = resolved.running; entry = resolved.entry;
      selection = { pointer: target, reason };
      if (reason !== "last-successful") writeJson(paths.attemptsPath, { schemaVersion: LAUNCHER_SCHEMA_VERSION, ...expected, ...target, startedAt: new Date().toISOString() } satisfies LauncherAttemptDescriptor);
    }
  }

  const host: LauncherHostIdentity = {
    contractVersion: LAUNCHER_HOST_CONTRACT_VERSION, installedAppPath, namespaceBaseRoot, running, selection, rolledBackFromVersion,
    snapshot: () => structuredClone(runtime),
    async confirm() {
      // A rollback must not acknowledge the known bad active version.
      if (selection?.reason === "last-successful" || rolledBackFromVersion != null) return;
      const current = selection?.pointer ?? pointer;
      runtime = { ...runtime, active: current, lastSuccessful: current, updatedAt: new Date().toISOString() };
      writeJson(paths.runtimePath, runtime); rmSync(paths.attemptsPath, { force: true });
    },
    async activate(nextVersion) {
      const normalized = normalizeLauncherVersion(nextVersion);
      payload(paths, normalized, electronVersion, options.bundledEntry);
      const active = { version: normalized, generation: Math.max(runtime.active?.generation ?? 0, runtime.lastSuccessful?.generation ?? 0) + 1 };
      runtime = { ...runtime, active, updatedAt: new Date().toISOString() };
      writeJson(paths.runtimePath, runtime);
      writeJson(paths.attemptsPath, { schemaVersion: LAUNCHER_SCHEMA_VERSION, ...expected, ...active, startedAt: new Date().toISOString() });
      return structuredClone(runtime);
    },
    async clearAttempt() { rmSync(paths.attemptsPath, { force: true }); },
    onSecondInstance(listener) { secondListener = listener; for (const args of pending.splice(0)) listener(args); },
    requestRelaunch: request => relaunchInstalledApp(installedAppPath, request),
  };
  (options.publish ?? publishLauncherHost)(host);
  if (running.source === "payload") options.app.setAppPath(running.appRoot);
  return { entry, source: running.source };
}
