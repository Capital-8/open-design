import { randomUUID } from "node:crypto";
import { db, type DataObject } from "@open-design/bridge";
import { BizError, busy } from "../errors.js";
import { projectFor, lockProject, ready, workspaceFor } from "../access.js";
import { canonical, projectDTO } from "../model.js";
export interface CreateProjectInput {
  id: string;
  name: string;
  workspaceId: string;
  runtimeId: string;
  metadata?: DataObject;
  legacy?: DataObject | null;
}
export type ExternalCreation =
  | { ok: true; id: string }
  | { ok: false; code: string; uncertain: boolean; requestId?: string };
export async function prepareProject(
  owner: string,
  input: CreateProjectInput,
  now = Date.now(),
) {
  const token = randomUUID();
  return db.transaction(async (tx) => {
    const p = await tx.projects.insert({
      id: input.id,
      owner_id: owner,
      name: input.name,
      runtime_id: input.runtimeId,
      workspace_id: input.workspaceId,
      metadata_json: input.metadata ?? {},
      legacy: input.legacy ?? null,
      creation_status: "provisioning",
      operation_owner: token,
      operation_expires_at: new Date(now + 120000).toISOString(),
    });
    if (p) return { project: p, token, execute: true };
    const previous = await projectFor(owner, input.id, tx);
    if (
      previous.name !== input.name ||
      previous.workspace_id !== input.workspaceId ||
      canonical(previous.metadata_json) !== canonical(input.metadata ?? {}) ||
      canonical(previous.legacy) !== canonical(input.legacy ?? null)
    )
      throw new BizError("conflict");
    return {
      project: previous,
      token: previous.operation_owner,
      execute: false,
    };
  });
}
export async function finishProject(
  id: string,
  token: string,
  result: ExternalCreation,
) {
  return db.transaction(async (tx) => {
    const p = await tx.projects.lock(id);
    if (!p || p.operation_owner !== token)
      throw new BizError("operation_superseded");
    if (!["provisioning", "creation_unknown"].includes(p.creation_status))
      return p;
    return (await tx.projects.update(
      id,
      {
        creation_status: result.ok
          ? "ready"
          : result.uncertain
            ? "creation_unknown"
            : "failed",
        runtime_project_id: result.ok ? result.id : null,
        creation_error: result.ok ? null : result.code,
        upstream_request_id: !result.ok ? (result.requestId ?? null) : null,
        operation_expires_at: null,
      },
      p.revision,
    ))!;
  });
}
export async function listProjects(owner: string, workspaceId: string) {
  return (await db.read().projects.forOwner(owner)).filter(
    (p) => p.workspace_id === workspaceId,
  );
}
export async function updateProject(
  owner: string,
  id: string,
  workspaceId: string,
  patch: { name?: string; metadata?: DataObject; legacy?: DataObject },
) {
  return db.transaction(async (tx) => {
    const p = await lockProject(tx, owner, id);
    workspaceFor(p, workspaceId);
    ready(p);
    if (p.active_run_id || p.edit_state !== "idle") throw busy();
    return (await tx.projects.update(
      id,
      {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.metadata ? { metadata_json: patch.metadata } : {}),
        ...(patch.legacy ? { legacy: patch.legacy } : {}),
      },
      p.revision,
    ))!;
  });
}
/** Only expired operations become unknown. Never restart an unconfirmed remote create. */
export async function recoverOperations(now = Date.now()) {
  for (const item of await db.read().projects.expiredOperations())
    await db.transaction(async (tx) => {
      const p = await tx.projects.lock(item.id);
      if (
        !p ||
        (p.operation_expires_at && Date.parse(p.operation_expires_at) > now)
      )
        return;
      if (p.creation_status === "provisioning")
        await tx.projects.update(
          p.id,
          {
            creation_status: "creation_unknown",
            creation_error: "creation_interrupted",
          },
          p.revision,
        );
      else if (p.edit_state === "editing")
        await tx.projects.update(p.id, { edit_state: "unknown" }, p.revision);
    });
  for (const item of await db.read().conversations.expiredOperations())
    await db.transaction(async (tx) => {
      await tx.projects.lock(item.project_id);
      const c = await tx.conversations.lock(item.id);
      if (
        c?.creation_status === "provisioning" &&
        (!c.operation_expires_at || Date.parse(c.operation_expires_at) <= now)
      )
        await tx.conversations.update(
          c.id,
          {
            creation_status: "creation_unknown",
            creation_error: "creation_interrupted",
          },
          c.revision,
        );
    });
}
export { projectFor, projectDTO };
