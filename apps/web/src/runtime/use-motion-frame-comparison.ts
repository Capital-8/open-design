import { useEffect, useRef, useState } from 'react';
import type { MotionPlayerControl } from '@open-design/contracts/runtime/motion-source-player';
import type { MotionCaptureContext, MotionFrameSnapshot } from '../comments/motion-capture';

export interface ComparisonFrame {
  dataUrl: string;
  time: number;
  fingerprint: string;
}
interface Options {
  fileKey: string;
  sourceKey: string;
  enabled: boolean;
  blocked: boolean;
  context(): MotionCaptureContext | null;
  command(control: MotionPlayerControl): Promise<unknown>;
  setLocked(value: boolean): Promise<unknown>;
  capture(): Promise<{ snapshot: MotionFrameSnapshot; motion: MotionCaptureContext['motion'] }>;
}

/** A session-only visual reference. It never owns a comment or a source version. */
export function useMotionFrameComparison(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const operation = useRef(0);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'outOfRange' | 'failed' | null>(null);
  const [saved, setSaved] = useState<{ fileKey: string; before: ComparisonFrame; after: ComparisonFrame | null } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    operation.current++;
    setOpen(false); setSaved(null); setError(null);
    return () => { operation.current++; };
  }, [options.fileKey, options.enabled]);
  useEffect(() => {
    operation.current++;
    setOpen(false); setError(null);
    setSaved(previous => previous ? { ...previous, after: null } : null);
  }, [options.sourceKey]);
  const baseline = saved?.fileKey === options.fileKey ? saved : null;

  async function capture(compare: boolean) {
    const input = latest.current;
    const initial = input.context();
    if (pending.current || !input.enabled || input.blocked || initial?.locked || !initial?.documentToken) return;
    if (compare && !baseline) return;
    const targetTime = compare ? baseline!.before.time : undefined;
    if (targetTime !== undefined && targetTime > initial.motion.durationSeconds) { setError('outOfRange'); return; }
    const id = ++operation.current;
    const token = initial.documentToken;
    const fingerprint = initial.motion.sourceFingerprint;
    const valid = () => {
      const current = latest.current.context();
      return id === operation.current && latest.current.enabled && !latest.current.blocked
        && latest.current.fileKey === input.fileKey && latest.current.sourceKey === input.sourceKey
        && current?.documentToken === token && current.motion.sourceFingerprint === fingerprint;
    };
    const check = () => { if (!valid()) throw new Error('changed'); };
    pending.current = true; setBusy(true); setError(null);
    let ownsLock = false;
    try {
      await input.command(targetTime === undefined ? { action: 'pause' } : { action: 'seek', time: targetTime });
      check();
      // No other UI operation may acquire this lock while the comparison is pending.
      ownsLock = true;
      await input.setLocked(true);
      check();
      const result = await input.capture();
      check();
      if (result.motion.sourceFingerprint !== fingerprint) throw new Error('wrong source');
      if (targetTime !== undefined && Math.abs(result.motion.timeSeconds - targetTime) > .001) throw new Error('wrong time');
      const frame: ComparisonFrame = { dataUrl: result.snapshot.dataUrl, time: result.motion.timeSeconds,
        fingerprint: result.motion.sourceFingerprint };
      setSaved(compare ? { fileKey: input.fileKey, before: baseline!.before, after: frame }
        : { fileKey: input.fileKey, before: frame, after: null });
      if (compare) setOpen(true);
    } catch (cause) {
      console.warn('[motion-frame-comparison] capture failed:', cause);
      if (id === operation.current) {
        setError('failed');
        if (compare) setSaved(previous => previous ? { ...previous, after: null } : null);
      }
    } finally {
      // Invalidation discards the frame, but a same-document lock still belongs
      // to this operation. Keep the single-flight guard until cleanup finishes.
      if (ownsLock && latest.current.fileKey === input.fileKey
        && latest.current.context()?.documentToken === token) {
        try { await input.setLocked(false); } catch { if (id === operation.current) setError('failed'); }
      }
      pending.current = false; setBusy(false);
    }
  }
  return {
    baseline, busy, error, isBusy: () => pending.current, open: open && !!baseline,
    capture: () => capture(false), compare: () => capture(true),
    show: () => { if (baseline) setOpen(true); },
    close: () => setOpen(false),
  };
}
