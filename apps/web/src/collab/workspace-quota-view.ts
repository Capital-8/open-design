import type { WorkspaceBillingResponse, WorkspaceCollabContext } from '@open-design/contracts';
import { workspaceBillingBalanceUsd, workspaceBillingSnapshotForContext } from './useWorkspaceContext';

export type WorkspaceQuotaTier = 'free' | 'go' | 'plus' | 'pro' | 'max';

/** Presentation values, not a new daemon/CLI wire contract. */
export interface WorkspaceQuotaView {
  tier: WorkspaceQuotaTier | null;
  planKnown: boolean;
  loading: boolean;
  balanceUsd: string | null;
  /** Only a server status may populate this; never dates. */
  planStatus: string | null;
  windows: ReadonlyArray<{
    durationSeconds: number;
    remainingPercent: number;
    resetsAt: string | null;
  }> | null;
  breakdown: string | null;
  modelRestriction: string | null;
}

export function workspaceQuotaTier(raw: string | null | undefined): WorkspaceQuotaTier | null {
  const parts = raw?.trim().toLowerCase().split(/[_-]+/) ?? [];
  return (['free', 'go', 'plus', 'pro', 'max'] as const).find(tier => parts.includes(tier)) ?? null;
}

export function workspaceQuotaView({ context, response, tier, balanceUsd }: {
  context: WorkspaceCollabContext | null;
  response?: WorkspaceBillingResponse | null;
  tier: string | null;
  /** Existing host's explicitly workspace-scoped money, for callers without a raw response. */
  balanceUsd?: string | null;
}): WorkspaceQuotaView {
  // A raw response must prove this workspace AND member.
  // Never fall through to the host's older amount after a scoped read rejects it.
  const balance = context?.workspaceId && context.workspaceMemberId
    ? response !== undefined
      ? workspaceBillingBalanceUsd(response, context)
      : balanceUsd ?? null
    : null;
  // The host's account advisory tier must not rename
  // this workspace. Prefer the proven v1 snapshot, then its current context.
  // Retain the host's scoped tier hint while the raw read is still pending.
  const snapshot = workspaceBillingSnapshotForContext(response, context);
  const snapshotTier = snapshot?.billing.planId?.trim()
    || (snapshot?.billing.billingState === 'free' ? 'free' : null);
  const scopedTier = snapshotTier || context?.planId?.trim()
    || (context?.billingState === 'free' ? 'free' : null)
    || (response == null ? tier : null);
  return {
    tier: workspaceQuotaTier(scopedTier),
    planKnown: Boolean(scopedTier?.trim()),
    loading: balance == null && !response?.workspaceBalance && !response?.workspaceSnapshot,
    balanceUsd: balance,
    // Only the exact workspace/member snapshot may provide shared windows.
    // Account summaries and personal Coding Plan are not substitutes.
    planStatus: null,
    windows: snapshot?.designPlanWindows?.flatMap(window => {
      // Keep unreadable shares unavailable; never turn missing quota into zero.
      if ((window.kind !== '5h' && window.kind !== '7d')
        || !/^(0|[1-9]\d*)$/.test(window.remainingCredits)
        || !/^(0|[1-9]\d*)$/.test(window.limitCredits)) return [];
      const remaining = BigInt(window.remainingCredits);
      const limit = BigInt(window.limitCredits);
      if (limit === 0n || remaining > limit) return [];
      // Match the existing personal quota widget's whole-percent presentation.
      // Compute the ratio before Number conversion: credit counts can be large.
      const usedBasisPoints = Number(((limit - remaining) * 10_000n) / limit);
      return [{
        durationSeconds: window.kind === '5h' ? 18_000 : 604_800,
        remainingPercent: 100 - Math.round(usedBasisPoints / 100),
        resetsAt: window.resetsAt,
      }];
    }) ?? null,
    breakdown: null,
    modelRestriction: null,
  };
}
