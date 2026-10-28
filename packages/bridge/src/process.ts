import { requireCapability } from './register.js';

export interface SpawnRequest {
  command: string;
  args: readonly string[];
  cwd: string;
  /** Adapter-owned environment defaults may be overridden explicitly. */
  env?: Readonly<Record<string, string>>;
}

export interface ProcessExit {
  code: number | null;
  signal: string | null;
}

export interface ProcessHandle {
  /** Consume both output streams while the process runs. */
  stdout: AsyncIterable<Uint8Array>;
  stderr: AsyncIterable<Uint8Array>;
  write(data: Uint8Array): Promise<void>;
  end(): Promise<void>;
  /** Resolves with observed termination, not just a cancellation request. */
  wait(): Promise<ProcessExit>;
  /** Requests termination; call wait() to observe the final result. */
  terminate(): Promise<void>;
}

export interface Proc {
  /** Execute a program and argv directly, without implicit shell-string parsing. */
  spawn(request: SpawnRequest): Promise<ProcessHandle>;
}

/** `proc` avoids shadowing Node's global `process`. */
export const proc: Readonly<Proc> = Object.freeze({
  async spawn(request: SpawnRequest): Promise<ProcessHandle> {
    return requireCapability('proc').spawn(request);
  },
});
