import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, Input } from '@open-design/components';
import { Camera, Columns2, MoreHorizontal, MessageSquarePlus, Pause, Play, RotateCcw, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import type { MotionPlayerControl, MotionPlayerState } from '@open-design/contracts/runtime/motion-source-player';
import type { MotionStructureItem, MotionStructureResponse } from '@open-design/contracts';
import { useI18n } from '../i18n';
import { isMotionPlayerState, type MotionTransportError } from '../runtime/motion-preview-transport';
import { groupMotionTimelineComments, motionTimelineTicks, type MotionTimelineComment } from './motion-timeline';
import { motionSceneAt } from './MotionStructureTracks';
import styles from './MotionPlaybackControls.module.css';
import { MotionRangeEditor, type MotionSelectionRange } from './MotionRangeEditor';
import { MotionFilmstrip, type MotionFilmstripSource } from './MotionFilmstrip';

export function motionStepTime(time: number, duration: number, fps: number | undefined, direction: -1 | 1): number {
  if (!fps) return Math.max(0, Math.min(duration, Math.round((time + direction * .1) * 1000) / 1000));
  const frame = direction > 0 ? Math.floor(time * fps + .000001) + 1 : Math.ceil(time * fps - .000001) - 1;
  const lastFrame = Math.max(0, Math.ceil(duration * fps - .000001) - 1);
  return Math.max(0, Math.min(lastFrame, frame)) / fps;
}

function formatTime(time: number): string {
  const centiseconds = Math.round(Math.max(0, time) * 100);
  return `${Math.floor(centiseconds / 6000).toString().padStart(2, '0')}:${(Math.floor(centiseconds / 100) % 60).toString().padStart(2, '0')}.${(centiseconds % 100).toString().padStart(2, '0')}`;
}

export interface MotionPlaybackControlsProps {
  state: MotionPlayerState | null;
  connected: boolean;
  error: MotionTransportError | null;
  locked?: boolean;
  fileName?: string;
  filmstrip?: MotionFilmstripSource | null;
  structure?: MotionStructureResponse | null;
  selectedItemId?: string | null;
  structureDisabled?: boolean;
  structureModifyDisabled?: boolean;
  onSelectItem?(item: MotionStructureItem): void;
  onModifyItem?(item: MotionStructureItem): void;
  comments?: readonly MotionTimelineComment[];
  activeCommentId?: string | null;
  commentsDisabled?: boolean;
  onOpenComment?(id: string): void;
  range?: MotionSelectionRange | null;
  onRangeChange?(range: MotionSelectionRange | null): void;
  rangeDisabled?: boolean;
  comparison?: { time: number } | null;
  comparisonBusy?: boolean;
  comparisonDisabled?: boolean;
  comparisonError?: 'outOfRange' | 'failed' | null;
  onCaptureComparison?(): void;
  onCompare?(): void;
  onCommand(control: MotionPlayerControl): void | Promise<unknown>;
  onAnnotate(): void | Promise<unknown>;
}

export function MotionPlaybackControls({ state, connected, error, locked = false, filmstrip, structure, selectedItemId, structureDisabled = false, onSelectItem, comments = [], activeCommentId, commentsDisabled = false, onOpenComment, range, onRangeChange, rangeDisabled = false, comparison, comparisonBusy = false, comparisonDisabled = false, comparisonError, onCaptureComparison, onCompare, onCommand, onAnnotate }: MotionPlaybackControlsProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('0.000');
  const [editing, setEditing] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [localError, setLocalError] = useState(false);
  const [openingEditor, setOpeningEditor] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [frameMode, setFrameMode] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const initialDraft = useRef('');
  const editEpoch = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const isLocked = locked || !!state?.locked || annotating;
  const disabled = !connected || !state || !state.active || isLocked || openingEditor;
  const time = state?.time ?? 0, duration = state?.duration ?? 0, fps = state?.fps;
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => setTrackWidth(track.clientWidth || 500);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(track);
    return () => observer?.disconnect();
  }, []);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);
  useEffect(() => () => { editEpoch.current++; }, []);
  const run = (control: MotionPlayerControl) => {
    setLocalError(false);
    try { void Promise.resolve(onCommand(control)).catch(() => setLocalError(true)); }
    catch { setLocalError(true); }
  };
  useEffect(() => {
    if (!moreOpen) return;
    moreRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !moreRef.current?.contains(event.target) && !moreButtonRef.current?.contains(event.target)) setMoreOpen(false); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setMoreOpen(false); moreButtonRef.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [moreOpen]);
  const useFrames = frameMode && !!fps;
  const frameCount = fps ? Math.max(1, Math.ceil(duration * fps - .000001)) : 0;
  const frame = fps ? Math.min(frameCount, Math.floor(time * fps + .000001) + 1) : 0;
  const seekDraft = () => {
    setEditing(false);
    if (cancelled.current) { cancelled.current = false; return; }
    if (draft === initialDraft.current) return;
    const number = Number(draft.trim());
    if (!draft.trim() || !Number.isFinite(number) || disabled) { setDraft(time.toFixed(3)); return; }
    run({ action: 'seek', time: useFrames ? (Math.max(1, Math.min(frameCount, Math.round(number))) - 1) / fps! : Math.max(0, Math.min(duration, number)) });
  };
  const editTime = async () => {
    if (disabled || openingEditor) return;
    const epoch = ++editEpoch.current;
    setOpeningEditor(true); setLocalError(false);
    try {
      const confirmed = await onCommand({ action: 'pause' });
      if (epoch !== editEpoch.current) return;
      cancelled.current = false;
      const confirmedTime = isMotionPlayerState(confirmed) ? confirmed.time : stateRef.current?.time ?? 0;
      initialDraft.current = useFrames ? String(Math.min(frameCount, Math.floor(confirmedTime * fps! + .000001) + 1)) : confirmedTime.toFixed(3);
      setDraft(initialDraft.current);
      setEditing(true);
    } catch { if (epoch === editEpoch.current) setLocalError(true); }
    finally { if (epoch === editEpoch.current) setOpeningEditor(false); }
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
  const status = error ? t(error) : localError ? t('motion.commandFailed') : comparisonBusy ? t('motion.comparison.waiting') : isLocked ? t('motion.locked') : !connected ? t('motion.connecting') : null;
  const groups = groupMotionTimelineComments(comments, duration, trackWidth);
  const markerDisabled = !connected || !state?.active || annotating || openingEditor || editing || commentsDisabled || !onOpenComment;
  const commentLabel = (comment: MotionTimelineComment) => `${t('motion.openComment', { number: comment.number, time: formatTime(comment.time) })}${comment.note ? ` · ${comment.note}` : ''}`;
  const navigationDisabled = !connected || !state?.active || annotating || openingEditor || editing || structureDisabled;
  const activeScene = motionSceneAt(structure, time);
  const chooseItem = (item: MotionStructureItem) => { setMoreOpen(false); onSelectItem?.(item); };
  const menuAction = (action: () => void) => { setMoreOpen(false); action(); };
  return (
    <div className={styles.player} role="region" aria-label={t('motion.title')} tabIndex={0} onKeyDown={onKeyDown}>
      <div className={styles.toolbar}>
        <div className={styles.clock}>
          {editing ? <label className={styles.timeEntry}><Input ref={inputRef} type="number" aria-label={t('motion.timeInput')} value={draft} step={useFrames ? 1 : 'any'} min={useFrames ? 1 : 0} max={useFrames ? frameCount : duration || 0} disabled={disabled}
            onChange={event => setDraft(event.target.value)} onBlur={seekDraft}
            onKeyDown={event => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') { cancelled.current = true; event.currentTarget.blur(); }
            }} /><span>{t(useFrames ? 'motion.framesUnit' : 'motion.seconds')}</span></label>
            : <button type="button" className={styles.timecode} aria-label={t('motion.timeInput')} title={t('motion.timeInput')} disabled={disabled || openingEditor} onClick={() => { void editTime(); }}>{useFrames ? t('motion.frame', { frame, count: frameCount }) : formatTime(time)}</button>}
          {!useFrames && <span className={styles.total}>/ {formatTime(duration)}</span>}
        </div>
        <div className={styles.playback}>
          <Button variant="ghost" size="icon" className={styles.icon} disabled={disabled} onClick={() => step(-1)} title={t(fps ? 'motion.previousFrame' : 'motion.previousStep')} aria-label={t(fps ? 'motion.previousFrame' : 'motion.previousStep')}><SkipBack size={15} /></Button>
          <Button variant="secondary" size="icon" className={`${styles.icon} ${styles.play}`} disabled={disabled} onClick={() => run({ action: state?.playing ? 'pause' : time >= duration ? 'replay' : 'play' })} title={t(state?.playing ? 'motion.pause' : 'motion.play')} aria-label={t(state?.playing ? 'motion.pause' : 'motion.play')}>{state?.playing ? <Pause size={15} /> : <Play size={15} />}</Button>
          <Button variant="ghost" size="icon" className={styles.icon} disabled={disabled} onClick={() => step(1)} title={t(fps ? 'motion.nextFrame' : 'motion.nextStep')} aria-label={t(fps ? 'motion.nextFrame' : 'motion.nextStep')}><SkipForward size={15} /></Button>
        </div>
        <div className={styles.actions}>
          {onRangeChange && <MotionRangeEditor range={range} duration={duration} time={time} structure={structure} disabled={disabled || duration <= 0 || editing} locked={rangeDisabled || isLocked} onChange={onRangeChange} />}
          <Button variant="secondary" size="sm" className={styles.annotate} aria-label={t('motion.annotate')} title={t('motion.annotate')} disabled={disabled} onClick={() => { void annotate(); }}><MessageSquarePlus size={14} /><span>{t('motion.annotate')}</span></Button>
          {comparison && onCompare && <Button size="icon" variant="ghost" className={styles.icon} disabled={disabled || comparisonBusy || comparisonDisabled || editing} aria-label={t('motion.comparison.compare')} title={t('motion.comparison.compare')} onClick={onCompare}><Columns2 size={15} /></Button>}
          <Button ref={moreButtonRef} variant="ghost" size="icon" className={styles.icon} aria-label={t('motion.more')} title={t('motion.more')} aria-expanded={moreOpen} onClick={() => setMoreOpen(value => !value)}><MoreHorizontal size={17} /></Button>
        </div>
      </div>
      {moreOpen && <div ref={moreRef} className={styles.morePanel} role="dialog" aria-label={t('motion.more')}>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => menuAction(() => run({ action: 'replay' }))}><RotateCcw size={14} />{t('motion.replay')}</Button>
        <Button size="sm" variant="ghost" disabled={!connected} onClick={() => run({ action: 'mute', value: !state?.muted })}>{state?.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}{t(state?.muted ? 'motion.unmute' : 'motion.mute')}</Button>
        {fps && <label className={styles.frameChoice}><input type="checkbox" checked={frameMode} disabled={editing || openingEditor} onChange={event => setFrameMode(event.target.checked)} />{t('motion.frameMode')}<small>{fps} fps</small></label>}
        {onCaptureComparison && <Button size="sm" variant="ghost" disabled={disabled || comparisonBusy || comparisonDisabled || editing} aria-label={t(comparison ? 'motion.comparison.replace' : 'motion.comparison.capture')} title={comparisonDisabled || isLocked ? t('motion.range.finishDraft') : undefined} onClick={() => menuAction(onCaptureComparison)}><Camera size={14} />{t(comparison ? 'motion.comparison.replace' : 'motion.comparison.capture')}</Button>}
        {!!structure?.scenes.length && structure.scenes.length > 1 && <div className={styles.navigationList}><strong>{t('motion.scenesTrack')}</strong>{structure.scenes.map(item => <button type="button" key={item.id} disabled={navigationDisabled} aria-pressed={activeScene?.id === item.id} onClick={() => chooseItem(item)}>{item.label}<small>{formatTime(item.start ?? 0)}</small></button>)}</div>}
        {[{ items: structure?.audio ?? [], title: 'motion.audioTrack' as const }, { items: structure?.captions ?? [], title: 'motion.captionsTrack' as const }].filter(group => group.items.length).map(group => <div key={group.title} className={styles.navigationList}><strong>{t(group.title)}</strong>{group.items.map(item => <button type="button" key={item.id} disabled={navigationDisabled} aria-pressed={selectedItemId === item.id} onClick={() => chooseItem(item)}>{item.label}<small>{formatTime(item.start ?? 0)}</small></button>)}</div>)}
        {!!comments.length && <div className={styles.navigationList}><strong>{t('motion.commentsTrack')}</strong>{comments.map(comment => <button type="button" key={comment.id} disabled={markerDisabled} onClick={() => menuAction(() => onOpenComment?.(comment.id))}>{comment.number}. {comment.note}<small>{formatTime(comment.time)}</small></button>)}</div>}
      </div>}
      <div className={styles.tracks}>
        <div className={styles.trackContent} ref={trackRef}>
          <div className={styles.seekArea}>
            <div className={styles.ruler} aria-hidden="true">{motionTimelineTicks(duration, trackWidth).map(tick => <span key={tick} className={styles.tick} style={{ left: `${tick / duration * 100}%` }}>{Number(tick.toFixed(3))}{t('motion.seconds')}</span>)}</div>
            <div className={styles.clip} aria-hidden="true">{filmstrip && connected && <MotionFilmstrip source={filmstrip} duration={duration} width={trackWidth} />}</div>
            {range && duration > 0 && <div className={styles.selectedRange} aria-hidden="true" style={{ left: `${range.startSeconds / duration * 100}%`, width: `${(range.endSeconds - range.startSeconds) / duration * 100}%` }} />}
            <input className={styles.timeline} type="range" aria-label={t('motion.timeline')} min={0} max={duration || 1} step={.001} value={time} disabled={disabled || editing || openingEditor} aria-valuetext={`${time.toFixed(3)} / ${duration.toFixed(3)} ${t('motion.seconds')}`} onChange={event => run({ action: 'seek', time: Number(event.target.value) })}
              onKeyDown={event => { if (!disabled && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1); } }} />
          </div>
          {structure && structure.scenes.length > 1 && duration > 0 && <div className={styles.sceneOverlay} data-testid="motion-scenes">{structure.scenes.map((scene, index) => <button type="button" key={scene.id} className={styles.sceneMark} style={{ left: `${(scene.start ?? 0) / duration * 100}%`, width: `${(scene.duration ?? 0) / duration * 100}%` }} disabled={navigationDisabled} aria-pressed={activeScene?.id === scene.id} aria-label={t('motion.selectScene', { number: index + 1, label: scene.label, start: Number((scene.start ?? 0).toFixed(3)), end: Number(((scene.start ?? 0) + (scene.duration ?? 0)).toFixed(3)) })} title={scene.label} onClick={() => onSelectItem?.(scene)}>{scene.label}</button>)}</div>}
          {!!groups.length && <div className={styles.commentTrack}>{groups.map(group => <div key={group.comments[0]!.id} className={styles.markerAnchor} style={{ left: `clamp(10px, ${group.time / duration * 100}%, calc(100% - 10px))` }}>
            {group.comments.length === 1 ? <button type="button" className={`${styles.marker} ${group.comments[0]!.id === activeCommentId ? styles.activeMarker : ''}`} disabled={markerDisabled} title={commentLabel(group.comments[0]!)} aria-label={commentLabel(group.comments[0]!)} onClick={() => onOpenComment?.(group.comments[0]!.id)}>{group.comments[0]!.number}</button>
              : <select className={`${styles.marker} ${styles.markerGroup}`} value="" disabled={markerDisabled} title={t('motion.commentGroup', { count: group.comments.length })} aria-label={t('motion.commentGroup', { count: group.comments.length })} onChange={event => { if (event.target.value) onOpenComment?.(event.target.value); }}><option value="" disabled>{group.comments.length}</option>{group.comments.map(comment => <option key={comment.id} value={comment.id}>{commentLabel(comment)}</option>)}</select>}
          </div>)}</div>}
          <div className={styles.playhead} style={{ left: `${duration ? time / duration * 100 : 0}%` }} aria-hidden="true"><span /></div>
        </div>
      </div>
      {(status || comparisonError) && <div className={styles.status} role={comparisonError ? 'alert' : 'status'}>{comparisonError ? t(`motion.comparison.${comparisonError}`) : status}</div>}
    </div>
  );
}
