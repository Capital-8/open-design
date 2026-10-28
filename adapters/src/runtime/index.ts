import {
  BridgeError,
  type Runtime,
  type ExecutionSessionRef,
  type ExecutionRunRef,
  type ExecutionRun,
  type JsonObject,
  type RuntimeEvent,
} from "@open-design/bridge";
import {
  createAmrRuntimeClient,
  readAmrEvents,
  type AmrRun,
} from "@open-design/dependencies/amr";
import type { RuntimeCredentialSource } from "../auth/credentials.js";
import { callDependency, toBridgeError } from "../internal/errors.js";
import { runtimeAuthorization } from "./authorization.js";

function sessionRef(ref: ExecutionSessionRef) {
  if (!ref.projectId || !ref.sessionId)
    throw new BridgeError("invalid_execution_reference");
  return { project: ref.projectId, session: ref.sessionId };
}
function runRef(ref: ExecutionRunRef) {
  if (!ref.runId) throw new BridgeError("invalid_execution_reference");
  return { ...sessionRef(ref), run: ref.runId };
}
function normalizeRun(
  r: AmrRun,
  ref: ExecutionSessionRef,
  uncertain = false,
  expectedRunId?: string,
): ExecutionRun {
  if (
    r.project !== ref.projectId ||
    r.session !== ref.sessionId ||
    (expectedRunId !== undefined && r.id !== expectedRunId)
  ) {
    throw new BridgeError("runtime_protocol_error", uncertain);
  }
  return {
    ref: { projectId: r.project, sessionId: r.session, runId: r.id },
    status: r.status,
    answer: r.answer,
    detail: r.detail,
    idempotencyKey: r.key,
    createdAt: r.created,
  };
}
export interface AmrRuntimeOptions {
  url: string;
  authorizationApiUrl: string;
  credentials: RuntimeCredentialSource;
  /** Deployment capability, not a guessed upstream discovery endpoint. */
  supportsRecovery: boolean;
  fetch?: typeof fetch;
  now?: () => number;
}
/** Operates only on existing execution references. No project/session creation or business persistence. */
export function createAmrRuntimeAdapter(options: AmrRuntimeOptions): Runtime {
  const client = createAmrRuntimeClient({
    runtimeUrl: options.url,
    fetch: options.fetch ?? fetch,
  });
  const authorize = runtimeAuthorization({
    apiUrl: options.authorizationApiUrl,
    credentials: options.credentials,
    fetch: options.fetch ?? fetch,
    now: options.now ?? Date.now,
  });
  return {
    async getCapabilities() {
      return {
        submit: true,
        query: true,
        cancel: true,
        recover: options.supportsRecovery,
        snapshot: true,
        events: true,
      };
    },
    async submitRun(scope, input) {
      if (!input.idempotencyKey || !input.input)
        throw new BridgeError("invalid_run_request");
      const ref = sessionRef(input.session);
      const value = await callDependency(() =>
        client.submitRun((refresh) => authorize(scope, refresh), ref, {
          key: input.idempotencyKey,
          input: input.input,
          ...(input.resources?.length ? { resources: input.resources } : {}),
        }),
      );
      const run = normalizeRun(value, input.session, true);
      if (run.idempotencyKey !== input.idempotencyKey)
        throw new BridgeError("runtime_protocol_error", true);
      return run;
    },
    async getRun(scope, ref) {
      const reference = runRef(ref);
      return normalizeRun(
        await callDependency(() =>
          client.getRun((refresh) => authorize(scope, refresh), reference),
        ),
        ref,
        false,
        ref.runId,
      );
    },
    async cancelRun(scope, ref) {
      const reference = runRef(ref);
      await callDependency(() =>
        client.cancelRun((refresh) => authorize(scope, refresh), reference),
      );
      return { status: "accepted" };
    },
    async recoverRun(scope, ref) {
      if (!options.supportsRecovery)
        throw new BridgeError("runtime_recovery_unsupported");
      const reference = runRef(ref);
      return normalizeRun(
        await callDependency(() =>
          client.recoverRun((refresh) => authorize(scope, refresh), reference),
        ),
        ref,
        true,
        ref.runId,
      );
    },
    async getSnapshot(scope, ref) {
      const reference = sessionRef(ref);
      const snapshot = await callDependency(() =>
        client.getSnapshot((refresh) => authorize(scope, refresh), reference),
      );
      if (
        snapshot.session.id !== ref.sessionId ||
        snapshot.session.project !== ref.projectId
      ) {
        throw new BridgeError("runtime_protocol_error");
      }
      return {
        session: { ...ref },
        cursor: String(snapshot.cursor),
        messages: snapshot.messages as JsonObject[],
        previews: snapshot.previews as JsonObject[],
        runs: snapshot.runs.map((r) => normalizeRun(r, ref)),
      };
    },
    streamEvents(scope, ref, cursor) {
      const reference = sessionRef(ref);
      if (
        !/^(0|[1-9][0-9]*)$/.test(cursor) ||
        !Number.isSafeInteger(Number(cursor))
      ) {
        throw new BridgeError("invalid_runtime_cursor");
      }
      const controller = new AbortController();
      let used = false;
      return {
        close() {
          controller.abort();
        },
        async *[Symbol.asyncIterator](): AsyncGenerator<RuntimeEvent> {
          if (used) throw new BridgeError("runtime_stream_already_consumed");
          used = true;
          if (controller.signal.aborted) return;
          let result: Response | undefined;
          try {
            result = await client.openEventStream(
              (refresh) => authorize(scope, refresh),
              reference,
              cursor,
              controller.signal,
            );
            for await (const event of readAmrEvents(result)) {
              yield {
                cursor: String(event.sequence),
                runId: event.run,
                kind: event.signal.kind,
                time: event.time,
                payload: event.signal as JsonObject,
              };
            }
          } catch (error) {
            if (!controller.signal.aborted) {
              const failure = toBridgeError(error);
              if (failure instanceof BridgeError) throw failure;
              throw new BridgeError("runtime_stream_unavailable");
            }
          } finally {
            controller.abort();
            if (result?.body && !result.body.locked)
              await result.body.cancel().catch(() => undefined);
          }
        },
      };
    },
  };
}

export { runtimeAuthorization as createRuntimeAuthorization } from "./authorization.js";
