// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MotionStructureResponse } from '@open-design/contracts';
import { MotionRangeEditor, type MotionSelectionRange } from '../../src/components/MotionRangeEditor';
import { MotionPlaybackControls } from '../../src/components/MotionPlaybackControls';
import { MotionFrameComparison } from '../../src/components/MotionFrameComparison';

vi.mock('../../src/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);
const structure: MotionStructureResponse = {
  sourceFingerprint: 'source', composition: { id: 'main', duration: 12, width: 1920, height: 1080 }, warnings: [],
  scenes: [{ id: 'a', kind: 'scene', label: 'Opening', start: 0, duration: 5 }, { id: 'b', kind: 'scene', label: 'Features', start: 5, duration: 7 }],
  texts: [], audio: [], captions: [],
};
function RangeHarness({ time = 2, locked = false, onChange = () => {} }: { time?: number; locked?: boolean; onChange?(range: MotionSelectionRange | null): void }) {
  const [range, setRange] = useState<MotionSelectionRange | null>(null);
  return <MotionRangeEditor range={range} duration={12} time={time} structure={structure} disabled={false} locked={locked} onChange={value => { setRange(value); onChange(value); }} />;
}

it('keeps a range local until apply and only adopts a new scene explicitly', () => {
  const onChange = vi.fn();
  const { rerender } = render(<RangeHarness onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'motion.range.title' }));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('spinbutton', { name: 'motion.range.end' })).toHaveValue(5);
  rerender(<RangeHarness time={7} onChange={onChange} />);
  expect(screen.getByRole('spinbutton', { name: 'motion.range.end' })).toHaveValue(5);
  fireEvent.click(screen.getByRole('button', { name: 'motion.range.useScene' }));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('spinbutton', { name: 'motion.range.start' })).toHaveValue(5);
  fireEvent.click(screen.getByRole('button', { name: 'motion.range.apply' }));
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ startSeconds: 5, endSeconds: 12 });
  expect(screen.queryByRole('group')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'motion.range.title' }));
  fireEvent.click(screen.getByRole('button', { name: 'motion.range.clear' }));
  expect(onChange).toHaveBeenLastCalledWith(null);
  expect(screen.queryByRole('group')).toBeNull();
});

it('discards range drafts on cancel, Escape and outside click without leaking an implicit selection', () => {
  const onChange = vi.fn();
  render(<RangeHarness onChange={onChange} />);
  for (const dismiss of ['cancel', 'escape', 'outside']) {
    fireEvent.click(screen.getByRole('button', { name: 'motion.range.title' }));
    const start = screen.getByRole('spinbutton', { name: 'motion.range.start' });
    expect(start).toHaveValue(0);
    fireEvent.change(start, { target: { value: '1.2' } });
    fireEvent.blur(start);
    fireEvent.change(screen.getByRole('slider', { name: 'motion.range.end' }), { target: { value: '4' } });
    expect(onChange).not.toHaveBeenCalled();
    if (dismiss === 'cancel') fireEvent.click(screen.getByRole('button', { name: 'motion.range.cancel' }));
    if (dismiss === 'escape') fireEvent.keyDown(document, { key: 'Escape' });
    if (dismiss === 'outside') fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  }
});

it('rejects invalid intervals and freezes both endpoints during annotation', () => {
  const onChange = vi.fn();
  const { rerender } = render(<RangeHarness onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'motion.range.title' }));
  const end = screen.getByRole('spinbutton', { name: 'motion.range.end' });
  fireEvent.change(end, { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: 'motion.range.apply' }));
  expect(screen.getByRole('alert')).toHaveTextContent('motion.range.invalid');
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('slider', { name: 'motion.range.end' }), { target: { value: '6' } });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'motion.range.apply' }));
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ startSeconds: 0, endSeconds: 6 });
  fireEvent.click(screen.getByRole('button', { name: 'motion.range.title' }));
  rerender(<RangeHarness locked onChange={onChange} />);
  expect(screen.getByRole('button', { name: 'motion.range.title' })).toBeDisabled();
  expect(screen.getByRole('spinbutton', { name: 'motion.range.start' })).toBeDisabled();
  expect(screen.getByRole('slider', { name: 'motion.range.end' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'motion.range.clear' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'motion.range.apply' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'motion.range.cancel' }));
  expect(screen.queryByRole('group')).toBeNull();
  expect(onChange).toHaveBeenCalledTimes(1);
});

it('synchronizes an externally replaced range and retains it when a draft is dismissed', () => {
  const onChange = vi.fn();
  const props = { duration: 12, time: 2, structure, disabled: false, locked: false, onChange };
  const { rerender } = render(<MotionRangeEditor {...props} range={{ startSeconds: 1, endSeconds: 3 }} />);
  fireEvent.click(screen.getByRole('button', { name: 'motion.range.title' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'motion.range.start' }), { target: { value: '2' } });
  rerender(<MotionRangeEditor {...props} range={{ startSeconds: 5, endSeconds: 7 }} />);
  expect(screen.getByRole('spinbutton', { name: 'motion.range.start' })).toHaveValue(5);
  expect(screen.getByRole('spinbutton', { name: 'motion.range.end' })).toHaveValue(7);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'motion.range.end' }), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: 'motion.range.cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'motion.range.title' }));
  expect(screen.getByRole('spinbutton', { name: 'motion.range.end' })).toHaveValue(7);
  expect(onChange).not.toHaveBeenCalled();
});

it('routes reference capture and comparison separately and explains blocked comparison', () => {
  const capture = vi.fn(), compare = vi.fn();
  const props = { state: { time: 2, duration: 12, active: true, playing: false, muted: false, locked: false }, connected: true, error: null, onCommand: vi.fn(), onAnnotate: vi.fn(), onCaptureComparison: capture, onCompare: compare };
  const { rerender } = render(<MotionPlaybackControls {...props} />);
  expect(screen.queryByRole('button', { name: 'motion.comparison.capture' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'motion.more' }));
  fireEvent.click(screen.getByRole('button', { name: 'motion.comparison.capture' }));
  expect(capture).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'motion.comparison.compare' })).toBeNull();
  rerender(<MotionPlaybackControls {...props} comparison={{ time: 2 }} />);
  fireEvent.click(screen.getByRole('button', { name: 'motion.comparison.compare' }));
  expect(compare).toHaveBeenCalledOnce();
  rerender(<MotionPlaybackControls {...props} comparison={{ time: 2 }} comparisonDisabled comparisonError="outOfRange" />);
  fireEvent.click(screen.getByRole('button', { name: 'motion.more' }));
  expect(screen.getByRole('button', { name: 'motion.comparison.replace' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'motion.comparison.compare' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('motion.comparison.outOfRange');
  rerender(<MotionPlaybackControls {...props} comparison={{ time: 2 }} locked comparisonBusy />);
  expect(screen.getByRole('status')).toHaveTextContent('motion.comparison.waiting');
  expect(screen.getByRole('button', { name: 'motion.mute' })).toBeEnabled();
});

it('shows captured images with session scope and restores focus after Escape', () => {
  const onClose = vi.fn();
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
  const { unmount } = render(<MotionFrameComparison before={{ dataUrl: 'data:image/png;base64,before', time: 2 }} after={{ dataUrl: 'data:image/png;base64,after', time: 2 }} sameSource onClose={onClose} />);
  expect(screen.getByRole('img', { name: 'motion.comparison.before' })).toHaveAttribute('src', 'data:image/png;base64,before');
  expect(screen.getByRole('img', { name: 'motion.comparison.after' })).toHaveAttribute('src', 'data:image/png;base64,after');
  expect(screen.getByText('motion.comparison.sessionOnly')).toBeInTheDocument();
  expect(screen.getByText('motion.comparison.sameSource')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'motion.comparison.close' })).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Escape' }); expect(onClose).toHaveBeenCalledOnce();
  unmount(); expect(trigger).toHaveFocus(); trigger.remove();
});
