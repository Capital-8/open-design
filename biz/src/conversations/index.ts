import { randomUUID } from "node:crypto";
import { db } from "@open-design/bridge";
import { BizError, unavailable } from "../errors.js";
import {
  lockProject,
  ready,
  workspaceFor,
  conversationFor,
} from "../access.js";
import { conversationDTO } from "../model.js";
import type { ExternalCreation } from "../projects/index.js";
export async function prepareConversation(
  owner: string,
  projectId: string,
  workspaceId: string,
  input: { id: string; title?: string | null },
  now = Date.now(),
) {
  const token = randomUUID();
  return db.transaction(async (tx) => {
    const project = await lockProject(tx, owner, projectId);
    ready(project);
    workspaceFor(project, workspaceId);
    const conversation = await tx.conversations.insert({
      id: input.id,
      project_id: projectId,
      title: input.title ?? null,
      creation_status: "provisioning",
      operation_owner: token,
      operation_expires_at: new Date(now + 120000).toISOString(),
    });
    if (conversation) return { project, conversation, token, execute: true };
    const old = await tx.conversations.get(input.id);
    if (!old || old.project_id !== projectId) throw unavailable();
    if (old.title !== (input.title ?? null)) throw new BizError("conflict");
    return {
      project,
      conversation: old,
      token: old.operation_owner,
      execute: false,
    };
  });
}
export async function finishConversation(
  projectId: string,
  id: string,
  token: string,
  result: ExternalCreation,
) {
  return db.transaction(async (tx) => {
    await tx.projects.lock(projectId);
    const c = await tx.conversations.lock(id);
    if (!c || c.project_id !== projectId || c.operation_owner !== token)
      throw new BizError("operation_superseded");
    if (!["provisioning", "creation_unknown"].includes(c.creation_status))
      return c;
    return (await tx.conversations.update(
      id,
      {
        creation_status: result.ok
          ? "ready"
          : result.uncertain
            ? "creation_unknown"
            : "failed",
        runtime_session_id: result.ok ? result.id : null,
        creation_error: result.ok ? null : result.code,
        upstream_request_id: !result.ok ? (result.requestId ?? null) : null,
        operation_expires_at: null,
      },
      c.revision,
    ))!;
  });
}
export { conversationDTO, conversationFor };
