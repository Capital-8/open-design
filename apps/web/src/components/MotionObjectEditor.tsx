import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, DialogTitle } from '@open-design/components';
import { ArrowLeft, Check, ChevronDown, ChevronUp, Image as ImageIcon, Layers, LocateFixed, Pause, Play, Redo2, SlidersHorizontal, Square, Type, Undo2 } from 'lucide-react';
import { motionEditorDocumentSchema, motionSourceFingerprint, type MotionEditorDocument, type MotionEditorObject, type MotionEditorResponse, type WorkspaceCollabContext } from '@open-design/contracts';
import { useI18n } from '../i18n';
import { previewMotionEditor, requestMotionEditor } from '../providers/motion-editor';
import { buildSrcdoc } from '../runtime/srcdoc';
import { useMotionPreviewTransport } from '../runtime/motion-preview-transport';
import { bindMotionPreviewActivity, unbindMotionPreviewActivity } from '../runtime/motion-preview-activity';
import { motionStepTime } from './MotionPlaybackControls';
import { shiftMotionObjects, staggerMotionObjects } from './motion-editor-model';
import styles from './MotionObjectEditor.module.css';

type Ready = Extract<MotionEditorResponse, { supported: true }>;
interface Props {
  projectId: string; filePath: string; baseHref: string; workspace?: WorkspaceCollabContext | null;
  initialTime?: number; onClose(time?: number): void; onSaved(source: string): void;
}
interface History { before: MotionEditorDocument; after: MotionEditorDocument }

export function MotionObjectEditor({ projectId, filePath, baseHref, workspace, initialTime = 0, onClose, onSaved }: Props) {
  const { t } = useI18n();
  const [ready, setReady] = useState<Ready | null>(null);
  const [draft, setDraft] = useState<MotionEditorDocument | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [tab, setTab] = useState<'appearance' | 'animation'>('appearance');
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [onlySelected, setOnlySelected] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [candidate, setCandidate] = useState<{ draftKey: string; source: string } | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const epoch = useRef(0);
  const [undo, setUndo] = useState<History[]>([]), [redo, setRedo] = useState<History[]>([]);
  const [stagger, setStagger] = useState('0.15');
  const [loop, setLoop] = useState(false);
  const [timeEditing, setTimeEditing] = useState(false), [timeDraft, setTimeDraft] = useState('');
  const tracksRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 600, height: 400 });
  const stage = useRef<HTMLDivElement>(null), frame = useRef<HTMLIFrameElement>(null);
  const busy = useRef(false), alive = useRef(true), resumeTime = useRef(Number.isFinite(initialTime) ? Math.max(0, initialTime) : 0), restoredRevision = useRef('');
  const hasLoaded = useRef(false);
  const drag = useRef<{ x: number; width: number; document: MotionEditorDocument; id: string; ids: string[]; resize: boolean; moved: boolean; invalid: boolean } | null>(null);
  const draftRef = useRef(draft); draftRef.current = draft;
  const readyRef = useRef(ready); readyRef.current = ready;
  const dirty = !!ready && !!draft && JSON.stringify(ready.document) !== JSON.stringify(draft);
  const selectedObject = draft?.objects.find(object => object.id === selected.at(-1));
  const draftKey = JSON.stringify(draft);
  const visibleSource = candidate?.draftKey === draftKey ? candidate.source : ready?.source;
  const previewIdentity = visibleSource ? motionSourceFingerprint(visibleSource) : '';
  const preview = useMemo(() => visibleSource ? buildSrcdoc(visibleSource, { baseHref, motionPreview: true, previewFocusGuard: true }) : '', [visibleSource, baseHref]);
  const transport = useMotionPreviewTransport({ iframeRef: frame, identity: `${projectId}:${filePath}:${previewIdentity}`, enabled: !!ready, locked: saving });
  const runtime = useRef(transport); runtime.current = transport;
  const time = transport.state?.time ?? 0;
  const document = draft ?? ready?.document;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;

  const load = useCallback(async (signal?: AbortSignal) => {
    setError('');
    if (hasLoaded.current) resumeTime.current = runtime.current.getState()?.time ?? resumeTime.current;
    const operation = ++epoch.current;
    setReady(null); readyRef.current = null; setDraft(null); setCandidate(null);
    try {
      const result = await requestMotionEditor(projectId, filePath, workspace, undefined, signal);
      if (signal?.aborted || !alive.current || operation !== epoch.current) return;
      if (!result.supported) { setUnsupported(true); setReady(null); setError(result.reason); return; }
      resumeTime.current = Math.min(result.document.duration, resumeTime.current);
      hasLoaded.current = true;
      setUnsupported(false); setReady(result); setDraft(result.document); setUndo([]); setRedo([]);
      setSelected(current => current.filter(id => result.document.objects.some(object => object.id === id)).slice(-1));
      if (result.versionWarning) setError(result.versionWarning);
    } catch (cause) { if (!signal?.aborted && alive.current && operation === epoch.current) setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [projectId, filePath, workspace]);
  useEffect(() => { alive.current = true; const abort = new AbortController(); void load(abort.signal); return () => { alive.current = false; epoch.current++; abort.abort(); }; }, [load]);
  useEffect(() => {
    const element = frame.current; if (!element) return;
    bindMotionPreviewActivity(element);
    return () => unbindMotionPreviewActivity(element);
  }, [!!ready]);
  useEffect(() => {
    if (!stage.current) return;
    const update = () => { if (stage.current) setStageSize({ width: Math.max(1, stage.current.clientWidth - 64), height: Math.max(1, stage.current.clientHeight - 64) }); };
    update(); const observer = new ResizeObserver(update); observer.observe(stage.current); return () => observer.disconnect();
  }, [!!ready]);
  useEffect(() => {
    if (!ready || !transport.connected || restoredRevision.current === previewIdentity) return;
    restoredRevision.current = previewIdentity;
    void transport.command({ action: 'seek', time: Math.min(resumeTime.current, ready.document.duration) }).catch(() => setError(t('motion.editor.playerError')));
  }, [ready?.revision, previewIdentity, transport.connected, transport.command, t]);
  useEffect(() => {
    if (!ready || !draft || !dirty) { setCandidate(null); setPreviewPending(false); return; }
    const parsed = motionEditorDocumentSchema.safeParse(draft);
    if (!parsed.success) { setPreviewPending(false); return; }
    const abort = new AbortController();
    setPreviewPending(true);
    const timer = window.setTimeout(() => {
      resumeTime.current = runtime.current.getState()?.time ?? resumeTime.current;
      void previewMotionEditor(projectId, filePath, ready.revision, parsed.data, workspace, abort.signal).then(result => {
        if (!abort.signal.aborted) { setCandidate({ draftKey, source: result.source }); setPreviewPending(false); }
      }).catch(cause => { if (!abort.signal.aborted) { setPreviewPending(false); setError(String(cause instanceof Error ? cause.message : cause)); } });
    }, 180);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [draftKey, dirty, ready?.revision, projectId, filePath, workspace]);
  const command = (control: Parameters<typeof transport.command>[0]) => { void runtime.current.command(control).catch(() => setError(t('motion.editor.playerError'))); };
  const select = (id: string, multiple = false) => {
    if (busy.current || drag.current) return;
    if (dirtyRef.current) { setError(t('motion.editor.pending')); return; }
    setSelected(current => multiple ? current.includes(id) ? current.filter(value => value !== id) : [...current, id] : [id]);
  };
  const chooseTab = (next: 'appearance' | 'animation') => { setTab(next); setTimelineExpanded(next === 'animation'); };
  const selectRef = useRef(select); selectRef.current = select;
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== 'od-motion-editor-select') return;
      if (readyRef.current?.document.objects.some(object => object.id === event.data.id)) selectRef.current(event.data.id);
    };
    window.addEventListener('message', handler); return () => window.removeEventListener('message', handler);
  }, []);
  const loopStart = selectedObject?.animation.start;
  const loopEnd = selectedObject && document ? Math.min(document.duration, selectedObject.animation.start + selectedObject.animation.duration + .25) : undefined;
  useEffect(() => {
    if (!transport.connected || saving || transport.state?.locked) return;
    let current = true;
    void transport.command({ action: 'loop', range: loop && loopStart !== undefined && loopEnd !== undefined ? { start: loopStart, end: loopEnd } : null }).catch(() => { if (current) setError(t('motion.editor.playerError')); });
    return () => { current = false; };
  }, [loop, loopStart, loopEnd, transport.connected, transport.state?.locked, previewIdentity, saving, transport.command, t]);


  async function commit(next: MotionEditorDocument, history: 'new' | 'undo' | 'redo' = 'new') {
    const base = readyRef.current;
    if (!base || busy.current) return;
    const parsed = motionEditorDocumentSchema.safeParse(next);
    if (!parsed.success) { setError(t('motion.editor.invalid')); return; }
    if (JSON.stringify(parsed.data) === JSON.stringify(base.document)) return;
    const operation = epoch.current;
    busy.current = true; setSaving(true); setError('');
    resumeTime.current = runtime.current.getState()?.time ?? 0;
    try {
      if (runtime.current.connected) await runtime.current.command({ action: 'pause' });
      const result = await requestMotionEditor(projectId, filePath, workspace, { baseRevision: base.revision, document: parsed.data, label: t('motion.editor.title') });
      if (!alive.current || operation !== epoch.current) return;
      if (!result.supported) throw new Error(result.reason);
      const entry = { before: base.document, after: result.document };
      if (history === 'new') { setUndo(values => [...values.slice(-49), entry]); setRedo([]); }
      if (history === 'undo') { setUndo(values => values.slice(0, -1)); setRedo(values => [...values, { before: result.document, after: base.document }]); }
      if (history === 'redo') { setRedo(values => values.slice(0, -1)); setUndo(values => [...values, entry]); }
      setReady(result); readyRef.current = result; setDraft(result.document); onSaved(result.source);
      if (result.versionWarning) setError(result.versionWarning);
    } catch (cause) { if (alive.current && operation === epoch.current) setError(`${t('motion.editor.saveFailed')} ${cause instanceof Error ? cause.message : String(cause)}`); }
    finally { busy.current = false; if (alive.current) setSaving(false); }
  }
  const patch = (change: Partial<MotionEditorObject>) => {
    if (!selectedObject || !draft || saving) return;
    setDraft({ ...draft, objects: draft.objects.map(object => object.id === selectedObject.id ? { ...object, ...change } : object) });
  };
  const close = () => { if (busy.current) return; if (dirtyRef.current) { setError(t('motion.editor.pending')); return; } onClose(runtime.current.getState()?.time ?? resumeTime.current); };
  const closeRef = useRef(close); closeRef.current = close;
  const historyActions = useRef({ undo, redo, commit }); historyActions.current = { undo, redo, commit };
  useEffect(() => {
    tracksRef.current?.querySelector(`[data-track-id="${selected.at(-1) ?? ''}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [selected, timelineExpanded, onlySelected]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable=true]')) return;
      if (event.key === 'Escape' && drag.current) { setDraft(drag.current.document); drag.current = null; event.preventDefault(); event.stopImmediatePropagation(); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !dirtyRef.current && !busy.current) {
        const actions = historyActions.current; const item = (event.shiftKey ? actions.redo : actions.undo).at(-1);
        if (item) { event.preventDefault(); void actions.commit(event.shiftKey ? item.after : item.before, event.shiftKey ? 'redo' : 'undo'); }
        return;
      }
      if (event.key === ' ' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const state = runtime.current.getState(); if (!state || busy.current) return;
        if (event.key === ' ') void runtime.current.command({ action: state.playing ? 'pause' : 'play' }).catch(() => {});
        else void runtime.current.command({ action: 'seek', time: motionStepTime(state.time, state.duration, state.fps, event.key === 'ArrowLeft' ? -1 : 1) }).catch(() => {});
      }
    };
    window.addEventListener('keydown', keydown, true); return () => window.removeEventListener('keydown', keydown, true);
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current || busy.current) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  const numberField = (field: 'x' | 'y' | 'width' | 'height' | 'fontSize' | 'rotation' | 'opacity', label: string) => <label>{label}<input type="number" step={field === 'opacity' ? .05 : 1} value={Number.isFinite(selectedObject?.[field]) ? selectedObject?.[field] : ''} onChange={event => patch({ [field]: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>;
  const presetLabel = (preset: MotionEditorObject['animation']['preset']) => t(`motion.editor.preset.${preset}`);
  const scale = document ? Math.min(stageSize.width / document.width, stageSize.height / document.height) : 1;

  return <Dialog className={styles.dialog} onClose={() => closeRef.current()} ariaLabel={t('motion.editor.title')} closeOnEscape>
    <header className={styles.header}><Button variant="ghost" size="icon" onClick={close} disabled={saving} aria-label={t('motion.editor.back')}><ArrowLeft size={17} /></Button><SlidersHorizontal size={17} /><DialogTitle>{t('motion.editor.title')}</DialogTitle><small>{filePath}</small>
      <span className={styles.status} role="status">{saving ? t('motion.editor.saving') : previewPending ? t('motion.editor.previewing') : dirty ? t('motion.editor.unsaved') : ready ? t('motion.editor.saved') : ''}</span>
      <Button variant="ghost" size="icon" aria-label={t('motion.editor.undo')} title={t('motion.editor.undo')} disabled={!undo.length || saving || dirty} onClick={() => void commit(undo.at(-1)!.before, 'undo')}><Undo2 size={16} /></Button>
      <Button variant="ghost" size="icon" aria-label={t('motion.editor.redo')} title={t('motion.editor.redo')} disabled={!redo.length || saving || dirty} onClick={() => void commit(redo.at(-1)!.after, 'redo')}><Redo2 size={16} /></Button>
    </header>
    {error && <div className={styles.error} role="alert"><span>{error}</span><Button size="sm" variant="ghost" disabled={saving} onClick={() => { restoredRevision.current = ''; void load(); }}>{t('motion.editor.reload')}</Button></div>}
    {!ready || !document ? <div className={styles.loading}>{unsupported ? t('motion.editor.unsupported') : t('motion.editor.loading')}</div> : <>
      <div className={styles.body}>
        <aside className={styles.layers}><div className={styles.sectionTitle}><Layers size={13} />{t('motion.editor.objects')}</div>
          {document.objects.map(object => <button className={styles.layer} key={object.id} aria-pressed={selected.includes(object.id)} onClick={event => select(object.id, event.shiftKey)} disabled={saving}>{object.type === 'text' ? <Type size={14} /> : object.type === 'image' ? <ImageIcon size={14} /> : <Square size={14} />}<span>{object.name}</span>{selected.length > 1 && selected.includes(object.id) && <small>{selected.indexOf(object.id) + 1}</small>}</button>)}
          <p className={styles.hint}>{t('motion.editor.selectionHint')}</p>
        </aside>
        <main className={styles.stage} ref={stage}>
          <div className={styles.canvas} style={{ width: document.width * scale, height: document.height * scale }}>
            <iframe ref={frame} data-od-motion-active="true" srcDoc={preview} title={t('motion.editor.preview')} sandbox="allow-scripts" onLoad={transport.onLoad} />
            {(candidate?.draftKey === draftKey ? document : ready.document).objects.filter(object => selected.includes(object.id) && time >= object.animation.start + object.animation.duration - .001).map(object => <div key={object.id} className={styles.selection} style={{ left: `${object.x / document.width * 100}%`, top: `${object.y / document.height * 100}%`, width: `${object.width / document.width * 100}%`, height: `${object.height / document.height * 100}%`, transform: `rotate(${object.rotation}deg)` }} />)}
          </div>
        </main>
        <aside className={styles.inspector}>
          {!selectedObject ? <p className={styles.hint}>{t('motion.editor.chooseObject')}</p> : <><h3>{selectedObject.name}</h3>
            <div className={styles.tabs} role="tablist"><button role="tab" aria-selected={tab === 'appearance'} onClick={() => chooseTab('appearance')}>{t('motion.editor.appearance')}</button><button role="tab" aria-selected={tab === 'animation'} onClick={() => chooseTab('animation')}>{t('motion.editor.animation')}</button></div>
            <Button className={styles.locate} size="sm" variant="ghost" disabled={!transport.connected || saving} onClick={() => command({ action: 'seek', time: selectedObject.animation.start + (tab === 'appearance' ? selectedObject.animation.duration : 0) })}><LocateFixed size={13} />{t(tab === 'appearance' ? 'motion.editor.locateAppearance' : 'motion.editor.locateEntrance')}</Button>
            <fieldset className={styles.fields} disabled={saving}>
              {tab === 'appearance' ? <>
                {selectedObject.type === 'text' && <label>{t('motion.editor.text')}<textarea value={selectedObject.text ?? ''} onChange={event => patch({ text: event.target.value })} /></label>}
                <div className={styles.pair}>{numberField('x', 'X')}{numberField('y', 'Y')}</div>
                <div className={styles.pair}>{numberField('width', t('motion.editor.width'))}{numberField('height', t('motion.editor.height'))}</div>
                <div className={styles.pair}>{numberField('rotation', t('motion.editor.rotation'))}{numberField('opacity', t('motion.editor.opacity'))}</div>
                {selectedObject.type === 'text' && numberField('fontSize', t('motion.editor.fontSize'))}
                {selectedObject.type !== 'image' && <label>{t('motion.editor.color')}<input type="color" value={selectedObject.type === 'text' ? selectedObject.color : selectedObject.fill} onChange={event => patch({ [selectedObject.type === 'text' ? 'color' : 'fill']: event.target.value })} /></label>}
                {selectedObject.type === 'image' && <p className={styles.hint}>{t('motion.editor.imageHint')}</p>}
              </> : <>
                <label>{t('motion.editor.entrance')}<select value={selectedObject.animation.preset} onChange={event => patch({ animation: { ...selectedObject.animation, preset: event.target.value as MotionEditorObject['animation']['preset'] } })}>{(['fade', 'rise', 'slide', 'scale'] as const).map(value => <option key={value} value={value}>{presetLabel(value)}</option>)}</select></label>
                <div className={styles.pair}>{(['start', 'duration'] as const).map(key => <label key={key}>{t(`motion.editor.${key}`)}<input type="number" step="0.01" value={Number.isFinite(selectedObject.animation[key]) ? selectedObject.animation[key] : ''} onChange={event => patch({ animation: { ...selectedObject.animation, [key]: event.target.value === '' ? NaN : Number(event.target.value) } })} /></label>)}</div>
                <label>{t('motion.editor.easing')}<select value={selectedObject.animation.easing} onChange={event => patch({ animation: { ...selectedObject.animation, easing: event.target.value as MotionEditorObject['animation']['easing'] } })}>{(['linear', 'gentle', 'snappy'] as const).map(value => <option key={value} value={value}>{t(`motion.editor.ease.${value}`)}</option>)}</select></label>
                <p className={styles.hint}>{t('motion.editor.lifetimeHint')}</p>
              </>}
              <div className={styles.actions}><Button size="sm" variant="secondary" disabled={!dirty} onClick={() => { setDraft(ready.document); setError(''); }}>{t('motion.editor.discard')}</Button><Button size="sm" disabled={!dirty} onClick={() => void commit(document)}><Check size={12} />{t('motion.editor.apply')}</Button></div>
            </fieldset>
            {selected.length > 1 && <fieldset className={styles.fields} disabled={saving || dirty}><p className={styles.hint}>{t('motion.editor.staggerHint')}</p><label>{t('motion.editor.interval')}<input type="number" min="0" step="0.05" value={stagger} onChange={event => setStagger(event.target.value)} /></label><Button size="sm" variant="secondary" onClick={() => { try { if (!stagger.trim()) throw new Error(); void commit(staggerMotionObjects(ready.document, selected, Number(stagger))); } catch { setError(t('motion.editor.invalid')); } }}>{t('motion.editor.stagger')}</Button></fieldset>}
          </>}
        </aside>
      </div>
      <section className={`${styles.timeline} ${!timelineExpanded ? styles.collapsed : ''}`} aria-label={t('motion.editor.timeline')}>
        <div className={styles.transport}>
          <Button size="icon" variant="ghost" disabled={!transport.connected || saving} aria-label={t(transport.state?.playing ? 'motion.pause' : 'motion.play')} onClick={() => command({ action: transport.state?.playing ? 'pause' : 'play' })}>{transport.state?.playing ? <Pause size={15} /> : <Play size={15} />}</Button>
          <input aria-label={t('motion.editor.time')} type="number" step={1 / document.fps} min="0" max={document.duration} value={timeEditing ? timeDraft : time.toFixed(3)} disabled={!transport.connected || saving} onFocus={() => { setTimeEditing(true); setTimeDraft(time.toFixed(3)); command({ action: 'pause' }); }} onChange={event => setTimeDraft(event.target.value)} onBlur={() => { setTimeEditing(false); if (timeDraft.trim() && Number.isFinite(Number(timeDraft))) command({ action: 'seek', time: Math.max(0, Math.min(document.duration, Number(timeDraft))) }); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
          <small>/ {document.duration.toFixed(2)}s</small><div className={styles.right}>
            {timelineExpanded && <Button size="sm" variant="ghost" aria-pressed={onlySelected} disabled={!onlySelected && !selected.length} onClick={() => setOnlySelected(value => !value)}>{t(onlySelected ? 'motion.editor.showAll' : 'motion.editor.onlySelected')}</Button>}
            {selected.length > 0 && <Button size="sm" variant="ghost" aria-pressed={loop} onClick={() => { setLoop(value => !value); if (!loop && selectedObject) command({ action: 'seek', time: selectedObject.animation.start }); }}>{t('motion.editor.loop')}</Button>}
            <Button size="sm" variant="ghost" aria-expanded={timelineExpanded} onClick={() => setTimelineExpanded(value => !value)}>{timelineExpanded ? <ChevronDown size={13} /> : <ChevronUp size={13} />}{t(timelineExpanded ? 'motion.editor.collapseTimeline' : 'motion.editor.expandTimeline')}</Button>
          </div>
        </div>
        {timelineExpanded && <div className={styles.tracks} ref={tracksRef}>
          <div className={styles.rulerRow}><span className={styles.hint}>{t('motion.editor.entranceTracks')}</span><div className={styles.ruler} onClick={event => { if (saving) return; const rect = event.currentTarget.getBoundingClientRect(); command({ action: 'seek', time: Math.max(0, Math.min(document.duration, (event.clientX - rect.left) / rect.width * document.duration)) }); }}>{Array.from({ length: 11 }, (_, index) => <span key={index} className={styles.tick} style={{ left: `${index * 10}%`, transform: index === 10 ? 'translateX(-100%)' : undefined }}>{Number((index * document.duration / 10).toFixed(1))}s</span>)}</div></div>
          {document.objects.filter(object => !onlySelected || selected.includes(object.id)).map(object => <div className={styles.track} key={object.id} data-track-id={object.id}><button className={styles.trackName} aria-pressed={selected.includes(object.id)} onClick={event => { select(object.id, event.shiftKey); chooseTab('animation'); }}>{object.name}</button><div className={styles.lane}>
            <button className={styles.clip} aria-label={`${object.name} · ${t('motion.editor.entrance')}`} aria-pressed={selected.includes(object.id)} disabled={saving || dirty && !drag.current} style={{ left: `${object.animation.start / document.duration * 100}%`, width: `${object.animation.duration / document.duration * 100}%` }}
              onPointerDown={event => {
                if (dirtyRef.current || busy.current || event.button !== 0) return;
                if (event.shiftKey || !selected.includes(object.id)) select(object.id, event.shiftKey); chooseTab('animation');
                if (event.shiftKey) return;
                const width = event.currentTarget.parentElement!.getBoundingClientRect().width;
                drag.current = { x: event.clientX, width, document: ready.document, id: object.id, ids: selected.includes(object.id) ? selected : [object.id], resize: (event.target as HTMLElement).dataset.resize === 'true', moved: false, invalid: false };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={event => {
                const active = drag.current; if (!active) return;
                const delta = (event.clientX - active.x) / active.width * document.duration;
                if (Math.abs(event.clientX - active.x) < 3 && !active.moved) return;
                active.moved = true;
                try {
                  const original = active.document.objects.find(item => item.id === active.id)!;
                  const next = active.resize ? motionEditorDocumentSchema.parse({ ...active.document, objects: active.document.objects.map(item => item.id === active.id ? { ...item, animation: { ...item.animation, duration: Math.round((original.animation.duration + delta) * 1000) / 1000 } } : item) }) : shiftMotionObjects(active.document, active.ids, delta);
                  active.invalid = false; setDraft(next); draftRef.current = next; setError('');
                } catch { active.invalid = true; setError(t('motion.editor.invalid')); }
              }}
              onPointerUp={() => { const active = drag.current; drag.current = null; if (active?.invalid) { setDraft(active.document); draftRef.current = active.document; } else if (active?.moved && draftRef.current) void commit(draftRef.current); }}
              onPointerCancel={() => { if (drag.current) setDraft(drag.current.document); drag.current = null; }}
              onKeyDown={event => { if (event.key === 'Enter') { select(object.id); chooseTab('animation'); } }}
            ><span>{presetLabel(object.animation.preset)}</span><i className={styles.resize} data-resize="true" /></button>
            <div className={styles.playhead} style={{ left: `${time / document.duration * 100}%` }} />
          </div></div>)}
        </div>}
      </section>
      <footer className={styles.footer}><span>{t('motion.editor.shortcuts')}</span><span>{t('motion.editor.sessionHistory')}</span>{transport.error && <span role="alert">{t('motion.editor.playerError')}</span>}</footer>
    </>}
  </Dialog>;
}
