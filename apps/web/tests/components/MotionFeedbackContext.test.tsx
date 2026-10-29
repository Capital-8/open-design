// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MotionFeedbackContext, motionFeedbackFrameTarget } from '../../src/components/MotionFeedbackContext';
import { MOTION_TARGET_VISIBILITY_HELPER } from '@open-design/contracts/runtime/motion-target-visibility';

afterEach(cleanup);

function setup() {
  const onRangeChange = vi.fn(), onSelect = vi.fn();
  render(<MotionFeedbackContext structure={{ sourceFingerprint: 'test', composition: null,
    scenes: [], texts: [{ id: 'title', kind: 'text', label: 'Hidden title', text: 'Hidden title', selector: '#title' }],
    audio: [], captions: [], warnings: [] }} selectedId={null} label="Current frame"
    motion={{ timeSeconds: 2, durationSeconds: 5, sourceFingerprint: 'test' }} disabled={false}
    onSelect={onSelect} onRangeChange={onRangeChange} />);
  return { onRangeChange, onSelect };
}

it('keeps choosing and cancelling a time range local until explicit confirmation', () => {
  const { onRangeChange } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Select time range' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Start (s)' }), { target: { value: '1.25' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'End (s)' }), { target: { value: '2.75' } });
  expect(onRangeChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onRangeChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Select time range' }));
  expect(screen.getByRole('spinbutton', { name: 'Start (s)' })).toHaveValue(1);
  fireEvent.click(screen.getByRole('button', { name: 'Use time range' }));
  expect(onRangeChange).toHaveBeenCalledExactlyOnceWith({ startSeconds: 1, endSeconds: 3 });
});

it('rejects out-of-bounds ranges instead of changing the target', () => {
  const { onRangeChange } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Select time range' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'End (s)' }), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use time range' }));
  expect(onRangeChange).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toBeInTheDocument();
});

it('makes hidden elements reachable without showing the whole text list initially', () => {
  const { onSelect } = setup();
  expect(screen.queryByRole('button', { name: 'Select text: Hidden title' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Choose element' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select text: Hidden title' }));
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'title', selector: '#title' }));
});

it('uses the visible composition when an absolute-positioned scene has no height, without bypassing strict visibility', () => {
  const { container } = render(<main data-composition-id="main"><section id="scene-main"><span>Title</span></section></main>);
  const main = container.querySelector('main')!, scene = container.querySelector('section')!;
  vi.spyOn(main, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540, toJSON() {} });
  vi.spyOn(scene, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 960, bottom: 0, width: 960, height: 0, toJSON() {} });
  const structure = { sourceFingerprint: 'test', composition: { id: 'main', duration: 5, width: 960, height: 540 },
    scenes: [{ id: 'scene-main', kind: 'scene' as const, selector: '#scene-main', label: 'Main scene', start: 0, duration: 5 }],
    texts: [], audio: [], captions: [], warnings: [] };
  const strictTarget = new Function(`${MOTION_TARGET_VISIBILITY_HELPER}; return strictMotionTargetForSelector;`)() as (selector: string) => Element | null;
  expect(strictTarget('#scene-main')).toBeNull();
  const target = motionFeedbackFrameTarget(structure, 2.5);
  expect(target?.selector).toBe('[data-composition-id="main"]');
  expect(strictTarget(target!.selector!)).toBe(main);
  main.style.display = 'none';
  expect(strictTarget(target!.selector!)).toBeNull();
});
