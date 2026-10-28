import { captureDbRead } from "./db/validation.js";
import type { Db } from "./db.js";
import type { Auth } from "./auth.js";
import type { Runtime } from "./runtime.js";
import type { Render } from "./render.js";
import type { File } from "./file.js";
import type { Proc } from "./process.js";

export interface BridgeCapabilities {
  db: Db;
  auth: Auth;
  runtime: Runtime;
  render: Render;
  file: File;
  proc: Proc;
}

export type BridgeCapability = keyof BridgeCapabilities;
export type BridgeBindings = Partial<BridgeCapabilities>;
export interface RegisterOptions {
  /** Declared by consumers, independently of the adapters supplied at startup. */
  readonly required: readonly BridgeCapability[];
}

let registered: Readonly<BridgeBindings> | undefined;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Register once per module instance, before accepting requests. No per-request rebinding. */
export function register(
  bindings: BridgeBindings,
  options: RegisterOptions,
): void {
  if (registered) throw new Error("Bridge is already registered");
  if (!isObject(bindings))
    throw new TypeError("Bridge bindings must be an object");

  const methods = {
    db: ["read", "transaction"],
    file: ["read", "readContent", "directory", "saveContent"],
    proc: ["spawn"],
    auth: ["getLoginState", "startLogin", "pollLogin", "cancelLogin", "logout"],
    runtime: [
      "getCapabilities",
      "submitRun",
      "getRun",
      "cancelRun",
      "recoverRun",
      "getSnapshot",
      "streamEvents",
    ],
    render: ["getCapabilities", "render"],
  } as const satisfies {
    [K in keyof BridgeBindings]-?: readonly (keyof NonNullable<
      BridgeBindings[K]
    >)[];
  };
  if (Reflect.ownKeys(bindings).some((key) => !Object.hasOwn(methods, key))) {
    throw new TypeError(
      "Only db, file, proc, auth, runtime and render bridges are supported",
    );
  }
  if (!isObject(options) || !Array.isArray(options.required)) {
    throw new TypeError(
      "Bridge registration requires an explicit required capability list",
    );
  }
  for (const capability of options.required) {
    if (typeof capability !== "string" || !Object.hasOwn(methods, capability)) {
      throw new TypeError(
        `Unknown required bridge capability: ${String(capability)}`,
      );
    }
    if (!Object.hasOwn(bindings, capability)) {
      throw new TypeError(`Bridge requires capability ${capability}`);
    }
  }
  const captured: Record<string, unknown> = {};
  for (const [capability, names] of Object.entries(methods)) {
    const adapter: unknown = bindings[capability as keyof BridgeBindings];
    // Every supplied capability is complete, even when no consumer requires it yet.
    if (!Object.hasOwn(bindings, capability)) continue;
    const bound: Record<string, unknown> = {};
    for (const method of names) {
      if (!isObject(adapter) || typeof adapter[method] !== "function") {
        throw new TypeError(`Bridge requires ${capability}.${method}()`);
      }
      bound[method] = adapter[method].bind(adapter);
    }
    if (capability === "db") {
      const reader = captureDbRead((bound.read as () => unknown)());
      bound.read = () => reader;
    }
    captured[capability] = Object.freeze(bound);
  }
  registered = Object.freeze(captured) as unknown as Readonly<BridgeBindings>;
}

/** @internal Not exported through the package entry point. */
export function requireBindings(): Readonly<BridgeBindings> {
  if (!registered)
    throw new Error("Bridge is not registered; call register() during startup");
  return registered;
}

/** @internal Not exported through the package entry point. */
export function requireCapability<K extends keyof BridgeBindings>(
  key: K,
): NonNullable<BridgeBindings[K]> {
  const capability = requireBindings()[key];
  if (!capability)
    throw new Error(`Bridge capability ${key} is not registered`);
  return capability;
}
