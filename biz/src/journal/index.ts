import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  db,
  type DbTransaction,
  type ConversationRecord,
  type ExecutionRun,
  type ExecutionSnapshot,
  type RuntimeEvent,
} from "@open-design/bridge";
import { runState } from "@open-design/contracts/cloud/api";
import { BizError, unavailable } from "../errors.js";
import { messageDTO, runDTO, terminal } from "../model.js";
const safeSequence = z.union([
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(String),
  z.string().regex(/^[1-9]\d*$/),
]);
const remoteMessage = z.object({
  sequence: safeSequence,
  run: z.string().min(1),
  role: z.enum(["user", "assistant", "tool", "system"]),
  text: z.string(),
  turn: z.string().optional(),
  calls: z
    .array(
      z.object({ id: z.string(), name: z.string(), arguments: z.string() }),
    )
    .optional(),
  call: z.string().optional(),
});
const runtimeFailures = new Set([
  "round_budget_exceeded",
  "run_authorization_denied",
  "runtime_dependency_unavailable",
  "runtime_dependency_timeout",
  "runtime_internal_failure",
  "model_budget_exceeded",
  "model_timeout",
  "model_upstream_unavailable",
  "model_protocol_error",
]);
export async function locked<T>(
  conversationId: string,
  fn: (tx: DbTransaction, c: ConversationRecord) => Promise<T>,
) {
  const initial = await db.read().conversations.get(conversationId);
  if (!initial) throw unavailable();
  return db.transaction(async (tx) => {
    await tx.projects.lock(initial.project_id);
    const c = await tx.conversations.lock(conversationId);
    if (!c) throw unavailable();
    return fn(tx, c);
  });
}
export async function materialize(
  tx: DbTransaction,
  c: ConversationRecord,
  value: unknown,
) {
  const parsed = remoteMessage.safeParse(value);
  if (!parsed.success) throw new BizError("runtime_protocol_error");
  const remote = parsed.data;
  const run = await tx.runs.byRemote(c.id, remote.run);
  if (!run) return null;
  const row =
    remote.role === "user"
      ? await tx.messages.linkUser(run.id, remote.sequence, remote.turn ?? null)
      : await tx.messages.upsertRemote({
          id: randomUUID(),
          conversation_id: c.id,
          run_id: run.id,
          role: remote.role,
          content: remote.text,
          runtime_sequence: remote.sequence,
          turn: remote.turn ?? null,
          calls: remote.calls ?? null,
          tool_call_id: remote.call ?? null,
        });
  if (!row) throw new BizError("runtime_protocol_error");
  if (remote.role === "tool") {
    let result: unknown;
    try {
      result = JSON.parse(remote.text);
    } catch {
      /* Not every tool result is a durability attestation. */
    }
    const attestation = z
      .object({
        result: z.object({
          files: z.enum(["saved", "unknown", "not_attested"]),
          cleanup: z.string().optional(),
        }),
      })
      .safeParse(result);
    if (attestation.success) {
      await tx.runs.update(run.id, {
        files:
          run.files === "unknown" ? "unknown" : attestation.data.result.files,
        cleanup: attestation.data.result.cleanup ?? null,
      });
      if (attestation.data.result.files === "unknown")
        await tx.projects.update(c.project_id, { edit_state: "unknown" });
    }
  }
  return messageDTO(row);
}
export async function updateRun(
  tx: DbTransaction,
  c: ConversationRecord,
  remote: Pick<ExecutionRun, "ref" | "status"> &
    Partial<Pick<ExecutionRun, "detail">>,
) {
  const parsed = runState.safeParse(remote.status);
  if (!parsed.success) throw new BizError("runtime_protocol_error");
  const previous = await tx.runs.byRemote(c.id, remote.ref.runId);
  if (!previous) return;
  if (terminal(previous.status) && previous.status !== parsed.data) return;
  const code =
    parsed.data !== "failed"
      ? null
      : remote.detail && runtimeFailures.has(remote.detail)
        ? remote.detail
        : (previous.error_code ?? "runtime_failed");
  const row = (await tx.runs.update(previous.id, {
    status: parsed.data,
    cancel_confirmed: parsed.data === "cancelled",
    submission: "confirmed",
    error_code: code,
  }))!;
  if (terminal(row.status)) {
    const p = await tx.projects.get(c.project_id);
    if (p?.active_run_id === row.id)
      await tx.projects.update(p.id, { active_run_id: null });
  }
  if (
    previous.status !== row.status ||
    previous.submission !== row.submission ||
    previous.error_code !== row.error_code
  )
    await tx.events.append(c.id, { kind: "run.updated", run: runDTO(row) });
}
export async function mergeSnapshot(
  tx: DbTransaction,
  c: ConversationRecord,
  snapshot: ExecutionSnapshot,
  replaceCursorAt?: string,
) {
  if (
    snapshot.session.sessionId !== c.runtime_session_id ||
    !/^(0|[1-9]\d*)$/.test(snapshot.cursor)
  )
    throw new BizError("runtime_protocol_error");
  if (replaceCursorAt !== undefined && replaceCursorAt !== c.runtime_cursor)
    return false;
  if (
    BigInt(snapshot.cursor) < BigInt(c.runtime_cursor) &&
    replaceCursorAt === undefined
  )
    return false;
  for (const message of snapshot.messages) await materialize(tx, c, message);
  for (const run of snapshot.runs) await updateRun(tx, c, run);
  if (snapshot.cursor !== c.runtime_cursor)
    await tx.events.append(c.id, { kind: "snapshot.updated" });
  await tx.conversations.update(c.id, { runtime_cursor: snapshot.cursor });
  return true;
}
export async function applyEvent(
  conversationId: string,
  event: RuntimeEvent,
  credentialRef: string,
) {
  if (!/^[1-9]\d*$/.test(event.cursor))
    throw new BizError("runtime_protocol_error");
  await locked(conversationId, async (tx, c) => {
    if (BigInt(event.cursor) <= BigInt(c.runtime_cursor)) return;
    if (BigInt(event.cursor) !== BigInt(c.runtime_cursor) + 1n)
      throw new BizError("invalid_cursor");
    if (await tx.events.byRuntimeSequence(c.id, event.cursor)) {
      await tx.conversations.update(c.id, { runtime_cursor: event.cursor });
      return;
    }
    const run = await tx.runs.byRemote(c.id, event.runId);
    if (
      run &&
      (run.credential_ref !== credentialRef ||
        run.authorization_state !== "ready" ||
        (await tx.credentials.authorization(credentialRef))?.reason ===
          "logout")
    )
      throw new BizError("authorization_changed");
    const s = event.payload;
    let payload: Record<string, unknown> | undefined;
    if (run)
      switch (event.kind) {
        case "message.start":
        case "message.abort":
          payload = {
            kind: event.kind,
            runId: run.id,
            ...(typeof s.turn === "string" ? { turn: s.turn } : {}),
          };
          break;
        case "message.delta":
          payload = {
            kind: "message.delta",
            runId: run.id,
            delta: { turn: s.turn, text: s.text, calls: s.calls },
          };
          break;
        case "message.complete": {
          if (!s.message || typeof s.message !== "object")
            throw new BizError("runtime_protocol_error");
          const message = await materialize(tx, c, {
            ...s.message,
            run: event.runId,
          });
          if (message)
            payload = { kind: "message.complete", runId: run.id, message };
          break;
        }
        case "tool.state":
          payload = {
            kind: "tool.state",
            runId: run.id,
            call: s.call,
            execution: s.execution,
            status: s.status,
          };
          break;
        case "status":
          if (typeof s.status === "string") {
            if (terminal(s.status))
              await tx.outbox.enqueue(run.id, "reconcile");
            else
              await updateRun(tx, c, {
                ref: {
                  projectId: "",
                  sessionId: c.runtime_session_id!,
                  runId: event.runId,
                },
                status: s.status,
              });
          }
          break;
      }
    if (payload) await tx.events.append(c.id, payload, event.cursor);
    await tx.conversations.update(c.id, { runtime_cursor: event.cursor });
  });
}

export async function mergeRecoverySnapshot(
  conversationId: string,
  snapshot: ExecutionSnapshot,
  credentialRef: string,
  observedCursor: string,
) {
  return locked(conversationId, async (tx, c) => {
    const p = await tx.projects.get(c.project_id),
      run = p?.active_run_id ? await tx.runs.get(p.active_run_id) : null;
    if (
      !run ||
      run.credential_ref !== credentialRef ||
      run.authorization_state !== "ready" ||
      (await tx.credentials.authorization(credentialRef))?.reason === "logout"
    )
      return false;
    return mergeSnapshot(tx, c, snapshot, observedCursor);
  });
}
