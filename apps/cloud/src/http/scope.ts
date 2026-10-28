import type { Request } from "express";
export const scopeRequest = (
  req: Request,
): import("../facades/projects/index.js").ScopeRequest => ({
  workspaceId: req.get("x-od-workspace-id") ?? req.query.workspaceId,
  memberId: req.get("x-od-workspace-member-id") ?? req.query.workspaceMemberId,
  write: !["GET", "HEAD"].includes(req.method),
});
