import { requireCapability } from './register.js';

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export interface JsonObject { readonly [key: string]: JsonValue }
/** Biz resolves ownership and the stored workspace binding before making a call. */
export interface RuntimeScope { principalId: string; workspaceId: string; credentialRef: string }
export interface ExecutionSessionRef { projectId: string; sessionId: string }
export interface ExecutionRunRef extends ExecutionSessionRef { runId: string }
export interface RuntimeCapabilities {
  submit: boolean; query: boolean; cancel: boolean; recover: boolean; snapshot: boolean; events: boolean;
}
export interface RunRequest {
  session: ExecutionSessionRef; idempotencyKey: string; input: string;
  resources?: readonly { type: 'plugin' | 'skill' | 'design-system'; id: string }[];
}
export interface ExecutionRun {
  ref: ExecutionRunRef;
  /** Execution-provider status; biz owns the product state machine. */
  status: string; answer: string; detail: string; idempotencyKey: string; createdAt: string;
}
export interface ExecutionSnapshot {
  session: ExecutionSessionRef; cursor: string; messages: readonly JsonObject[];
  runs: readonly ExecutionRun[]; previews: readonly JsonObject[];
}
export interface RuntimeEvent { cursor: string; runId: string; kind: string; time: string; payload: JsonObject }
export interface RuntimeEventStream extends AsyncIterable<RuntimeEvent> {
  /** Close this subscription only; never cancel the underlying run. */
  close(): void;
}
export interface Runtime {
  getCapabilities(): Promise<RuntimeCapabilities>;
  submitRun(scope: RuntimeScope, request: RunRequest): Promise<ExecutionRun>;
  getRun(scope: RuntimeScope, ref: ExecutionRunRef): Promise<ExecutionRun>;
  cancelRun(scope: RuntimeScope, ref: ExecutionRunRef): Promise<{ status: 'accepted' | 'terminated' }>;
  recoverRun(scope: RuntimeScope, ref: ExecutionRunRef): Promise<ExecutionRun>;
  getSnapshot(scope: RuntimeScope, session: ExecutionSessionRef): Promise<ExecutionSnapshot>;
  streamEvents(scope: RuntimeScope, session: ExecutionSessionRef, cursor: string): RuntimeEventStream;
}
export const runtime: Readonly<Runtime> = Object.freeze({
  async getCapabilities() { return requireCapability('runtime').getCapabilities(); },
  async submitRun(scope, request) { return requireCapability('runtime').submitRun(scope, request); },
  async getRun(scope, ref) { return requireCapability('runtime').getRun(scope, ref); },
  async cancelRun(scope, ref) { return requireCapability('runtime').cancelRun(scope, ref); },
  async recoverRun(scope, ref) { return requireCapability('runtime').recoverRun(scope, ref); },
  async getSnapshot(scope, session) { return requireCapability('runtime').getSnapshot(scope, session); },
  streamEvents(scope, session, cursor) { return requireCapability('runtime').streamEvents(scope, session, cursor); },
} satisfies Runtime);
