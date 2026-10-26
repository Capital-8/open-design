// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MotionStructureResponse } from '@open-design/contracts';
import { MotionSceneContents, MotionStructureTracks, motionSceneAt } from '../../src/components/MotionStructureTracks';
import { motionDockHeight, motionMediaLanes, motionMediaTrackHeight } from '../../src/components/motion-timeline';
vi.mock('../../src/i18n', () => ({ useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => `${key}${params ? ` ${Object.values(params).join(' ')}` : ''}` }) }));
afterEach(cleanup);
const structure: MotionStructureResponse = {
  sourceFingerprint: 'source', composition: { id: 'main', duration: 12, width: 1920, height: 1080 }, warnings: [],
  scenes: [{ id: 'a', kind: 'scene', label: 'Opening', start: 0, duration: 5 }, { id: 'b', kind: 'scene', label: 'Features', start: 5, duration: 7 }],
  texts: [{ id: 'title-a', kind: 'text', label: 'Title', text: 'Opening title', sceneId: 'a' }, { id: 'title-b', kind: 'text', label: 'Title', text: 'Feature title', sceneId: 'b' }], audio: [], captions: [],
};
const props = { structure, time: 6.5, duration: 12, disabled: false, onSelect: vi.fn(), onModify: vi.fn() };
it('exposes actual scene intervals and only the current scene text without fabricating text timing', () => {
  render(<><MotionStructureTracks {...props} /><MotionSceneContents {...props} /></>);
  const scene = screen.getByRole('button', { name: 'motion.selectScene 2 Features 5 12' });
  expect(scene).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(scene); expect(props.onSelect).toHaveBeenLastCalledWith(structure.scenes[1]);
  expect(screen.queryByRole('button', { name: 'motion.selectText Opening title' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'motion.selectText Feature title' }));
  expect(props.onSelect).toHaveBeenLastCalledWith(structure.texts[1]);
  expect(structure.texts[1]).not.toHaveProperty('start');
});
it('keeps selection and modification separate, and blocks all new requests during transient work', () => {
  const { rerender } = render(<MotionSceneContents {...props} selectedId="title-b" />);
  fireEvent.click(screen.getByRole('button', { name: 'motion.modifySelection' }));
  expect(props.onModify).toHaveBeenLastCalledWith(structure.texts[1]);
  rerender(<MotionSceneContents {...props} selectedId="title-b" disabled />);
  expect(screen.getByRole('button', { name: 'motion.modifySelection' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'motion.selectText Feature title' })).toBeDisabled();
});
it('only adds media rows for real items and keeps overlapping sounds reachable in separate lanes', () => {
  expect(motionDockHeight(structure)).toBe(298);
  expect(motionMediaTrackHeight([])).toBe(0);
  const audio = [{ id: 'voice', kind: 'audio' as const, label: 'Voice', start: 1, duration: 5 }, { id: 'music', kind: 'audio' as const, label: 'Music', start: 0, duration: 12 }];
  expect(motionMediaLanes(audio).map(item => item.lane)).toEqual([0, 1]);
  expect(motionMediaTrackHeight(audio)).toBe(56);
  expect(motionDockHeight({ ...structure, audio })).toBe(354);
  render(<MotionStructureTracks {...props} structure={{ ...structure, audio }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Voice' }));
  expect(props.onSelect).toHaveBeenLastCalledWith(audio[0]);
});
it('falls back cleanly for absent scenes and selects the declared interval at a boundary', () => {
  expect(motionSceneAt(structure, 5)?.id).toBe('b');
  expect(motionSceneAt(structure, 12)?.id).toBe('b');
  expect(motionSceneAt({ ...structure, scenes: [] }, 5)).toBeUndefined();
  expect(motionDockHeight(null)).toBe(204);
});
