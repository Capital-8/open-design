import { expect, it } from "vitest";
import {
  accessibleMemberships,
  selectWorkspace,
  allowInvite,
} from "../src/workspaces/index.js";
import { requireAdmission, billingProjection } from "../src/billing/index.js";
import type {
  WorkspaceMembership,
  WorkspaceContext,
} from "../src/workspaces/index.js";
const membership = {
  workspaceId: "one",
  workspaceMemberId: "member",
  memberStatus: "active",
  lifecycleState: "active",
} as WorkspaceMembership;
it("scopes workspace selection and invitation authority", () => {
  expect(() => selectWorkspace([membership], "two")).toThrow(
    "workspace_selection_unavailable",
  );
  expect(() => selectWorkspace([membership], "one", "other")).toThrow(
    "workspace_selection_unavailable",
  );
  expect(() =>
    allowInvite({
      workspaceType: "team",
      role: "member",
      lifecycleState: "active",
      permissions: { canInviteMembers: true },
    } as WorkspaceContext),
  ).toThrow("forbidden");
  expect(() =>
    accessibleMemberships(
      { id: "u", email: "e", name: null, image: null, status: "banned" },
      [membership],
    ),
  ).toThrow("account_restricted");
});
it("rejects stale or cross-workspace admission without consuming retry evidence", () => {
  const fact = {
    principalId: "u",
    workspaceId: "one",
    workspaceMemberId: "member",
    checkedAt: 100,
  };
  requireAdmission(fact, "u", "one", 200);
  requireAdmission(fact, "u", "one", 200);
  expect(() => requireAdmission(fact, "u", "two", 200)).toThrow();
  expect(() => requireAdmission(fact, "u", "one", 20000)).toThrow();
  const now = Date.now();
  const preflight = {
    workspaceId: "one",
    workspaceMemberId: "member",
    modelId: null,
    generatedAt: new Date(now).toISOString(),
    balanceUsd: "1",
    funding: "wallet",
    codingPlan: { workspaceId: "one", windows: [] },
  };
  expect(() =>
    billingProjection(
      membership,
      {
        snapshot: {
          workspaceId: "other",
          workspaceMemberId: "member",
          billingScopeVersion: 2,
          wallet: { balanceUsd: "1", expiresAt: null, updatedAt: null },
        },
        balance: null,
        preflight,
      },
      null,
      now,
    ),
  ).toThrow("Unable to verify");
});
