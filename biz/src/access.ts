import {
  db,
  type DbRead,
  type DbTransaction,
  type ProjectRecord,
} from "@open-design/bridge";
import { BizError, unavailable } from "./errors.js";
export async function projectFor(
  owner: string,
  id: string,
  reader: DbRead = db.read(),
) {
  const p = await reader.projects.get(id);
  if (!p || p.owner_id !== owner) throw unavailable();
  return p;
}
export async function lockProject(
  tx: DbTransaction,
  owner: string,
  id: string,
) {
  const p = await tx.projects.lock(id);
  if (!p || p.owner_id !== owner) throw unavailable();
  return p;
}
export async function conversationFor(
  owner: string,
  id: string,
  reader: DbRead = db.read(),
) {
  const c = await reader.conversations.get(id);
  if (!c) throw unavailable();
  const project = await projectFor(owner, c.project_id, reader);
  return { conversation: c, project };
}
export async function runFor(
  owner: string,
  id: string,
  reader: DbRead = db.read(),
) {
  const run = await reader.runs.get(id);
  if (!run) throw unavailable();
  return {
    ...(await conversationFor(owner, run.conversation_id, reader)),
    run,
  };
}
export function ready(value: { creation_status: string }) {
  if (value.creation_status !== "ready")
    throw new BizError(
      value.creation_status === "creation_unknown"
        ? "creation_unknown"
        : "resource_not_ready",
    );
}
export function workspaceFor(project: ProjectRecord, workspaceId: string) {
  if (!project.workspace_id || project.workspace_id !== workspaceId)
    throw new BizError("workspace_selection_unavailable");
}
