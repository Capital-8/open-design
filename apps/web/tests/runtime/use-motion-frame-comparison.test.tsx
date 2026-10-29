// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MotionPlayerControl } from '@open-design/contracts/runtime/motion-source-player';
import type { MotionCaptureContext } from '../../src/comments/motion-capture';
import { useMotionFrameComparison } from '../../src/runtime/use-motion-frame-comparison';

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function harness() {
  let context: MotionCaptureContext = {
    documentToken: 'doc-1', playing: true, locked: false,
    motion: { timeSeconds: 6.5, durationSeconds: 12, sourceFingerprint: 'source-1' },
  };
  const frame = () => ({ snapshot: { dataUrl: `data:image/png,${context.motion.sourceFingerprint}`, w: 1920, h: 1080 }, motion: { ...context.motion } });
  const command = vi.fn(async (control: MotionPlayerControl) => {
    context = { ...context, playing: false, motion: { ...context.motion,
      ...(control.action === 'seek' ? { timeSeconds: control.time } : {}) } };
  });
  const setLocked = vi.fn(async (locked: boolean) => { context = { ...context, locked }; });
  const capture = vi.fn(async () => frame());
  const initialProps = { fileKey: 'file-1', sourceKey: 'source-1', enabled: true, blocked: false };
  const hook = renderHook(props => useMotionFrameComparison({ ...props, context: () => context, command, setLocked, capture }), { initialProps });
  return { ...hook, initialProps, command, setLocked, capture, frame,
    getContext: () => context,
    context: (patch: Partial<MotionCaptureContext>, motion: Partial<MotionCaptureContext['motion']> = {}) => {
      context = { ...context, ...patch, motion: { ...context.motion, ...motion } };
    },
  };
}

describe('Motion frame comparison', () => {
  it('captures a baseline, seeks exactly its time, and clears only the after-frame on a source update', async () => {
    const h = harness();
    await act(() => h.result.current.capture());
    expect(h.result.current.baseline?.before).toMatchObject({ time: 6.5, fingerprint: 'source-1' });
    expect(h.setLocked.mock.calls).toEqual([[true], [false]]);
    h.context({}, { timeSeconds: 3, sourceFingerprint: 'source-2' });
    h.rerender({ ...h.initialProps, sourceKey: 'source-2' });
    expect(h.result.current.baseline?.before.fingerprint).toBe('source-1');
    await act(() => h.result.current.compare());
    expect(h.command).toHaveBeenLastCalledWith({ action: 'seek', time: 6.5 });
    expect(h.result.current.baseline?.after).toMatchObject({ time: 6.5, fingerprint: 'source-2' });
    expect(h.result.current.open).toBe(true);
    h.context({}, { sourceFingerprint: 'source-3' });
    h.rerender({ ...h.initialProps, sourceKey: 'source-3' });
    expect(h.result.current.baseline?.before.fingerprint).toBe('source-1');
    expect(h.result.current.baseline?.after).toBeNull();
    expect(h.result.current.open).toBe(false);
  });

  it('does not take a screenshot or change playback while a draft blocks comparison', async () => {
    const h = harness();
    h.rerender({ ...h.initialProps, blocked: true });
    await act(() => h.result.current.capture());
    expect(h.command).not.toHaveBeenCalled();
    expect(h.setLocked).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
  });

  it('never releases a lock it found already held', async () => {
    const h = harness();
    h.context({ locked: true });
    await act(() => h.result.current.capture());
    expect(h.setLocked).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
  });

  it('rejects a shorter current duration instead of clamping the baseline time', async () => {
    const h = harness();
    await act(() => h.result.current.capture());
    h.command.mockClear(); h.capture.mockClear();
    h.context({}, { durationSeconds: 5, sourceFingerprint: 'source-2' });
    h.rerender({ ...h.initialProps, sourceKey: 'source-2' });
    await act(() => h.result.current.compare());
    expect(h.result.current.error).toBe('outOfRange');
    expect(h.command).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
    expect(h.result.current.baseline?.before.time).toBe(6.5);
  });

  it('drops a late screenshot after changing files and never unlocks the new document', async () => {
    const h = harness();
    const pending = deferred<ReturnType<typeof h.frame>>();
    h.capture.mockImplementationOnce(() => pending.promise);
    let work!: Promise<void>;
    await act(async () => { work = h.result.current.capture(); await Promise.resolve(); await Promise.resolve(); });
    expect(h.capture).toHaveBeenCalledTimes(1);
    const oldFrame = h.frame();
    h.context({ documentToken: 'doc-2', locked: true }, { sourceFingerprint: 'other-file' });
    h.rerender({ ...h.initialProps, fileKey: 'file-2', sourceKey: 'other-file' });
    await act(async () => { pending.resolve(oldFrame); await work; });
    expect(h.result.current.baseline).toBeNull();
    expect(h.setLocked.mock.calls).toEqual([[true]]);
    expect(h.result.current.isBusy()).toBe(false);
  });

  it('keeps one flight until a cancelled same-document capture releases its own lock', async () => {
    const h = harness();
    const pending = deferred<ReturnType<typeof h.frame>>();
    h.capture.mockImplementationOnce(() => pending.promise);
    let work!: Promise<void>;
    await act(async () => { work = h.result.current.capture(); await Promise.resolve(); await Promise.resolve(); });
    const oldFrame = h.frame();
    h.context({}, { sourceFingerprint: 'source-2' });
    h.rerender({ ...h.initialProps, sourceKey: 'source-2' });
    expect(h.result.current.isBusy()).toBe(true);
    await act(() => h.result.current.capture());
    expect(h.capture).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(oldFrame); await work; });
    expect(h.result.current.baseline).toBeNull();
    expect(h.setLocked.mock.calls).toEqual([[true], [false]]);
    expect(h.getContext().locked).toBe(false);
    expect(h.result.current.isBusy()).toBe(false);
  });

  it('refuses to publish a comparison captured at a different time and preserves the baseline', async () => {
    const h = harness();
    await act(() => h.result.current.capture());
    h.capture.mockImplementationOnce(async () => ({ ...h.frame(), motion: { ...h.frame().motion, timeSeconds: 7 } }));
    await act(() => h.result.current.compare());
    expect(h.result.current.error).toBe('failed');
    expect(h.result.current.baseline?.before.time).toBe(6.5);
    expect(h.result.current.baseline?.after).toBeNull();
    expect(h.getContext().locked).toBe(false);
  });

  it('checks the live source after pause before acquiring a screenshot lock', async () => {
    const h = harness();
    h.command.mockImplementationOnce(async () => { h.context({}, { sourceFingerprint: 'new-source-before-render' }); });
    await act(() => h.result.current.capture());
    expect(h.setLocked).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
    expect(h.result.current.baseline).toBeNull();
  });
});
