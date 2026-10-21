import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  LAUNCHER_SCHEMA_VERSION, LAUNCHER_HOST_CONTRACT_VERSION,
  compareLauncherVersions, normalizeLauncherVersion, normalizeNamespace,
  parseLauncherDelegatedArgs, publishLauncherHost, resolveLauncherPaths, validateLauncherHostEnvironment,
  type LauncherHostEnvironment,
  selectLauncherRuntimeTarget, validateLauncherRuntimeDescriptor, validateLauncherAttemptDescriptor,
  type LauncherCleanupDescriptor, type LauncherAttemptDescriptor, type LauncherHost, type LauncherHostRunningCode,
  type LauncherHostSelection, type LauncherRuntimeDescriptor,
} from "@open-design/launcher-proto";
import { resolvePayload, within } from "./artifact.js";
import type { LauncherPlatform } from "./platform.js";
import type { LauncherEntry, LauncherEntryOptions } from "./types.js";

type RawConfig = { appVersion?: string; namespace?: string; namespaceBaseRoot?: string; launcherHostContract?: number; launcherHost?: LauncherHostEnvironment };
type HostBinding = { contractVersion: number; installedAppPath: string; outerVersion: string; electronVersion: string };

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
function channelFrom(version: string): "stable" | "beta" | "prerelease" {
  return version.includes("-beta.") ? "beta" : version.includes("-prerelease.") ? "prerelease" : "stable";
}
/** The installed host owns lifecycle state; platform operations are injected. */
export async function startLauncher(options: LauncherEntryOptions & { adapter: LauncherPlatform }): Promise<LauncherEntry | null> {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv.slice(1);
  const legacy: LauncherEntry = { entry: options.bundledEntry, source: "legacy" };
  const platform = options.adapter;
  const resourcesPath = options.resourcesPath ?? (process as NodeJS.Process & { resourcesPath: string }).resourcesPath;
  const executablePath = options.executablePath ?? process.execPath;
  const electronVersion = platform.environment.electronVersion;
  const raw = (readJson(env.OD_PACKAGED_CONFIG_PATH || join(resourcesPath, "open-design-config.json")) ?? {}) as RawConfig;
  const version = normalizeLauncherVersion(raw.appVersion ?? "");
  const namespace = normalizeNamespace(env.OD_PACKAGED_NAMESPACE ?? raw.namespace ?? "default");
  const namespaceBaseRoot = resolve(env.OD_PACKAGED_NAMESPACE_BASE_ROOT || raw.namespaceBaseRoot || join(options.app.getPath("userData"), "namespaces"));
  const paths = resolveLauncherPaths({ channel: channelFrom(version), namespace, root: resolve(namespaceBaseRoot, "..") });
  const bindingPath = join(paths.stateRoot, "hosted.json");
  const installedAppPath = platform.installedAppPath(executablePath);
  // A new payload delivered to an old outer remains legacy. Direct launches
  // may only redirect when a real, compatible installed host has claimed it.
  if (within(paths.versionsRoot, executablePath)) {
    const binding = readJson(bindingPath) as HostBinding | null;
    if (binding?.contractVersion === LAUNCHER_HOST_CONTRACT_VERSION && !within(paths.versionsRoot, binding.installedAppPath)) {
      const config = readJson(platform.installedConfigPath(binding.installedAppPath)) as RawConfig | null;
      if (config?.launcherHostContract === LAUNCHER_HOST_CONTRACT_VERSION) {
        await platform.openInstalled(binding.installedAppPath, argv.filter(arg => arg.startsWith("opendesign://") || arg === "--headless"));
        options.app.exit(0); return null;
      }
    }
    return legacy;
  }
  validateLauncherHostEnvironment(raw.launcherHost, platform.environment);
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
      resolvePayload(paths, runtime.active.version, platform.environment);
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
    let resolved: ReturnType<typeof resolvePayload> | null;
    let reason: LauncherHostSelection["reason"] = selected.selected && selected.reason !== "active-resume" ? selected.reason : "active";
    try { resolved = resolvePayload(paths, target.version, platform.environment); }
    catch {
      // A selected payload can be missing/corrupt before its own code runs.
      // Preserve evidence and recover through a hosted last-good or bundled app,
      // never through the legacy subprocess chain.
      rolledBackFromVersion = target.version;
      writeJson(paths.attemptsPath, { schemaVersion: LAUNCHER_SCHEMA_VERSION, ...expected, ...target, startedAt: new Date().toISOString() });
      target = runtime.lastSuccessful ?? pointer;
      reason = "last-successful";
      try { resolved = compareLauncherVersions(target.version, version) > 0 ? resolvePayload(paths, target.version, platform.environment) : null; }
      catch { target = pointer; resolved = null; }
    }
    if (resolved != null) {
      running = resolved.running; entry = resolved.entry;
      selection = { pointer: target, reason };
      if (reason !== "last-successful") writeJson(paths.attemptsPath, { schemaVersion: LAUNCHER_SCHEMA_VERSION, ...expected, ...target, startedAt: new Date().toISOString() } satisfies LauncherAttemptDescriptor);
    }
  }

  let phase: "starting" | "ready" | "relaunch-pending" = "starting";
  let candidateVersion: string | null = null;
  const host: LauncherHost = {
    contractVersion: LAUNCHER_HOST_CONTRACT_VERSION, installedAppPath, namespaceBaseRoot, running, selection, rolledBackFromVersion,
    snapshot: () => structuredClone(runtime),
    status: () => ({ phase, candidateVersion }),
    async reportReady() {
      if (phase !== "starting") return;
      phase = "ready";
      // A rollback must not acknowledge the known bad active version.
      if (selection?.reason === "last-successful" || rolledBackFromVersion != null) return;
      const current = selection?.pointer ?? pointer;
      runtime = { ...runtime, active: current, lastSuccessful: current, updatedAt: new Date().toISOString() };
      writeJson(paths.runtimePath, runtime); rmSync(paths.attemptsPath, { force: true });
    },
    async prepareCandidate(nextVersion, artifactRoot) {
      const normalized = normalizeLauncherVersion(nextVersion);
      resolvePayload(paths, normalized, platform.environment, artifactRoot);
      candidateVersion = normalized;
    },
    async activateCandidate(nextVersion) {
      const normalized = normalizeLauncherVersion(nextVersion);
      resolvePayload(paths, normalized, platform.environment);
      candidateVersion = normalized;
      const active = { version: normalized, generation: Math.max(runtime.active?.generation ?? 0, runtime.lastSuccessful?.generation ?? 0) + 1 };
      runtime = { ...runtime, active, updatedAt: new Date().toISOString() };
      writeJson(paths.runtimePath, runtime);
      writeJson(paths.attemptsPath, { schemaVersion: LAUNCHER_SCHEMA_VERSION, ...expected, ...active, startedAt: new Date().toISOString() });
      return structuredClone(runtime);
    },
    async resetFailedLaunch() {
      rmSync(paths.attemptsPath, { force: true });
      let handoff: { state?: string } | null = null;
      try { handoff = readJson(paths.handoffPath) as { state?: string } | null; } catch { /* malformed interrupted handoff */ }
      if (handoff?.state !== "confirmed") rmSync(paths.handoffPath, { force: true });
    },
    async protectsResource(path) {
      const contains = (root: string, value: string) => resolve(root) === resolve(value) || within(root, value);
      if (contains(path, executablePath) || (running.source === "payload" && contains(path, running.appRoot))) return true;
      let physicalRoot: string;
      try { physicalRoot = realpathSync(path); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
      return contains(physicalRoot, realpathSync(executablePath)) ||
        (running.source === "payload" && contains(physicalRoot, realpathSync(running.appRoot)));
    },
    onSecondInstance(listener) { secondListener = listener; for (const args of pending.splice(0)) listener(args); },
    async requestRelaunch() {
      if (phase === "relaunch-pending") return;
      await platform.relaunchInstalled(installedAppPath, { predecessorPid: options.processPid ?? process.pid, target: runtime.active });
      phase = "relaunch-pending";
    },
  };
  (options.publish ?? publishLauncherHost)(host);
  if (running.source === "payload") options.app.setAppPath(running.appRoot);
  // System integration is best effort and independent of business readiness.
  void Promise.resolve().then(() => platform.synchronizeSystemEntries({ installedAppPath, executablePath, paths }))
    .catch(error => console.warn("[launcher] system entry synchronization failed", error));
  return { entry, source: running.source };
}
