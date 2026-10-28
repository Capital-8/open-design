import type { WorkspaceMembership } from "../workspaces/index.js";
import { BizError } from "../errors.js";
type Wallet = {
  balanceUsd: string;
  expiresAt: string | null;
  updatedAt: string | null;
};
type Scope = { workspaceId: string; workspaceMemberId: string };
export interface BillingFacts {
  snapshot:
    | (Scope & {
        billingScopeVersion: 2;
        wallet: Wallet;
        [key: string]: unknown;
      })
    | null;
  balance: (Scope & Wallet & { billingScopeVersion: 2 }) | null;
  preflight: Scope & {
    modelId: string | null;
    generatedAt: string;
    balanceUsd: string;
    funding: string;
    codingPlan: {
      workspaceId: string;
      windows: { remainingCredits: string; limitCredits: string }[];
    };
    [key: string]: unknown;
  };
}
export function billingProjection(
  membership: WorkspaceMembership,
  facts: BillingFacts,
  modelId: string | null,
  now: number,
) {
  const { snapshot, preflight } = facts,
    balance = snapshot
      ? {
          workspaceId: snapshot.workspaceId,
          workspaceMemberId: snapshot.workspaceMemberId,
          billingScopeVersion: 2 as const,
          ...snapshot.wallet,
        }
      : facts.balance;
  const fail = () => {
    throw new BizError(
      "vela_billing_unavailable",
      "Unable to verify workspace credit",
      true,
    );
  };
  if (!balance) return fail();
  for (const value of [balance, preflight])
    if (
      value.workspaceId !== membership.workspaceId ||
      value.workspaceMemberId !== membership.workspaceMemberId
    )
      return fail();
  if (
    preflight.modelId !== modelId ||
    preflight.codingPlan.workspaceId !== membership.workspaceId ||
    Math.abs(now - Date.parse(preflight.generatedAt)) > 60000 ||
    preflight.codingPlan.windows.some(
      (w) => BigInt(w.remainingCredits) > BigInt(w.limitCredits),
    )
  )
    return fail();
  const observedAt = new Date(now).toISOString(),
    scope = {
      workspaceId: membership.workspaceId,
      workspaceMemberId: membership.workspaceMemberId,
    };
  return {
    source: "vela" as const,
    settlement: {
      status: "unavailable",
      reason: "runtime_usage_not_integrated",
    },
    summary: null,
    workspaceSnapshot: snapshot,
    workspaceBalance: balance,
    preflight,
    quotaRealtime: { healthy: false },
    workspaceRuntime: {
      ...scope,
      status: "fresh",
      revision: String(now),
      observedAt,
      softExpiresAt: new Date(now + 5000).toISOString(),
      hardExpiresAt: new Date(now + 15000).toISOString(),
      retryAt: null,
      errorCode: null,
      reason: "vela_authoritative_read",
      sourceGapDetected: false,
    },
    authoritativeWorkspaceRead: { ...scope, observedAt },
  };
}
export interface BillingAdmission {
  principalId: string;
  workspaceId: string;
  workspaceMemberId: string;
  checkedAt: number;
}
export function requireAdmission(
  value: BillingAdmission,
  principalId: string,
  workspaceId: string,
  now: number,
) {
  if (
    value.principalId !== principalId ||
    value.workspaceId !== workspaceId ||
    now - value.checkedAt > 10000 ||
    value.checkedAt > now + 1000
  )
    throw new BizError("vela_billing_unavailable");
  // This is authenticated freshness evidence, not a wallet reservation or debit.
}
