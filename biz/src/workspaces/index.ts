import type { z } from "zod";
import type {
  WorkspaceMembership,
  velaWorkspaceContext,
} from "@open-design/contracts/cloud/workspaces";
import { BizError } from "../errors.js";
import { requireActive, type Actor } from "../account/index.js";
export type { WorkspaceMembership } from "@open-design/contracts/cloud/workspaces";
export type WorkspaceContext = z.infer<typeof velaWorkspaceContext>;
export function accessibleMemberships(
  actor: Actor,
  items: WorkspaceMembership[],
) {
  requireActive(actor);
  return items.filter(
    (item) =>
      item.memberStatus === "active" &&
      !["deleting", "deleted"].includes(item.lifecycleState),
  );
}
export function selectWorkspace(
  items: WorkspaceMembership[],
  workspaceId: unknown,
  memberId?: unknown,
) {
  if (typeof workspaceId !== "string" || !workspaceId)
    throw new BizError("workspace_selection_required");
  const item = items.find(
    (item) =>
      item.workspaceId === workspaceId &&
      (memberId === undefined || item.workspaceMemberId === memberId),
  );
  if (!item) throw new BizError("workspace_selection_unavailable");
  return item;
}
export function activeWorkspace(item: WorkspaceMembership) {
  if (item.memberStatus !== "active" || item.lifecycleState !== "active")
    throw new BizError("workspace_unavailable");
}
export function workspaceContext(
  actor: Actor,
  item: WorkspaceMembership,
  value: WorkspaceContext,
  settingsUrl: string,
) {
  if (
    value.userId !== actor.id ||
    value.workspaceId !== item.workspaceId ||
    value.workspaceMemberId !== item.workspaceMemberId ||
    value.memberStatus !== "active" ||
    ["deleting", "deleted"].includes(value.lifecycleState)
  )
    throw new BizError("workspace_selection_unavailable");
  return {
    ...legacyWorkspaceContext(item, actor, true),
    ...value,
    billingState: value.billingState,
    seatSummary: value.seatSummary,
    billingRecovery: value.billingRecovery
      ? {
          canEnterBillingRecovery:
            value.billingRecovery.canEnterBillingRecovery,
          recoveryUrl: value.billingRecovery.canEnterBillingRecovery
            ? settingsUrl
            : null,
        }
      : undefined,
    ...(value.workspaceType === "team"
      ? { teamId: value.workspaceId, teamName: value.workspaceName }
      : {}),
    workspaceSettingsUrl: settingsUrl,
    permissions: {
      ...value.permissions,
      canShareProjects: false,
      canManageSharedResources: false,
    },
  };
}
export function allowInvite(context: WorkspaceContext) {
  if (
    context.workspaceType !== "team" ||
    !context.permissions.canInviteMembers ||
    !["owner", "admin"].includes(context.role) ||
    context.lifecycleState !== "active"
  )
    throw new BizError("forbidden");
}
export function legacyWorkspaceContext(
  item: WorkspaceMembership,
  user: { name: string | null; email: string; image: string | null },
  canWritePersonalProjects = false,
) {
  return {
    ...item,
    displayName: user.name || user.email,
    avatarUrl: user.image,
    // Same directory-only unknown billing/seat projection as the old daemon.
    billingState:
      item.lifecycleState === "billing_past_due"
        ? "past_due"
        : item.lifecycleState === "locked"
          ? "locked"
          : "free",
    planId: null,
    providerMode: "platform_credits",
    seatSummary: {
      seatLimit: 0,
      usedSeats: 0,
      availableSeats: 0,
      isSeatFull: false,
    },
    // Legacy UI uses this bit to gate all project writes, including private
    // chat. Only the enabled cloud adapter grants personal-project writing;
    // actual mutations still check identity, membership and project ownership.
    permissions: {
      canManageMembers: false,
      canManageBilling: false,
      canInviteMembers: false,
      canManageAutoRecharge: false,
      canShareProjects: false,
      canWriteSyncedFiles:
        canWritePersonalProjects && item.lifecycleState === "active",
      canViewWorkspaceSettings: false,
      canManageSharedResources: false,
    },
  };
}

export function requireWorkspaceWrite(
  context: WorkspaceContext,
  write = false,
) {
  activeWorkspace(context);
  if (write && !context.permissions.canWriteSyncedFiles)
    throw new BizError("workspace_read_only");
}
export function requireSelectable(context: WorkspaceContext) {
  if (["locked", "deleting", "deleted"].includes(context.lifecycleState))
    throw new BizError("workspace_selection_unavailable");
}
export function requireConversationProject(actual: string, expected: string) {
  if (actual !== expected) throw new BizError("resource_unavailable");
}
