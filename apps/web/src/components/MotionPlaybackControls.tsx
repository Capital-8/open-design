import { useEffect, useState, type KeyboardEvent } from 'react';
import { Button, Input } from '@open-design/components';
import { MessageSquarePlus, Pause, Play, RotateCcw, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import type { MotionPlayerControl, MotionPlayerState } from '@open-design/contracts/runtime/motion-source-player';
import { useI18n } from '../i18n';
import type { MotionTransportError } from '../runtime/motion-preview-transport';
import styles from './MotionPlaybackControls.module.css';

export function motionStepTime(time: number, duration: number, fps: number | undefined, direction: -1 | 1): number {
  if (!fps) return Math.max(0, Math.min(duration, Math.round((time + direction * .1) * 1000) / 1000));
  const frame = direction > 0 ? Math.floor(time * fps + .000001) + 1 : Math.ceil(time * fps - .000001) - 1;
  const lastFrame = Math.max(0, Math.ceil(duration * fps - .000001) - 1);
  return Math.max(0, Math.min(lastFrame, frame)) / fps;
}

function formatTime(time: number): string {
  const milliseconds = Math.round(Math.max(0, time) * 1000);
  return `${Math.floor(milliseconds / 60000).toString().padStart(2, '0')}:${(Math.floor(milliseconds / 1000) % 60).toString().padStart(2, '0')}.${(milliseconds % 1000).toString().padStart(3, '0')}`;
}

export interface MotionPlaybackControlsProps {
  state: MotionPlayerState | null;
  connected: boolean;
  error: MotionTransportError | null;
  locked?: boolean;
  onCommand(control: MotionPlayerControl): void | Promise<unknown>;
  onAnnotate(): void | Promise<unknown>;
}

export function MotionPlaybackControls({ state, connected, error, locked = false, onCommand, onAnnotate }: MotionPlaybackControlsProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('0.000');
  const [editing, setEditing] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [localError, setLocalError] = useState(false);
  const isLocked = locked || !!state?.locked || annotating;
  const disabled = !connected || !state || !state.active || isLocked;
  const time = state?.time ?? 0, duration = state?.duration ?? 0, fps = state?.fps;
  useEffect(() => { if (!editing) setDraft(time.toFixed(3)); }, [time, editing]);
  const run = (control: MotionPlayerControl) => {
    setLocalError(false);
    try { void Promise.resolve(onCommand(control)).catch(() => setLocalError(true)); }
    catch { setLocalError(true); }
  };
  const seekDraft = () => {
    setEditing(false);
    const number = Number(draft.trim());
    if (!draft.trim() || !Number.isFinite(number) || disabled) { setDraft(time.toFixed(3)); return; }
    run({ action: 'seek', time: Math.max(0, Math.min(duration, number)) });
  };
  const step = (direction: -1 | 1) => run({ action: 'seek', time: motionStepTime(time, duration, fps, direction) });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || disabled) return;
    if (event.key === ' ') { event.preventDefault(); run({ action: state?.playing ? 'pause' : 'play' }); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1); }
  };
  const annotate = async () => {
    setAnnotating(true); setLocalError(false);
    try { await onAnnotate(); } catch { setLocalError(true); }
    finally { setAnnotating(false); }
  };
  const frameCount = fps ? Math.max(1, Math.ceil(duration * fps - .000001)) : 0;
  const frame = fps ? Math.min(frameCount, Math.floor(time * fps + .000001) + 1) : 0;
  const status = error ? t(error) : localError ? t('motion.commandFailed') : isLocked ? t('motion.locked') : !connected ? t('motion.connecting') : null;
  return (
    <div className={styles.player} role="region" aria-label={t('motion.title')} tabIndex={0} onKeyDown={onKeyDown}>
      <div className={styles.timelineRow}>
        <span className={styles.time}>{formatTime(time)}</span>
        <input className={styles.timeline} type="range" aria-label={t('motion.timeline')} min={0} max={duration || 1}
          step={.001} value={time} disabled={disabled} aria-valuetext={`${time.toFixed(3)} / ${duration.toFixed(3)} ${t('motion.seconds')}`}
          onChange={event => run({ action: 'seek', time: Number(event.target.value) })} />
        <span className={styles.time}>{formatTime(duration)}</span>
      </div>
      <div className={styles.toolbar}>
        <Button variant="ghost" size="icon" className={styles.icon} disabled={disabled} onClick={() => run({ action: 'replay' })} title={t('motion.replay')} aria-label={t('motion.replay')}><RotateCcw size={15} /></Button>
        <Button variant="ghost" size="icon" className={styles.icon} disabled={disabled} onClick={() => step(-1)} title={t(fps ? 'motion.previousFrame' : 'motion.previousStep')} aria-label={t(fps ? 'motion.previousFrame' : 'motion.previousStep')}><SkipBack size={15} /></Button>
        <Button variant="secondary" size="icon" className={styles.icon} disabled={disabled} onClick={() => run({ action: state?.playing ? 'pause' : 'play' })} title={t(state?.playing ? 'motion.pause' : 'motion.play')} aria-label={t(state?.playing ? 'motion.pause' : 'motion.play')}>{state?.playing ? <Pause size={17} /> : <Play size={17} />}</Button>
        <Button variant="ghost" size="icon" className={styles.icon} disabled={disabled} onClick={() => step(1)} title={t(fps ? 'motion.nextFrame' : 'motion.nextStep')} aria-label={t(fps ? 'motion.nextFrame' : 'motion.nextStep')}><SkipForward size={15} /></Button>
        <label className={styles.timeEntry}><Input type="number" aria-label={t('motion.timeInput')} value={draft} step="any" min={0} max={duration || 0} disabled={disabled}
          onFocus={() => setEditing(true)} onChange={event => setDraft(event.target.value)} onBlur={seekDraft}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDraft(time.toFixed(3)); setEditing(false); } }} /><span>{t('motion.seconds')}</span></label>
        <span className={styles.spacer} />
        <Button variant="ghost" size="icon" className={`${styles.icon} ${styles.mute}`} disabled={!connected} aria-label={t(state?.muted ? 'motion.unmute' : 'motion.mute')} onClick={() => run({ action: 'mute', value: !state?.muted })}>{state?.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</Button>
        <Button variant="secondary" size="sm" className={styles.annotate} aria-label={t('motion.annotate')} title={t('motion.annotate')} disabled={disabled} onClick={() => { void annotate(); }}><MessageSquarePlus size={14} /><span>{t('motion.annotate')}</span></Button>
      </div>
      <div className={styles.footer}>
        <div className={styles.status} role={status ? 'status' : undefined}>{status}</div>
        {fps && <span className={styles.frames}>{t('motion.frame', { frame, count: frameCount })} · {fps} fps</span>}
      </div>
    </div>
  );
}
