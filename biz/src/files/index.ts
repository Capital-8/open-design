import { randomUUID } from "node:crypto";
import { db, type ProjectRecord, type RuntimeScope } from "@open-design/bridge";
import { BizError, busy } from "../errors.js";
import { lockProject, ready, workspaceFor } from "../access.js";
export function fileReference(
  project: ProjectRecord,
  scope: RuntimeScope,
  path = "index.html",
) {
  ready(project);
  workspaceFor(project, scope.workspaceId);
  if (!project.runtime_project_id) throw new BizError("resource_not_ready");
  return {
    kind: "project" as const,
    scope,
    projectId: project.runtime_project_id,
    path,
  };
}
export async function prepareSave(
  owner: string,
  id: string,
  workspaceId: string,
  html: string,
  expected: string,
  now = Date.now(),
) {
  if (Buffer.byteLength(html) > 65536) throw new BizError("html_too_large");
  if (!expected) throw new BizError("invalid_version");
  const token = randomUUID();
  const project = await db.transaction(async (tx) => {
    const p = await lockProject(tx, owner, id);
    ready(p);
    workspaceFor(p, workspaceId);
    if (p.active_run_id || p.edit_state !== "idle") throw busy();
    await tx.projects.update(
      id,
      {
        edit_state: "editing",
        operation_owner: token,
        operation_expires_at: new Date(now + 120000).toISOString(),
      },
      p.revision,
    );
    return p;
  });
  return { project, token };
}
export async function finishSave(
  id: string,
  token: string,
  outcome: "confirmed" | "rejected" | "unknown",
) {
  await db.transaction(async (tx) => {
    const p = await tx.projects.lock(id);
    if (!p || p.operation_owner !== token)
      throw new BizError("operation_superseded");
    if (!["editing", "unknown"].includes(p.edit_state)) return;
    await tx.projects.update(
      id,
      {
        edit_state: outcome === "unknown" ? "unknown" : "idle",
        operation_expires_at: null,
      },
      p.revision,
    );
  });
}
