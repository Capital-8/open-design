import { useEffect, useRef } from 'react';
import { Button, Dialog, DialogHeader, DialogTitle, DialogDescription } from '@open-design/components';
import { X } from 'lucide-react';
import { useI18n } from '../i18n';
import styles from './MotionFrameComparison.module.css';

export interface MotionComparisonFrame { dataUrl: string; time: number }
export interface MotionFrameComparisonProps {
  before: MotionComparisonFrame;
  after: MotionComparisonFrame | null;
  sameSource: boolean;
  onClose(): void;
}

export function MotionFrameComparison({ before, after, sameSource, onClose }: MotionFrameComparisonProps) {
  const { t } = useI18n();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <Dialog className={styles.dialog} onClose={onClose} closeOnEscape ariaLabel={t('motion.comparison.title')}>
    <DialogHeader className={styles.header}>
      <div><DialogTitle>{t('motion.comparison.title')}</DialogTitle><DialogDescription>{t('motion.comparison.sessionOnly')}</DialogDescription></div>
      <Button ref={close} variant="ghost" size="icon" aria-label={t('motion.comparison.close')} onClick={onClose}
        onKeyDown={event => { if (event.key === 'Tab') { event.preventDefault(); close.current?.focus(); } }}><X size={18} /></Button>
    </DialogHeader>
    <div className={styles.frames}>
      <figure><figcaption><span>{t('motion.comparison.before')}</span><time>{before.time.toFixed(3)} {t('motion.seconds')}</time></figcaption><div className={styles.image}><img src={before.dataUrl} alt={t('motion.comparison.before')} /></div></figure>
      <figure><figcaption><span>{t('motion.comparison.after')}</span>{after && <time>{after.time.toFixed(3)} {t('motion.seconds')}</time>}</figcaption><div className={styles.image}>{after ? <img src={after.dataUrl} alt={t('motion.comparison.after')} /> : <span role="status">{t('motion.comparison.waiting')}</span>}</div></figure>
    </div>
    {sameSource && <p className={styles.notice}>{t('motion.comparison.sameSource')}</p>}
  </Dialog>;
}
