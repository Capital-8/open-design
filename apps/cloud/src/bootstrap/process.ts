import {
  register,
  type BridgeBindings,
  type BridgeCapability,
} from "@open-design/bridge";
import {
  collectRequirements,
  type ModuleRequirements,
} from "./requirements.js";

export type Cleanup = () => void | Promise<void>;

export interface CloudModule extends ModuleRequirements {
  /** Called only after all startup checks pass. Unwind partial acquisition on failure. */
  start(): Promise<Cleanup>;
}

export interface CloudResources {
  readonly bindings: BridgeBindings;
  /** Validate consumer features separately from method presence and resource health. */
  checkSupport(): Promise<void>;
  checkReadiness(): Promise<void>;
  close(): void | Promise<void>;
}

export interface ProcessOptions {
  /** Resolves once on fatal ownership loss; never rejects. Latched across startup. */
  readonly failure?: Promise<void>;
  readonly modules: readonly CloudModule[];
  /** The factory must unwind its own partial acquisition if it rejects. */
  createResources(
    required: readonly BridgeCapability[],
  ): Promise<CloudResources>;
}

export interface CloudProcess {
  readonly failure?: Promise<void>;
  /** Idempotent. Stop consumers before closing their infrastructure. */
  stop(): Promise<void>;
}

// Own startup before the first await: concurrent entry calls cannot create two lifecycles.
let startupAttempted = false;

async function cleanupAll(cleanups: readonly Cleanup[]): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const cleanup of [...cleanups].reverse()) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

/** @internal Shared by the two public entrypoints, not a registry factory/reset API. */
export async function startProcess(
  options: ProcessOptions,
): Promise<CloudProcess> {
  if (startupAttempted)
    throw new Error(
      "Cloud process startup was already attempted; start a new process",
    );
  startupAttempted = true;
  // Capture the enabled modules and their receivers before asynchronous resource acquisition.
  const modules = options.modules.map((module) => ({
    name: module.name,
    required: [...module.required],
    start: module.start.bind(module),
  }));
  const required = collectRequirements(modules);
  const cleanups: Cleanup[] = [];
  try {
    const resources = await options.createResources(required);
    cleanups.push(resources.close.bind(resources));
    register(resources.bindings, { required });
    await resources.checkSupport();
    await resources.checkReadiness();
    for (const module of modules) cleanups.push(await module.start());
  } catch (error) {
    const failures = await cleanupAll(cleanups);
    if (failures.length)
      throw new AggregateError(
        [error, ...failures],
        "Cloud startup and cleanup failed",
      );
    throw error;
  }
  let stopping: Promise<void> | undefined;
  return Object.freeze({
    failure: options.failure,
    stop() {
      return (stopping ??= (async () => {
        const errors = await cleanupAll(cleanups);
        if (errors.length)
          throw new AggregateError(errors, "Cloud shutdown failed");
      })());
    },
  });
}
