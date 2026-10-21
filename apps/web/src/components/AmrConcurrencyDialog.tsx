import { Button, Dialog } from '@open-design/components';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import { useT } from '../i18n';
import type { AmrBalanceBranch } from '../runtime/amr-balance-branch';
import { workspaceUpgradeUrl } from './EntryNavRail';
import { Icon } from './Icon';
import frame from './AmrBalanceDialog.module.css';
import styles from './AmrConcurrencyDialog.module.css';

/** A real Link request rejection, never a local task-slot reservation. Closing
 * or changing plans only dismisses the notice; sending again is always manual. */
export function AmrConcurrencyDialog({ branch, workspaceContext, onClose }: {
  branch: AmrBalanceBranch;
  workspaceContext: WorkspaceCollabContext | null;
  onClose: () => void;
}) {
  const t = useT();
  const upgradeUrl = branch.audience === 'owner' && branch.tier !== 'max'
    ? workspaceUpgradeUrl(workspaceContext, null) : null;
  const benefits = [
    t('chat.amrConcurrencyGate.benefit1'),
    t('chat.amrConcurrencyGate.benefit2'),
    t('chat.amrConcurrencyGate.benefit3'),
    t('chat.amrConcurrencyGate.benefit4'),
  ];
  return (
    <Dialog className={upgradeUrl ? `${frame.panel} ${styles.offerPanel}` : styles.panel} onClose={onClose} closeOnEscape
      ariaLabelledBy="amr-concurrency-title" data-testid="amr-concurrency-dialog">
      {upgradeUrl ? <>
        <div className={frame.banner}>
          <img className={frame.bannerImage} src="/upgrade/cloud-signin-aurora.jpg"
            width={1680} height={720} alt="" decoding="async" draggable={false} />
        </div>
        <Button variant="ghost" className={frame.closeButton} onClick={onClose} aria-label={t('common.close')}>
          <Icon name="close" size={14} />
        </Button>
      </> : null}
      <h2 id="amr-concurrency-title" className={upgradeUrl ? frame.title : undefined}>
        {t(upgradeUrl ? 'chat.amrConcurrencyGate.title' : 'chat.runError.title.membershipConcurrencyLimit')}
      </h2>
      <p className={upgradeUrl ? frame.message : undefined}>{t(upgradeUrl
        ? 'chat.amrConcurrencyGate.message'
        : branch.audience === 'member'
          ? 'chat.runError.membershipConcurrencyLimitOwnerMessage'
          : 'chat.runError.membershipConcurrencyLimitMessageNoTime')}</p>
      {upgradeUrl ? <div className={frame.benefitsCard}>
        <span className={`${frame.benefitsTitle} ${styles.benefitsTitle}`}>{t('chat.amrBalanceGate.benefitsTitle')}</span>
        <ul className={frame.benefits}>
          {benefits.map((benefit) => <li key={benefit} className={frame.benefit}>
            <span className={styles.benefitIcon} aria-hidden><Icon name="check" size={14} /></span>
            {benefit}
          </li>)}
        </ul>
      </div> : null}
      <div className={upgradeUrl ? frame.actions : styles.actions}>
        <Button variant={upgradeUrl ? 'ghost' : 'secondary'} className={upgradeUrl ? frame.later : undefined}
          onClick={onClose} data-testid="amr-concurrency-close">
          {t(upgradeUrl ? 'chat.amrBalanceGate.laterCta' : 'common.close')}
        </Button>
        {upgradeUrl ? <Button className={`${frame.cta} ${styles.upgradeButton}`}
          onClick={() => window.open(upgradeUrl, '_blank', 'noopener,noreferrer')}
          data-testid="amr-concurrency-upgrade">{t('chat.amrBalanceGate.plansCta')}</Button> : null}
      </div>
    </Dialog>
  );
}
