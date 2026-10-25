// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
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

it('clamps numeric input and ignores empty or invalid entries', () => {
  const onCommand = vi.fn();
  render(<MotionPlaybackControls state={state} connected error={null} onCommand={onCommand} onAnnotate={() => {}} />);
  const input = screen.getByRole('spinbutton');
  fireEvent.focus(input); fireEvent.change(input, { target: { value: '99' } }); fireEvent.blur(input);
  expect(onCommand).toHaveBeenCalledWith({ action: 'seek', time: 8 });
  onCommand.mockClear();
  fireEvent.focus(input); fireEvent.change(input, { target: { value: '' } }); fireEvent.blur(input);
  expect(onCommand).not.toHaveBeenCalled();
});
