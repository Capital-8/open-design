import { useState, type ReactNode } from 'react';
import { Button, Input } from '@open-design/components';
import type { MotionStructureItem, MotionStructureResponse } from '@open-design/contracts';
import type { PreviewCommentMotionAnchor } from '@open-design/contracts';
import { useI18n } from '../i18n';
import styles from './MotionFeedbackContext.module.css';

/** Choose a declared frame container; the live bridge still verifies uniqueness and visibility. */
export function motionFeedbackFrameTarget(structure: MotionStructureResponse | null, time: number) {
  if (structure?.composition) {
    const escapedId = structure.composition.id.replace(/[\x00-\x1f\x7f"\\]/g, character => `\\${character.charCodeAt(0).toString(16)} `);
    return { selector: `[data-composition-id="${escapedId}"]`, start: 0, duration: structure.composition.duration };
  }
  return structure?.scenes.find(scene => time >= (scene.start ?? 0) && time <= (scene.start ?? 0) + (scene.duration ?? 0) && scene.selector) ?? null;
}

export function MotionFeedbackDock({ children }: { children: ReactNode }) {
  return <aside className={`comment-side-dock ${styles.dock}`}><div className={styles.dockBody}>{children}</div></aside>;
}

export function MotionFeedbackContext({ structure, selectedId, label, motion, disabled, onSelect, onRangeChange }: {
  structure: MotionStructureResponse | null;
  selectedId: string | null;
  label: string;
  motion: PreviewCommentMotionAnchor;
  disabled: boolean;
  onSelect(item: MotionStructureItem | null): void;
  onRangeChange(range: NonNullable<PreviewCommentMotionAnchor['range']> | null): void;
}) {
  const { t } = useI18n();
  const [choosing, setChoosing] = useState(false);
  const [editingRange, setEditingRange] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [invalid, setInvalid] = useState(false);
  const items = structure ? [...structure.texts, ...structure.scenes, ...structure.audio, ...structure.captions] : [];
  const openRange = () => {
    setStart(String(motion.range?.startSeconds ?? Math.max(0, motion.timeSeconds - 1)));
    setEnd(String(motion.range?.endSeconds ?? Math.min(motion.durationSeconds, motion.timeSeconds + 1)));
    setInvalid(false); setEditingRange(true);
  };
  return <div className={styles.context} data-testid="motion-feedback-context">
    <div className={styles.target}><span>{t('motion.feedback.target')}</span><strong title={label}>{label}</strong></div>
    <div data-testid="comment-motion-context" className={styles.time}>
      <span>{motion.timeSeconds.toFixed(2)}s</span>
      {motion.range && <span>{t('motion.range.context', { start: motion.range.startSeconds.toFixed(2), end: motion.range.endSeconds.toFixed(2) })}</span>}
    </div>
    <div className={styles.actions}>
      <Button size="sm" variant="ghost" disabled={disabled || !items.length} aria-expanded={choosing} onClick={() => setChoosing(value => !value)}>{t('motion.feedback.chooseElement')}</Button>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={openRange}>{t('motion.range.title')}</Button>
      {motion.range && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onRangeChange(null)}>{t('motion.range.clear')}</Button>}
    </div>
    {choosing && <div className={styles.choices} aria-label={t('motion.feedback.chooseElement')}>
      <button type="button" disabled={disabled} aria-pressed={!selectedId} onClick={() => onSelect(null)}>{t('motion.feedback.currentFrame')}</button>
      {items.map(item => <button type="button" key={item.id} disabled={disabled} aria-pressed={selectedId === item.id}
        aria-label={item.kind === 'text' ? t('motion.selectText', { text: item.text ?? item.label }) : item.label}
        title={item.text ?? item.label} onClick={() => onSelect(item)}>{item.label}</button>)}
    </div>}
    {editingRange && <div className={styles.range}>
      <label>{t('motion.range.start')}<Input type="number" min={0} max={motion.durationSeconds} step="any" value={start} disabled={disabled} onChange={event => setStart(event.target.value)} /></label>
      <label>{t('motion.range.end')}<Input type="number" min={0} max={motion.durationSeconds} step="any" value={end} disabled={disabled} onChange={event => setEnd(event.target.value)} /></label>
      <p role={invalid ? 'alert' : undefined}>{invalid ? t('motion.range.invalid') : t('motion.feedback.rangeHint')}</p>
      <div className={styles.actions}>
        <Button size="sm" variant="ghost" onClick={() => setEditingRange(false)}>{t('common.cancel')}</Button>
        <Button size="sm" disabled={disabled} onClick={() => {
          const startSeconds = Number(start), endSeconds = Number(end);
          if (!start.trim() || !end.trim() || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)
            || startSeconds < 0 || endSeconds > motion.durationSeconds || startSeconds >= endSeconds) { setInvalid(true); return; }
          onRangeChange({ startSeconds, endSeconds }); setEditingRange(false);
        }}>{t('motion.feedback.useRange')}</Button>
      </div>
    </div>}
  </div>;
}
