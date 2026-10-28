import { DependencyError } from "../error.js";
import {
  eventSchema,
  runSchema,
  snapshotSchema,
  type AmrEvent,
  type AmrRun,
} from "./schemas/runtime.js";
import { sseFrames } from "./sse.js";
import { createRuntimeHttp } from "./internal/runtime-http.js";
import type {
  AmrAuthorization,
  AmrRuntimeClientOptions,
  AmrSessionRef,
  AmrRunRef,
  AmrRunInput,
} from "./types.js";
function sessionPath(ref: AmrSessionRef): string {
  return (
    "/v1/projects/" +
    encodeURIComponent(ref.project) +
    "/sessions/" +
    encodeURIComponent(ref.session)
  );
}
function runPath(ref: AmrRunRef): string {
  return sessionPath(ref) + "/runs/" + encodeURIComponent(ref.run);
}
function parseRun(value: unknown, uncertain: boolean): AmrRun {
  const parsed = runSchema.safeParse(value);
  if (!parsed.success)
    throw new DependencyError("runtime_protocol_error", uncertain);
  return parsed.data;
}

export function createAmrRuntimeClient(options: AmrRuntimeClientOptions) {
  const { request, response } = createRuntimeHttp(options);
  return {
    async submitRun(
      authorize: AmrAuthorization,
      ref: AmrSessionRef,
      input: AmrRunInput,
    ) {
      return parseRun(
        await request(authorize, sessionPath(ref) + "/runs", "POST", input),
        true,
      );
    },
    async getRun(authorize: AmrAuthorization, ref: AmrRunRef) {
      return parseRun(await request(authorize, runPath(ref)), false);
    },
    async cancelRun(
      authorize: AmrAuthorization,
      ref: AmrRunRef,
    ): Promise<void> {
      const result = await response(authorize, runPath(ref) + "/cancel", {
        method: "POST",
      });
      await result.body?.cancel().catch(() => undefined);
    },
    async recoverRun(authorize: AmrAuthorization, ref: AmrRunRef) {
      return parseRun(
        await request(authorize, runPath(ref) + "/recover", "POST"),
        true,
      );
    },
    async getSnapshot(authorize: AmrAuthorization, ref: AmrSessionRef) {
      const parsed = snapshotSchema.safeParse(
        await request(authorize, sessionPath(ref)),
      );
      if (!parsed.success) throw new DependencyError("runtime_protocol_error");
      return parsed.data;
    },
    // The adapter owns subscription close/consumption semantics. The protocol owns HTTP and decoding.
    openEventStream(
      authorize: AmrAuthorization,
      ref: AmrSessionRef,
      cursor: string,
      signal: AbortSignal,
    ) {
      return response(
        authorize,
        sessionPath(ref) + "/stream",
        { headers: { Accept: "text/event-stream", "Last-Event-ID": cursor } },
        signal,
      );
    },
  };
}

export async function* readAmrEvents(
  response: Response,
): AsyncGenerator<AmrEvent> {
  if (
    !response.headers.get("content-type")?.includes("text/event-stream") ||
    !response.body
  ) {
    throw new DependencyError("runtime_protocol_error");
  }
  for await (const frame of sseFrames(response.body)) {
    let raw: unknown;
    try {
      raw = JSON.parse(frame.data);
    } catch {
      throw new DependencyError("runtime_protocol_error");
    }
    const parsed = eventSchema.safeParse(raw);
    if (!parsed.success || String(parsed.data.sequence) !== frame.id)
      throw new DependencyError("runtime_protocol_error");
    yield parsed.data;
  }
}
