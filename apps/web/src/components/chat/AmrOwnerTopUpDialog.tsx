/** Frozen client r506 / 2026-10-20 F10: a contact-Owner notice with one
 * acknowledgement. Native presentation shares the limit-dialog frame and
 * accessible modal lifecycle; inline catalogue rendering stays non-modal. */
import { useId, type ReactElement } from 'react';
import { Button, Dialog } from '@open-design/components';
import { Icon } from '../Icon';
import { useT } from '../../i18n';
import { chatSeam } from './ChatRoot';
import frame from '../AmrBalanceDialog.module.css';
import styles from './AmrOwnerTopUpDialog.module.css';

export interface AmrOwnerTopUpDialogProps {
  onClose: () => void;
  /** Retained for locales whose approved copy includes the Owner name. */
  ownerName?: string | null;
  /** Catalogue presentation, without a portal or modal focus ownership. */
  inline?: boolean;
}

const OWNER_NAME_SLOT = '\u0000';

export function AmrOwnerTopUpDialog({ onClose, ownerName, inline }: AmrOwnerTopUpDialogProps): ReactElement | null {
  const t = useT();
  const titleId = useId();
  const messageId = useId();
  const name = ownerName?.trim();
  const messageParts = name
    ? t('chat.amrBalanceOwner.message', { name: OWNER_NAME_SLOT }).split(OWNER_NAME_SLOT)
    : [t('chat.amrBalanceOwner.messageNoOwnerName')];
  const [beforeName, afterName] = messageParts;
  const contents = <>
    <div className={inline ? styles.banner : frame.banner} aria-hidden>
      <img className={inline ? styles.bannerImage : frame.bannerImage}
        src="/upgrade/cloud-signin-aurora.jpg" alt="" width={1680} height={720}
        decoding="async" draggable={false} />
    </div>
    {inline ? <button type="button" className={styles.close} onClick={onClose} aria-label={t('common.close')}>
      <Icon name="close" size={14} />
    </button> : <Button variant="ghost" className={frame.closeButton} onClick={onClose} aria-label={t('common.close')}>
      <Icon name="close" size={14} />
    </Button>}
    <h2 id={titleId} className={inline ? styles.title : frame.title}>{t('chat.amrBalanceOwner.title')}</h2>
    <p id={messageId} className={inline ? styles.message : `${frame.message} ${frame.memberMessage}`}>
      {beforeName}
      {afterName === undefined ? null : <><strong className={styles.ownerName}>{name}</strong>{afterName}</>}
    </p>
    <Button type="button" variant="primary"
      className={inline ? styles.cta : `${frame.cta} ${frame.frozenCta} ${frame.fullCta}`}
      data-testid="amr-balance-owner-dismiss" onClick={onClose}>
      {t('chat.amrBalanceOwner.dismissCta')}
    </Button>
  </>;
  if (inline) return <div className={`${styles.overlay} ${styles.overlayInline}`}
    data-testid="amr-balance-owner-dialog" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={styles.modal} role="dialog" aria-modal={false} aria-labelledby={titleId} aria-describedby={messageId}>
      {contents}
    </div>
  </div>;
  const seam = chatSeam();
  return <Dialog className={`${frame.panel} ${frame.frozenPanel} ${seam.className}`}
    backdropClassName={`${styles.overlay} ${frame.frozenBackdrop} ${seam.className}`}
    ariaLabelledBy={titleId} ariaDescribedBy={messageId} onClose={onClose} closeOnEscape
    data-testid="amr-balance-owner-dialog" data-chat-root={seam['data-chat-root']}>
    {contents}
  </Dialog>;
}
