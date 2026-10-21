import { useEffect } from 'react';
import { isWorkspaceLifecycleReadable, type WorkspaceCollabContext } from '@open-design/contracts';
import { Button } from '@open-design/components';
import { notifyWorkspaceBillingRefresh } from '../collab/useWorkspaceContext';
import type { WorkspaceQuotaView } from '../collab/workspace-quota-view';
import { useI18n } from '../i18n';
import { formatVelaBalanceUsd } from '../providers/daemon';
import { quotaPopoverConsoleUrl } from '../runtime/workspace-quota-links';
import { PlanWordmark, type PlanBadgeTier } from './PlanWordmark';
import { Icon } from './Icon';
import { RemixIcon } from './RemixIcon';
import card from './PersonalPlanCard.module.css';
import quota from './CodingPlanUsage.module.css';
import styles from './WorkspaceQuotaPopover.module.css';

export function WorkspaceQuotaPopover({ view, context, profile, consoleOrigin, badgeTier, planLabel, onNavigate }: {
  view: WorkspaceQuotaView;
  context: WorkspaceCollabContext | null;
  profile?: string | null;
  consoleOrigin?: string | null;
  /** Keep the host's existing plan-family branding; quota uses the actual tier. */
  badgeTier?: PlanBadgeTier | null;
  planLabel?: string;
  onNavigate?: (action: 'upgrade' | 'credits') => void;
}) {
  const { t, locale } = useI18n();
  const workspaceId = context?.workspaceId;
  const memberId = context?.workspaceMemberId;
  // Entering/reopening and switching reuse the shared read,
  // which already rejects late results and refreshes on focus/payment signals.
  useEffect(() => {
    if (workspaceId && memberId) notifyWorkspaceBillingRefresh();
  }, [workspaceId, memberId]);

  const consoleUrl = quotaPopoverConsoleUrl(profile, workspaceId, 'console', consoleOrigin);
  const max = view.tier === 'max';
  // Preserve base EntryNavRail's locked/past-due recovery priority.
  const actionUrl = context?.billingRecovery?.recoveryUrl?.trim()
    || quotaPopoverConsoleUrl(profile, workspaceId, max ? 'console' : 'plans', consoleOrigin);
  const owner = context?.role === 'owner';
  // Preserve the existing contracts billing policy: locked workspaces remain readable.
  const readable = context?.memberStatus === 'active' && isWorkspaceLifecycleReadable(context.lifecycleState);
  // Only the existing team FAMILY mark survives from the host.
  // Personal badges must name the same scoped tier as the quota and action.
  const shownBadge = badgeTier === 'team' ? 'team' : view.tier;
  const unavailable = t('workspaceQuota.unavailable');
  // Go has 5h + 7d; other paid tiers only 7d.
  const durations = view.tier === 'free' ? [] : view.tier === 'go' ? [18_000, 604_800] : [604_800];
  function navigate(url: string, action: 'upgrade' | 'credits') {
    onNavigate?.(action);
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  const walletContent = <>
    <span>{shownBadge === 'team' ? <RemixIcon name="battery-charge-line" size={14} /> : null}{t('workspaceQuota.payAsYouGo')}</span>
    <span className={quota.value}><bdi>{formatVelaBalanceUsd(view.balanceUsd) ?? unavailable}</bdi>
      {consoleUrl && readable ? <Icon name="chevron-right" size={14} /> : null}
    </span>
  </>;
  return (
    <div className={`entry-nav-rail__menu-credits ${card.card}`} data-plan-status={view.planStatus ?? undefined}>
      <div className="entry-nav-rail__menu-credits-head">
        <span className="entry-nav-rail__menu-credits-plan" role={shownBadge !== 'team' ? 'img' : undefined}
          aria-label={shownBadge !== 'team' ? shownBadge ?? unavailable : undefined}>
          {shownBadge === 'team' ? planLabel : null}
          {shownBadge ? <PlanWordmark tier={shownBadge} height={shownBadge === 'team' ? 11 : 20} /> : unavailable}
        </span>
        {/* Role, not wallet balance, chooses the action. */}
        {readable && owner && view.planKnown && actionUrl ? (
          <Button className="entry-nav-rail__menu-credits-upgrade" onClick={() => navigate(actionUrl, max ? 'credits' : 'upgrade')}>
            {t(max ? 'entry.creditsManage' : 'entry.creditsUpgrade')}
          </Button>
        ) : readable && !owner ? <span className={styles.contact}>{t('workspaceQuota.contactOwner')}</span> : null}
      </div>
      {view.loading ? (
        // Header stays; no spinner, hint, error or retry text.
        <div aria-busy="true" data-testid="workspace-quota-skeleton">
          {durations.map(duration => <div className={quota.block} key={duration} data-testid="workspace-quota-window-skeleton" aria-hidden="true">
            <div className={quota.row}><span className={quota.bone} /><span className={`${quota.bone} ${quota.boneEnd}`} /></div>
            <span className={`${quota.bone} ${quota.boneTrack}`} />
          </div>)}
          <div className={`${quota.wallet} ${durations.length ? quota.walletWithQuota : ''}`} aria-hidden="true" data-testid="workspace-quota-wallet-skeleton">
            <span className={quota.bone} /><span className={`${quota.bone} ${quota.boneEnd}`} />
          </div>
        </div>
      ) : (
        <>
          <section aria-label={t('billing.codingPlanDesignPlan')}>
            {/* The Design Plan region is present even on Free. */}
            {view.tier === 'free' ? <div className={quota.row}>
              <span title={view.modelRestriction ?? unavailable}>{t('billing.codingPlanDesignPlan')}</span><span>{t('workspaceQuota.unsubscribed')}</span>
            </div> : durations.map(duration => {
              const window = view.windows?.find(item => item.durationSeconds === duration);
              const percent = window?.remainingPercent;
              const known = percent != null && Number.isFinite(percent) && percent >= 0 && percent <= 100;
              const reset = window?.resetsAt ? new Date(window.resetsAt) : null;
              const resetLabel = reset && Number.isFinite(reset.getTime())
                ? new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(reset)
                : null;
              return <div className={quota.block} key={duration}>
                <div className={quota.row}>
                  <span className={quota.allowance} title={view.modelRestriction ?? unavailable}>{t('billing.codingPlanDesignPlan')} <small className={quota.period}>
                    {t(duration === 18_000 ? 'billing.codingPlanPeriodHours' : 'billing.codingPlanPeriodDays', { count: duration === 18_000 ? 5 : 7 })}
                  </small></span>
                  <span>{known ? t('billing.codingPlanRemainingPercent', { percent }) : unavailable}</span>
                </div>
                {known ? <div className={quota.track} role="progressbar" aria-label={t('billing.codingPlanDesignPlan')}
                  aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                  <span className={quota.fill} style={{ width: `${percent}%` }} />
                </div> : null}
                {resetLabel ? <div className={styles.details}>{t('workspaceQuota.resetAt', { time: resetLabel })}</div> : null}
              </div>;
            })}
          </section>
          <section className={quota.walletWithQuota} aria-label={t('workspaceQuota.payAsYouGo')}>
            {consoleUrl && readable ? <button type="button" className={`${styles.balance} ${quota.wallet}`}
              data-testid="entry-nav-credits-row" aria-label={t('workspaceQuota.viewBalance')}
              onClick={() => navigate(consoleUrl, 'credits')}>{walletContent}</button>
              : <div className={quota.wallet}>{walletContent}</div>}
          </section>
        </>
      )}
    </div>
  );
}
