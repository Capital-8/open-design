import type { LauncherRuntimeDescriptor, LauncherVersionPointer } from "./index.js";

/** Main-process-only contract. Its absence preserves the historical entry path. */
export const LAUNCHER_HOST_CONTRACT_VERSION = 1 as const;
export const LAUNCHER_HOST_KEY = Symbol.for("open-design.launcher-host");
export type LauncherHostSelection = Readonly<{
  pointer: LauncherVersionPointer;
  reason: "active" | "active-delegated" | "last-successful";
}>;
export type LauncherHostRunningCode = Readonly<{
  source: "bundled" | "payload";
  version: string;
  appRoot: string;
  resourcesPath: string;
  executablePath: string;
}>;
export type LauncherHostRelaunchRequest = { appPid: number; delegated?: LauncherVersionPointer | null };
export type LauncherHostIdentity = Readonly<{
  contractVersion: typeof LAUNCHER_HOST_CONTRACT_VERSION;
  installedAppPath: string;
  namespaceBaseRoot: string;
  running: LauncherHostRunningCode;
  selection: LauncherHostSelection | null;
  rolledBackFromVersion: string | null;
  snapshot(): LauncherRuntimeDescriptor;
  confirm(): Promise<void>;
  activate(version: string): Promise<LauncherRuntimeDescriptor>;
  clearAttempt(): Promise<void>;
  onSecondInstance(listener: (argv: readonly string[]) => void): void;
  requestRelaunch(request: LauncherHostRelaunchRequest): Promise<void>;
}>;
export function readLauncherHost(): LauncherHostIdentity | null {
  const value = (globalThis as Record<symbol, unknown>)[LAUNCHER_HOST_KEY];
  if (value == null || typeof value !== "object") return null;
  const host = value as LauncherHostIdentity;
  return host.contractVersion === LAUNCHER_HOST_CONTRACT_VERSION ? host : null;
}
/** Publish once, without environment/argv propagation to children. */
export function publishLauncherHost(host: LauncherHostIdentity): void {
  Object.defineProperty(globalThis, LAUNCHER_HOST_KEY, {
    configurable: false, enumerable: false, writable: false,
    value: Object.freeze({ ...host, running: Object.freeze({ ...host.running }),
      selection: host.selection == null ? null : Object.freeze({ ...host.selection, pointer: Object.freeze({ ...host.selection.pointer }) }) }),
  });
}
