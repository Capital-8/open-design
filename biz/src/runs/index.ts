import { createHash, randomUUID } from "node:crypto";
import {
  db,
  type DataObject,
  type RuntimeScope,
  type RunRecord,
} from "@open-design/bridge";
import { BizError, busy, unavailable } from "../errors.js";
import {
  conversationFor,
  lockProject,
  ready,
  workspaceFor,
  runFor,
} from "../access.js";
import { runDTO, messageDTO, terminal, canonical } from "../model.js";
import { requireAdmission, type BillingAdmission } from "../billing/index.js";
export const requestDigest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export async function existingRun(
  owner: string,
  conversationId: string,
  key: string,
  original: string,
  requestHash: string,
) {
  await conversationFor(owner, conversationId);
  const previous = await db.read().runs.byRequest(conversationId, key);
  if (!previous) return null;
  const message = await db.read().messages.userForRun(previous.id);
  if (
    message?.content !== original ||
    previous.legacy?.requestHash !== requestHash
  )
    throw new BizError("conflict");
  return previous;
}
export interface SubmitInput {
  conversationId: string;
  clientRequestId: string;
  original: string;
  modelInput: string;
  requestHash: string;
  legacy: DataObject;
  projectRevision: number;
  conversationRevision: number;
  scope: RuntimeScope;
  environment: string;
  admission: BillingAdmission;
}
export async function submitRun(
  owner: string,
  input: SubmitInput,
  now = Date.now(),
) {
  if (
    !input.clientRequestId ||
    input.clientRequestId.length > 128 ||
    !input.original.trim() ||
    Buffer.byteLength(input.original) > 65536
  )
    throw new BizError("invalid_input");
  if (!input.modelInput.trim() || Buffer.byteLength(input.modelInput) > 262144)
    throw new BizError("input_context_too_large");
  const initial = await conversationFor(owner, input.conversationId);
  return db.transaction(async (tx) => {
    const p = await lockProject(tx, owner, initial.project.id),
      c = await tx.conversations.lock(input.conversationId);
    if (!c || c.project_id !== p.id) throw unavailable();
    workspaceFor(p, input.scope.workspaceId);
    const previous = await tx.runs.byRequest(c.id, input.clientRequestId);
    if (previous) {
      const message = await tx.messages.userForRun(previous.id);
      if (
        message?.content !== input.original ||
        previous.legacy?.requestHash !== input.requestHash
      )
        throw new BizError("conflict");
      return previous;
    }
    ready(p);
    ready(c);
    if (p.active_run_id || p.edit_state !== "idle") throw busy();
    if (
      p.revision !== input.projectRevision ||
      c.revision !== input.conversationRevision
    )
      throw new BizError("input_changed");
    if (input.scope.principalId !== owner) throw new BizError("unauthorized");
    requireAdmission(input.admission, owner, input.scope.workspaceId, now);
    const account = await tx.accounts.get(owner);
    if (account?.status !== "active") throw new BizError("account_restricted");
    const id = randomUUID(),
      run = (await tx.runs.insert({
        id,
        conversation_id: c.id,
        client_request_id: input.clientRequestId,
        input: input.modelInput,
        input_hash: createHash("sha256").update(input.modelInput).digest("hex"),
        legacy: { ...input.legacy, requestHash: input.requestHash },
        principal_id: owner,
        workspace_id: input.scope.workspaceId,
        credential_ref: input.scope.credentialRef,
        provider_environment: input.environment,
        authorization_state: "ready",
      }))!;
    const message = (await tx.messages.insert({
      id: randomUUID(),
      conversation_id: c.id,
      run_id: id,
      role: "user",
      content: input.original,
    }))!;
    await tx.projects.update(p.id, { active_run_id: id }, p.revision);
    await tx.outbox.enqueue(id, "submit");
    await tx.events.append(c.id, {
      kind: "message.complete",
      runId: id,
      message: messageDTO(message),
    });
    await tx.events.append(c.id, { kind: "run.updated", run: runDTO(run) });
    return run;
  });
}
export async function cancelRun(owner: string, id: string) {
  const initial = await runFor(owner, id);
  return db.transaction(async (tx) => {
    const p = await lockProject(tx, owner, initial.project.id);
    await tx.conversations.lock(initial.conversation.id);
    const run = await tx.runs.lock(id);
    if (!run) throw unavailable();
    if (terminal(run.status)) return run;
    const patch: Partial<RunRecord> = { cancel_requested: true };
    // Pending means no dispatch intent was committed. Unknown submissions require upstream confirmation.
    if (run.submission === "pending" && !run.runtime_run_id) {
      Object.assign(patch, { status: "cancelled", cancel_confirmed: true });
      if (p.active_run_id === id)
        await tx.projects.update(p.id, { active_run_id: null }, p.revision);
    }
    const updated = (await tx.runs.update(id, patch, run.revision))!;
    if (!terminal(updated.status)) await tx.outbox.enqueue(id, "cancel");
    if (!run.cancel_requested)
      await tx.events.append(run.conversation_id, {
        kind: "run.updated",
        run: runDTO(updated),
      });
    return updated;
  });
}
export async function snapshot(owner: string, conversationId: string) {
  return db.transaction(async (tx) => {
    const initial = await conversationFor(owner, conversationId, tx);
    const project = await lockProject(tx, owner, initial.project.id);
    const conversation = await tx.conversations.lock(conversationId);
    if (!conversation) throw unavailable();
    return {
      project,
      conversation,
      messages: await tx.messages.forConversation(conversationId),
      runs: await tx.runs.forConversation(conversationId),
      cursor: conversation.event_sequence,
    };
  });
}
export async function saveDraft(
  owner: string,
  conversationId: string,
  id: string,
  content: string,
) {
  if (!id || id.length > 128 || Buffer.byteLength(content) > 65536)
    throw new BizError("invalid_input");
  const a = await conversationFor(owner, conversationId);
  return db.transaction(async (tx) => {
    await lockProject(tx, owner, a.project.id);
    await tx.conversations.lock(conversationId);
    const previous = (await tx.drafts.forConversation(conversationId)).find(
      (v) => v.id === id,
    );
    if (previous && previous.content !== content)
      throw new BizError("conflict");
    await tx.drafts.put({ conversation_id: conversationId, id, content });
    return (await tx.drafts.forConversation(conversationId)).find(
      (v) => v.id === id,
    )!;
  });
}

export async function requestBlockedRecovery(owner: string, projectId: string) {
  return db.transaction(async (tx) => {
    const project = await lockProject(tx, owner, projectId);
    if (!project.active_run_id) return false;
    const initial = await tx.runs.get(project.active_run_id);
    if (!initial) return false;
    await tx.conversations.lock(initial.conversation_id);
    const run = await tx.runs.lock(initial.id);
    if (
      run?.status !== "blocked" ||
      run.cancel_requested ||
      run.authorization_state !== "ready"
    )
      return false;
    await tx.outbox.enqueue(run.id, "recover");
    return true;
  });
}
export async function conversationEvents(
  owner: string,
  id: string,
  cursor: string,
) {
  const a = await conversationFor(owner, id);
  if (
    !/^(0|[1-9]\d{0,18})$/.test(cursor) ||
    BigInt(cursor) > BigInt(a.conversation.event_sequence)
  )
    throw new BizError("invalid_cursor");
  return db.read().events.after(id, cursor, 200);
}
