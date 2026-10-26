import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, Input } from '@open-design/components';
import { Film, MessageSquare, MessageSquarePlus, Pause, Play, RotateCcw, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import type { MotionPlayerControl, MotionPlayerState } from '@open-design/contracts/runtime/motion-source-player';
import type { MotionStructureItem, MotionStructureResponse } from '@open-design/contracts';
import { useI18n } from '../i18n';
import { isMotionPlayerState, type MotionTransportError } from '../runtime/motion-preview-transport';
import { groupMotionTimelineComments, motionMediaTrackHeight, motionTimelineTicks, type MotionTimelineComment } from './motion-timeline';
import { MotionSceneContents, MotionStructureTracks } from './MotionStructureTracks';
import styles from './MotionPlaybackControls.module.css';
import { MotionFilmstrip, type MotionFilmstripSource } from './MotionFilmstrip';

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
  onCommand(control: MotionPlayerControl): void | Promise<unknown>;
  onAnnotate(): void | Promise<unknown>;
}

export function MotionPlaybackControls({ state, connected, error, locked = false, fileName, filmstrip, structure, selectedItemId, structureDisabled = false, structureModifyDisabled = false, onSelectItem, onModifyItem, comments = [], activeCommentId, commentsDisabled = false, onOpenComment, onCommand, onAnnotate }: MotionPlaybackControlsProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('0.000');
  const [editing, setEditing] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [localError, setLocalError] = useState(false);
  const [openingEditor, setOpeningEditor] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
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
  const seekDraft = () => {
    setEditing(false);
    if (cancelled.current) { cancelled.current = false; return; }
    const number = Number(draft.trim());
    if (!draft.trim() || !Number.isFinite(number) || disabled) { setDraft(time.toFixed(3)); return; }
    run({ action: 'seek', time: Math.max(0, Math.min(duration, number)) });
  };
  const editTime = async () => {
    if (disabled || openingEditor) return;
    const epoch = ++editEpoch.current;
    setOpeningEditor(true); setLocalError(false);
    try {
      const confirmed = await onCommand({ action: 'pause' });
      if (epoch !== editEpoch.current) return;
      cancelled.current = false;
      setDraft((isMotionPlayerState(confirmed) ? confirmed.time : stateRef.current?.time ?? 0).toFixed(3));
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
  const frameCount = fps ? Math.max(1, Math.ceil(duration * fps - .000001)) : 0;
  const frame = fps ? Math.min(frameCount, Math.floor(time * fps + .000001) + 1) : 0;
  const status = error ? t(error) : localError ? t('motion.commandFailed') : isLocked ? t('motion.locked') : !connected ? t('motion.connecting') : null;
  const groups = groupMotionTimelineComments(comments, duration, trackWidth);
  const markerDisabled = !connected || !state?.active || annotating || openingEditor || editing || commentsDisabled || !onOpenComment;
  const commentLabel = (comment: MotionTimelineComment) => `${t('motion.openComment', { number: comment.number, time: formatTime(comment.time) })}${comment.note ? ` · ${comment.note}` : ''}`;
  const structureProps = structure ? { structure, time, duration, selectedId: selectedItemId,
    disabled: !connected || !state?.active || annotating || openingEditor || editing || structureDisabled, modifyDisabled: structureModifyDisabled,
    onSelect: (item: MotionStructureItem) => onSelectItem?.(item), onModify: (item: MotionStructureItem) => onModifyItem?.(item) } : null;
  return (
    <div className={styles.player} role="region" aria-label={t('motion.title')} tabIndex={0} onKeyDown={onKeyDown}>
      <div className={styles.toolbar}>
        <div className={styles.clock}>
          {editing ? <label className={styles.timeEntry}><Input ref={inputRef} type="number" aria-label={t('motion.timeInput')} value={draft} step="any" min={0} max={duration || 0} disabled={disabled}
            onChange={event => setDraft(event.target.value)} onBlur={seekDraft}
            onKeyDown={event => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') { cancelled.current = true; event.currentTarget.blur(); }
            }} /><span>{t('motion.seconds')}</span></label>
            : <button type="button" className={styles.timecode} aria-label={t('motion.timeInput')} title={t('motion.timeInput')} disabled={disabled || openingEditor} onClick={() => { void editTime(); }}>{formatTime(time)}</button>}
          <span className={styles.total}>/ {formatTime(duration)}</span>
        </div>
        <div className={styles.playback}>
        <Button variant="ghost" size="icon" className={styles.icon} disabled={disabled} onClick={() => run({ action: 'replay' })} title={t('motion.replay')} aria-label={t('motion.replay')}><RotateCcw size={15} /></Button>
        <Button variant="ghost" size="icon" className={styles.icon} disabled={disabled} onClick={() => step(-1)} title={t(fps ? 'motion.previousFrame' : 'motion.previousStep')} aria-label={t(fps ? 'motion.previousFrame' : 'motion.previousStep')}><SkipBack size={15} /></Button>
        <Button variant="secondary" size="icon" className={`${styles.icon} ${styles.play}`} disabled={disabled} onClick={() => run({ action: state?.playing ? 'pause' : 'play' })} title={t(state?.playing ? 'motion.pause' : 'motion.play')} aria-label={t(state?.playing ? 'motion.pause' : 'motion.play')}>{state?.playing ? <Pause size={15} /> : <Play size={15} />}</Button>
        <Button variant="ghost" size="icon" className={styles.icon} disabled={disabled} onClick={() => step(1)} title={t(fps ? 'motion.nextFrame' : 'motion.nextStep')} aria-label={t(fps ? 'motion.nextFrame' : 'motion.nextStep')}><SkipForward size={15} /></Button>
        </div>
        <div className={styles.actions}>
        <Button variant="ghost" size="icon" className={`${styles.icon} ${styles.mute}`} disabled={!connected} aria-label={t(state?.muted ? 'motion.unmute' : 'motion.mute')} onClick={() => run({ action: 'mute', value: !state?.muted })}>{state?.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</Button>
        <Button variant="secondary" size="sm" className={styles.annotate} aria-label={t('motion.annotate')} title={t('motion.annotate')} disabled={disabled} onClick={() => { void annotate(); }}><MessageSquarePlus size={14} /><span>{t('motion.annotate')}</span></Button>
        </div>
      </div>
      <div className={styles.trackHeader}><span>{t('motion.timeline')}</span>{fps && <span className={styles.frames}>{t('motion.frame', { frame, count: frameCount })} <span>· {fps} fps</span></span>}</div>
      <div className={styles.tracks}>
        <div className={styles.trackLabels} aria-hidden="true"><div /><div><Film size={13} /><span>{t('motion.visualTrack')}</span></div>
          {!!structure?.scenes.length && <div style={{ height: 32 }}><span>{t('motion.scenesTrack')}</span></div>}
          {!!structure?.audio.length && <div style={{ height: motionMediaTrackHeight(structure.audio) }}><span>{t('motion.audioTrack')}</span></div>}
          {!!structure?.captions.length && <div style={{ height: motionMediaTrackHeight(structure.captions) }}><span>{t('motion.captionsTrack')}</span></div>}
          <div style={{ height: 27 }}><MessageSquare size={12} /><span>{t('motion.commentsTrack')}</span></div></div>
        <div className={styles.trackContent} ref={trackRef}>
          <div className={styles.seekArea}>
            <div className={styles.ruler} aria-hidden="true">{motionTimelineTicks(duration, trackWidth).map(tick => <span key={tick} className={styles.tick} style={{ left: `${tick / duration * 100}%` }}>{Number(tick.toFixed(3))}{t('motion.seconds')}</span>)}</div>
            <div className={styles.clip} aria-hidden="true">
              {filmstrip && connected && <MotionFilmstrip source={filmstrip} duration={duration} width={trackWidth} />}
              <div className={styles.clipLabel}><Film size={11} /><span>{fileName || t('motion.visualTrack')}</span></div>
              <span className={styles.clipDuration}>{formatTime(duration)}</span>
            </div>
            <input className={styles.timeline} type="range" aria-label={t('motion.timeline')} min={0} max={duration || 1}
              step={.001} value={time} disabled={disabled || editing || openingEditor} aria-valuetext={`${time.toFixed(3)} / ${duration.toFixed(3)} ${t('motion.seconds')}`}
              onChange={event => run({ action: 'seek', time: Number(event.target.value) })} />
          </div>
          {structureProps && <MotionStructureTracks {...structureProps} />}
          <div className={styles.commentTrack}>
            {groups.length === 0 && <span className={styles.emptyComments}>{t('motion.noComments')}</span>}
            {groups.map(group => <div key={group.comments[0]!.id} className={styles.markerAnchor} style={{ left: `clamp(10px, ${group.time / duration * 100}%, calc(100% - 10px))` }}>
              {group.comments.length === 1 ? <button type="button" className={`${styles.marker} ${group.comments[0]!.id === activeCommentId ? styles.activeMarker : ''}`} disabled={markerDisabled} title={commentLabel(group.comments[0]!)} aria-label={commentLabel(group.comments[0]!)} onClick={() => onOpenComment?.(group.comments[0]!.id)}>{group.comments[0]!.number}</button>
                : <select className={`${styles.marker} ${styles.markerGroup}`} value="" disabled={markerDisabled} title={t('motion.commentGroup', { count: group.comments.length })} aria-label={t('motion.commentGroup', { count: group.comments.length })} onChange={event => { if (event.target.value) onOpenComment?.(event.target.value); }}><option value="" disabled>{group.comments.length}</option>{group.comments.map(comment => <option key={comment.id} value={comment.id}>{commentLabel(comment)}</option>)}</select>}
            </div>)}
          </div>
          <div className={styles.playhead} style={{ left: `${duration ? time / duration * 100 : 0}%` }} aria-hidden="true"><span /></div>
        </div>
      </div>
      {structureProps && <MotionSceneContents {...structureProps} />}
      <div className={styles.footer}>
        <div className={styles.status} role={status ? 'status' : undefined}>{status}</div>
        <span className={styles.footerTime}>{formatTime(time)} / {formatTime(duration)}</span>
      </div>
    </div>
  );
}
