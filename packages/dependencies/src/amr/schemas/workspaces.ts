import { z } from "zod";

export type AmrWorkspaceRequest =
  | { kind: "directory" }
  | { kind: "context"; workspaceId: string }
  | { kind: "members"; workspaceId: string }
  | {
      kind: "invite";
      workspaceId: string;
      invitedEmail: string;
      role: "admin" | "member";
    };

export const workspaceMembership = z.object({
  workspaceId: z.string().min(1).max(256),
  workspaceName: z.string().min(1),
  workspaceIconKey: z.string().optional(),
  workspaceType: z.enum(["personal", "team"]),
  workspaceMemberId: z.string().min(1).max(256),
  role: z.enum(["owner", "admin", "member"]),
  memberStatus: z.enum(["active", "removed"]),
  lifecycleState: z.enum([
    "active",
    "billing_past_due",
    "locked",
    "deleting",
    "deleted",
  ]),
});
export type WorkspaceMembership = z.infer<typeof workspaceMembership>;
export const workspaceDirectory = z.object({
  items: z.array(workspaceMembership),
});
export const amrWorkspaceContext = workspaceMembership.extend({
  userId: z.string().min(1),
  billingState: z
    .enum(["free", "active", "past_due", "canceled", "inactive", "locked"])
    .optional(),
  planId: z.string().nullable().optional(),
  personalMembershipTier: z.string().nullable().optional(),
  billingRecovery: z
    .object({
      canEnterBillingRecovery: z.boolean(),
      recoveryUrl: z.string().nullable(),
    })
    .optional(),
  providerMode: z.enum(["platform_credits", "personal_byok"]),
  seatSummary: z
    .object({
      seatLimit: z.number().int().nonnegative(),
      usedSeats: z.number().int().nonnegative(),
      availableSeats: z.number().int().nonnegative(),
      isSeatFull: z.boolean(),
    })
    .optional(),
  permissions: z.object({
    canManageMembers: z.boolean(),
    canManageBilling: z.boolean(),
    canInviteMembers: z.boolean(),
    canManageAutoRecharge: z.boolean(),
    canShareProjects: z.boolean(),
    canWriteSyncedFiles: z.boolean(),
    canViewWorkspaceSettings: z.boolean(),
    canManageSharedResources: z.boolean(),
  }),
});
export const amrMemberDirectory = z.object({
  workspaceId: z.string().min(1),
  members: z.array(
    z.object({
      id: z.string().min(1),
      displayLabel: z.string().min(1),
      role: z.enum(["owner", "admin", "member"]),
      status: z.literal("active"),
    }),
  ),
});
