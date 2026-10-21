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
    // The current v1 snapshot parser does not expose these
    // optional fields. Account summary / personal Coding Plan are not substitutes.
    // Keep unavailable until the daemon exposes the agreed workspace schema.
    planStatus: null,
    windows: null,
    breakdown: null,
    modelRestriction: null,
  };
}
