import { z } from "zod";
import type { WorkspaceMembership } from "./workspaces.js";

// Read-only subset of the original client's WorkspaceDirectory/Context contract.
// These are real Vela memberships, not new cloud POC workspaces or permissions.
export const legacyPersonalWorkspace = z.object({
  workspaceId: z.string().min(1),
  workspaceName: z.string().min(1),
  workspaceType: z.literal("personal"),
  workspaceMemberId: z.string().min(1),
  role: z.literal("owner"),
  memberStatus: z.literal("active"),
  lifecycleState: z.enum(["active", "billing_past_due", "locked"]),
});
export type LegacyPersonalWorkspace = z.infer<typeof legacyPersonalWorkspace>;
export const legacyWorkspaceSelection = z.object({
  workspaceId: z.string().min(1).max(256),
  workspaceMemberId: z.string().min(1).max(256),
});
