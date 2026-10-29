import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@open-design/components';
import { Brackets, X } from 'lucide-react';
import { useI18n } from '../i18n';
import type { MotionStructureResponse } from '@open-design/contracts';
import { motionSceneAt } from './MotionStructureTracks';
import styles from './MotionPlaybackControls.module.css';

export interface MotionSelectionRange { startSeconds: number; endSeconds: number }
export interface MotionRangeEditorProps {
  range?: MotionSelectionRange | null;
  duration: number;
  time: number;
  structure?: MotionStructureResponse | null;
  disabled: boolean;
  locked: boolean;
  onChange(range: MotionSelectionRange | null): void;
}

const seconds = (value: number) => Number(value.toFixed(3)).toString();

export function MotionRangeEditor({ range, duration, time, structure, disabled, locked, onChange }: MotionRangeEditorProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ start: '', end: '' });
  const [invalid, setInvalid] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const scene = motionSceneAt(structure, time);
  useEffect(() => {
    setDraft({ start: range ? seconds(range.startSeconds) : '', end: range ? seconds(range.endSeconds) : '' });
    setInvalid(false);
  }, [range?.startSeconds, range?.endSeconds]);
  useEffect(() => {
    if (!open) return;
    firstInput.current?.focus();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); setOpen(false); toggle.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const currentSceneRange = () => {
    if (scene && scene.start !== undefined && scene.duration !== undefined) {
      return { startSeconds: Math.max(0, scene.start), endSeconds: Math.min(duration, scene.start + scene.duration) };
    }
    const startSeconds = Math.min(Math.max(0, time - 1), Math.max(0, duration - .001));
    return { startSeconds, endSeconds: Math.min(duration, Math.max(startSeconds + .001, time + 1)) };
  };
  const setDraftRange = (value: MotionSelectionRange) => {
    setDraft({ start: seconds(value.startSeconds), end: seconds(value.endSeconds) });
    setInvalid(false);
  };
  const close = () => { setOpen(false); toggle.current?.focus(); };
  const commit = () => {
    if (disabled || locked) return;
    const { start, end } = draft;
    const startSeconds = Number(start), endSeconds = Number(end);
    if (!start.trim() || !end.trim() || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)
      || startSeconds < 0 || endSeconds > duration || startSeconds >= endSeconds) { setInvalid(true); return; }
    setInvalid(false); onChange({ startSeconds, endSeconds }); close();
  };
  const railStart = Number.isFinite(Number(draft.start)) ? Math.max(0, Math.min(duration, Number(draft.start))) : 0;
  const railEnd = Number.isFinite(Number(draft.end)) ? Math.max(railStart, Math.min(duration, Number(draft.end))) : duration;
  return <div className={styles.rangeEditor} ref={root}>
    <Button ref={toggle} size="sm" variant="ghost" className={`${styles.tool} ${range ? styles.selectedTool : ''}`}
      aria-label={t('motion.range.title')} aria-expanded={open} disabled={disabled || locked}
      title={locked ? t('motion.range.finishDraft') : t('motion.range.title')}
      onClick={() => { if (!open) setDraftRange(range ?? currentSceneRange()); setOpen(value => !value); }}>
      <Brackets size={13} /><span>{range ? `${seconds(range.startSeconds)}–${seconds(range.endSeconds)}${t('motion.seconds')}` : t('motion.range.title')}</span>
    </Button>
    {open && <div className={styles.rangePanel} role="group" aria-label={t('motion.range.title')}>
      <div className={styles.panelHeading}><strong>{t('motion.range.title')}</strong><Button variant="ghost" size="icon" className={styles.icon} aria-label={t('motion.comparison.close')} onClick={close}><X size={14} /></Button></div>
      <div className={styles.rangeFields}>
        <label>{t('motion.range.start')}<Input ref={firstInput} type="number" min={0} max={duration} step={.001} value={draft.start} disabled={disabled || locked} aria-invalid={invalid}
          onChange={event => { setDraft(value => ({ ...value, start: event.target.value })); setInvalid(false); }} /></label>
        <span aria-hidden="true">—</span>
        <label>{t('motion.range.end')}<Input type="number" min={0} max={duration} step={.001} value={draft.end} disabled={disabled || locked} aria-invalid={invalid}
          onChange={event => { setDraft(value => ({ ...value, end: event.target.value })); setInvalid(false); }} /></label>
      </div>
      <div className={styles.rangeRail}>
        <div className={styles.rangeRailFill} style={{ insetInlineStart: `${duration > 0 ? railStart / duration * 100 : 0}%`, width: `${duration > 0 ? (railEnd - railStart) / duration * 100 : 0}%` }} />
        <input type="range" aria-label={t('motion.range.start')} min={0} max={duration} step={.001} value={railStart} disabled={disabled || locked}
          onChange={event => setDraftRange({ startSeconds: Math.max(0, Math.min(Number(event.target.value), railEnd - .001)), endSeconds: railEnd })} />
        <input type="range" aria-label={t('motion.range.end')} min={0} max={duration} step={.001} value={railEnd} disabled={disabled || locked}
          onChange={event => setDraftRange({ startSeconds: railStart, endSeconds: Math.min(duration, Math.max(Number(event.target.value), railStart + .001)) })} />
      </div>
      <p className={styles.rangeHelp} role={invalid ? 'alert' : undefined}>{locked ? t('motion.range.finishDraft') : invalid ? t('motion.range.invalid') : t('motion.range.context', { start: draft.start, end: draft.end })}</p>
      <div className={styles.rangePanelActions}>
        <Button size="sm" variant="ghost" disabled={disabled || locked || !scene} onClick={() => setDraftRange(currentSceneRange())}>{t('motion.range.useScene')}</Button>
        {range && <Button size="sm" variant="ghost" disabled={disabled || locked} onClick={() => { if (!disabled && !locked) { onChange(null); close(); } }}>{t('motion.range.clear')}</Button>}
      </div>
      <div className={styles.rangePanelActions}>
        <Button size="sm" variant="ghost" onClick={close}>{t('motion.range.cancel')}</Button>
        <Button size="sm" variant="secondary" disabled={disabled || locked} onClick={commit}>{t('motion.range.apply')}</Button>
      </div>
    </div>}
  </div>;
}
