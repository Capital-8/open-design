// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { groupMotionTimelineComments, motionTimelineTicks, motionCompositionSize, motionStageLayout } from '../../src/components/motion-timeline';
import { MotionPlaybackControls, motionStepTime } from '../../src/components/MotionPlaybackControls';

vi.mock('../../src/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);
const state = { time: 2.4, duration: 8, active: true, playing: false, muted: false, locked: false, fps: 30 };

it('steps at the authored frame rate and stops at the last valid sample', () => {
  expect(motionStepTime(2.4, 8, 30, 1)).toBeCloseTo(2.433333333);
  expect(motionStepTime(motionStepTime(motionStepTime(2.4, 8, 30, 1), 8, 30, 1), 8, 30, 1)).toBeCloseTo(2.5);
  expect(motionStepTime(8, 8, 30, 1)).toBeCloseTo(239 / 30);
  expect(motionStepTime(0, 8, 30, -1)).toBe(0);
  expect(motionStepTime(2.4, 8, undefined, 1)).toBe(2.5);
});

it('uses confirmed state for the slider and sends frame-accurate seek commands', () => {
  const onCommand = vi.fn();
  const { rerender } = render(<MotionPlaybackControls state={state} connected error={null} onCommand={onCommand} onAnnotate={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'motion.nextFrame' }));
  expect(onCommand).toHaveBeenCalledWith({ action: 'seek', time: 73 / 30 });
  expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('2.4');
  rerender(<MotionPlaybackControls state={{ ...state, time: 73 / 30 }} connected error={null} onCommand={onCommand} onAnnotate={() => {}} />);
  expect(Number((screen.getByRole('slider') as HTMLInputElement).value)).toBeCloseTo(73 / 30);
});

it('shows time steps for unknown fps and disables positioning while annotating', async () => {
  const onCommand = vi.fn(); let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  render(<MotionPlaybackControls state={{ ...state, fps: undefined }} connected error={null} onCommand={onCommand} onAnnotate={() => pending} />);
  expect(screen.queryByRole('button', { name: 'motion.nextFrame' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'motion.nextStep' }));
  expect(onCommand).toHaveBeenCalledWith({ action: 'seek', time: 2.5 });
  fireEvent.click(screen.getByRole('button', { name: 'motion.annotate' }));
  expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'motion.play' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('status').textContent).toBe('motion.locked');
  await act(async () => { finish(); await pending; });
  expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(false);
});

it('clamps numeric input and ignores empty or invalid entries', async () => {
  const onCommand = vi.fn();
  render(<MotionPlaybackControls state={state} connected error={null} onCommand={onCommand} onAnnotate={() => {}} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'motion.timeInput' })); });
  let input = screen.getByRole('spinbutton');
  fireEvent.focus(input); fireEvent.change(input, { target: { value: '99' } }); fireEvent.blur(input);
  expect(onCommand).toHaveBeenCalledWith({ action: 'seek', time: 8 });
  onCommand.mockClear();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'motion.timeInput' })); });
  input = screen.getByRole('spinbutton');
  fireEvent.focus(input); fireEvent.change(input, { target: { value: '' } }); fireEvent.blur(input);
  expect(onCommand).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'seek' }));
});

it('opens time editing after pause acknowledgement and preserves the draft across clock updates', async () => {
  let confirm!: (value: typeof state) => void;
  const onCommand = vi.fn(() => new Promise<typeof state>(resolve => { confirm = resolve; }));
  const { rerender } = render(<MotionPlaybackControls state={{ ...state, playing: true }} connected error={null} onCommand={onCommand} onAnnotate={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'motion.timeInput' }));
  expect(onCommand).toHaveBeenCalledWith({ action: 'pause' });
  expect(screen.queryByRole('spinbutton')).toBeNull();
  await act(async () => { confirm({ ...state, time: 2.51 }); });
  expect(screen.getByRole('spinbutton')).toHaveValue(2.51);
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '6.8' } });
  rerender(<MotionPlaybackControls state={{ ...state, time: 2.51 }} connected error={null} onCommand={onCommand} onAnnotate={() => {}} />);
  expect(screen.getByRole('spinbutton')).toHaveValue(6.8);
  fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Escape' });
  expect(screen.queryByRole('spinbutton')).toBeNull();
  expect(onCommand).toHaveBeenCalledTimes(1);
});

it('commits Enter once and keeps failed pause out of time editing', async () => {
  const onCommand = vi.fn();
  const { rerender } = render(<MotionPlaybackControls state={state} connected error={null} onCommand={onCommand} onAnnotate={() => {}} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'motion.timeInput' })); });
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3.2' } });
  fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Enter' });
  expect(onCommand.mock.calls.filter(([control]) => control.action === 'seek')).toEqual([[{ action: 'seek', time: 3.2 }]]);
  onCommand.mockRejectedValueOnce(new Error('pause failed'));
  rerender(<MotionPlaybackControls state={{ ...state, playing: true }} connected error={null} onCommand={onCommand} onAnnotate={() => {}} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'motion.timeInput' })); });
  expect(screen.queryByRole('spinbutton')).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('motion.commandFailed');
});

it('keeps comment selection separate from the locked seek track and blocks transient work', () => {
  const onOpenComment = vi.fn(); const onCommand = vi.fn();
  const comments = [{ id: 'a', time: 2, number: 1, note: 'Title' }, { id: 'b', time: 2.01, number: 2, note: 'Colour' }, { id: 'c', time: 6, number: 3, note: 'Ending' }];
  const props = { state: { ...state, locked: true }, connected: true, error: null, comments, onOpenComment, onCommand, onAnnotate() {} };
  const { rerender } = render(<MotionPlaybackControls {...props} />);
  expect(screen.getByRole('slider')).toBeDisabled();
  fireEvent.change(screen.getByRole('combobox', { name: 'motion.commentGroup' }), { target: { value: 'b' } });
  expect(onOpenComment).toHaveBeenCalledWith('b');
  fireEvent.click(screen.getByRole('button', { name: 'motion.openComment · Ending' }));
  expect(onOpenComment).toHaveBeenLastCalledWith('c');
  expect(onCommand).not.toHaveBeenCalled();
  rerender(<MotionPlaybackControls {...props} commentsDisabled />);
  expect(screen.getByRole('combobox')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'motion.openComment · Ending' })).toBeDisabled();
});

it('groups nearby comments by pixel distance and keeps useful bounded ruler ticks', () => {
  const comments = [{ id: 'a', time: 0, number: 1, note: '' }, { id: 'b', time: .2, number: 2, note: '' }, { id: 'c', time: 8, number: 3, note: '' }, { id: 'bad', time: NaN, number: 4, note: '' }];
  expect(groupMotionTimelineComments(comments, 8, 200).map(group => group.comments.length)).toEqual([2, 1]);
  expect(groupMotionTimelineComments(comments, 8, 2000).map(group => group.comments.length)).toEqual([1, 1, 1]);
  expect(motionTimelineTicks(12, 500)).toEqual([0, 2, 4, 6, 8, 10, 12]);
  expect(motionTimelineTicks(12.01, 150)).toEqual([0, 12.01]);
  expect(motionTimelineTicks(0, 500)).toEqual([]);
});

it('keeps the authored iframe viewport intact and fits the whole frame in the available canvas', () => {
  const size = motionCompositionSize('<main data-composition-id="main" data-duration="12" data-width="1920" data-height="1080"></main>')!;
  const layout = motionStageLayout(size, { width: 349, height: 425 });
  expect(layout.width).toBe(1920);
  expect(layout.height).toBe(1080);
  expect(layout.left).toBe(0);
  expect(layout.top).toBeCloseTo((425 - 349 * 1080 / 1920) / 2);
  expect(layout.width * layout.scale).toBeCloseTo(349);
  const short = motionStageLayout(size, { width: 1000, height: 200 });
  expect(short.height * short.scale).toBe(200);
  expect(short.left).toBeGreaterThan(0);
  expect(motionCompositionSize('<main data-composition-id="main" data-duration="12" data-width="NaN" data-height="1080"></main>')).toBeNull();
});
