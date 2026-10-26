import type { MotionStructureItem, MotionStructureResponse } from '@open-design/contracts';
import { MessageSquarePlus, Type, Layers, AudioLines, Captions } from 'lucide-react';
import { Button } from '@open-design/components';
import { useI18n } from '../i18n';
import { motionMediaLanes, motionMediaTrackHeight } from './motion-timeline';
import styles from './MotionStructureTracks.module.css';

export function motionSceneAt(structure: MotionStructureResponse | null | undefined, time: number) {
  return structure?.scenes.find(scene => time >= (scene.start ?? 0) && time < (scene.start ?? 0) + (scene.duration ?? 0))
    ?? (structure?.composition && time === structure.composition.duration ? structure.scenes.at(-1) : undefined);
}
const seconds = (time: number) => Number(time.toFixed(3)).toString();
interface Props {
  structure: MotionStructureResponse;
  time: number;
  duration: number;
  selectedId?: string | null;
  disabled: boolean;
  modifyDisabled?: boolean;
  onSelect(item: MotionStructureItem): void;
  onModify(item: MotionStructureItem): void;
}

export function MotionStructureTracks({ structure, time, duration, selectedId, disabled, onSelect }: Props) {
  const { t } = useI18n();
  const active = motionSceneAt(structure, time);
  const segment = (item: MotionStructureItem) => ({ left: `${(item.start ?? 0) / duration * 100}%`, width: `${(item.duration ?? 0) / duration * 100}%` });
  const media = (items: MotionStructureItem[], kind: 'audio' | 'caption') => items.length > 0 && <div className={styles.mediaScroll} style={{ height: motionMediaTrackHeight(items) }}>
    <div className={styles.mediaInner} style={{ height: Math.max(...motionMediaLanes(items).map(item => item.lane + 1)) * 26 }}>
      {motionMediaLanes(items).map(({ item, lane }) => <button key={item.id} type="button" className={`${styles.media} ${kind === 'audio' ? styles.audio : styles.caption}`}
        style={{ ...segment(item), top: lane * 26 }} title={`${item.label} · ${seconds(item.start ?? 0)}–${seconds((item.start ?? 0) + (item.duration ?? 0))}s`}
        disabled={disabled} aria-pressed={selectedId === item.id} onClick={() => onSelect(item)}>{kind === 'audio' ? <AudioLines size={11} /> : <Captions size={11} />}<span>{item.label}</span></button>)}
    </div>
  </div>;
  return <>
    {structure.scenes.length > 0 && <div className={styles.scenes} data-testid="motion-scenes">
      {structure.scenes.map((scene, index) => <button key={scene.id} type="button" className={`${styles.scene} ${scene.id === active?.id ? styles.current : ''}`}
        style={segment(scene)} disabled={disabled} aria-pressed={scene.id === active?.id}
        aria-label={t('motion.selectScene', { number: index + 1, label: scene.label, start: seconds(scene.start ?? 0), end: seconds((scene.start ?? 0) + (scene.duration ?? 0)) })}
        title={`${scene.label} · ${seconds(scene.start ?? 0)}–${seconds((scene.start ?? 0) + (scene.duration ?? 0))}s`}
        onClick={() => onSelect(scene)}><b>{String(index + 1).padStart(2, '0')}</b><span>{scene.label}</span></button>)}
    </div>}
    {media(structure.audio, 'audio')}{media(structure.captions, 'caption')}
  </>;
}

export function MotionSceneContents({ structure, time, selectedId, disabled, modifyDisabled, onSelect, onModify }: Props) {
  const { t } = useI18n();
  const scene = motionSceneAt(structure, time);
  const texts = structure.texts.filter(item => scene ? item.sceneId === scene.id : !item.sceneId);
  const selected = [...texts, ...structure.audio, ...structure.captions].find(item => item.id === selectedId) ?? scene;
  const context = selected?.kind === 'audio' || selected?.kind === 'caption' ? selected : scene;
  if (!structure.scenes.length && !structure.texts.length) return null;
  return <div className={styles.contents} role="group" aria-label={t('motion.sceneContents')}>
    <div className={styles.context}><Layers size={12} /><span>{context?.label ?? t('motion.sceneContents')}</span>
      {context && <small>{seconds(context.start ?? 0)}–{seconds((context.start ?? 0) + (context.duration ?? 0))}s</small>}
      <Button size="sm" variant="secondary" className={styles.modify} disabled={disabled || modifyDisabled || !selected} onClick={() => selected && onModify(selected)}><MessageSquarePlus size={12} /><span>{t('motion.modifySelection')}</span></Button>
    </div>
    <div className={styles.texts} aria-label={t('motion.selectedText')}>
      {texts.length ? texts.map(item => <button type="button" key={item.id} disabled={disabled} aria-pressed={selected?.id === item.id}
        aria-label={t('motion.selectText', { text: item.text ?? item.label })} title={item.text ?? item.label} onClick={() => onSelect(item)}><Type size={11} /><span>{item.text ?? item.label}</span></button>) : <span className={styles.empty}>{t('motion.noSceneText')}</span>}
    </div>
  </div>;
}
