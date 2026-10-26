import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Film } from 'lucide-react';
import { MotionPreviewTransport } from '../runtime/motion-preview-transport';
import { motionFilmstripTimes } from '../runtime/motion-filmstrip';
import styles from './MotionFilmstrip.module.css';

export interface MotionFilmstripSource {
  document: string;
  identity: string;
  size: { width: number; height: number };
}

const MotionFilmstripFrame = memo(function MotionFilmstripFrame({ source, time }: { source: MotionFilmstripSource; time: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState('loading');

  useLayoutEffect(() => {
    const host = hostRef.current, frame = frameRef.current;
    if (!host || !frame) return;
    const fit = () => {
      const scale = Math.max(host.clientWidth / source.size.width, host.clientHeight / source.size.height);
      frame.style.transform = `scale(${scale})`;
      frame.style.left = `${(host.clientWidth - source.size.width * scale) / 2}px`;
      frame.style.top = `${(host.clientHeight - source.size.height * scale) / 2}px`;
    };
    fit();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(host);
    return () => observer?.disconnect();
  }, [source.size]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let disposed = false, attempt = 0, documentToken: string | null = null;
    const transport = new MotionPreviewTransport(snapshot => {
      if (disposed) return;
      if (!snapshot.connected) {
        ++attempt; documentToken = null;
        setStatus(snapshot.error ? 'error' : 'loading');
        return;
      }
      if (snapshot.error) { setStatus('error'); return; }
      if (snapshot.documentToken === documentToken) return;
      documentToken = snapshot.documentToken;
      const currentAttempt = ++attempt;
      void (async () => {
        try {
          await transport.command({ action: 'seek', time });
          if (disposed || currentAttempt !== attempt) return;
          const actual = await transport.command({ action: 'lock', value: true });
          if (actual.playing || !actual.muted || !actual.locked || Math.abs(actual.time - time) > .001) throw new Error('Thumbnail clock mismatch');
          if (!disposed && currentAttempt === attempt) setStatus('ready');
        } catch { if (!disposed && currentAttempt === attempt) setStatus('error'); }
      })();
    });
    transport.bind(frame, `${source.identity}:${time}`, true);
    return () => { disposed = true; transport.dispose(); };
  }, [source.identity, time]);

  return <div ref={hostRef} className={styles.frame} data-state={status} title={`${time.toFixed(3)}s`}>
    <Film className={styles.placeholder} size={15} />
    <iframe ref={frameRef} title={`Motion ${time.toFixed(3)}s`} data-testid="motion-filmstrip-frame" data-time={time}
      aria-hidden="true" tabIndex={-1} sandbox="allow-scripts" srcDoc={source.document}
      style={{ width: source.size.width, height: source.size.height, opacity: status === 'ready' ? 1 : 0 }} />
  </div>;
});

export const MotionFilmstrip = memo(function MotionFilmstrip({ source, duration, width }: { source: MotionFilmstripSource; duration: number; width: number }) {
  const times = motionFilmstripTimes(duration, width);
  return <div className={styles.strip} aria-hidden="true" data-testid="motion-filmstrip">
    {times.map(time => <MotionFilmstripFrame key={`${source.identity}:${time}`} source={source} time={time} />)}
  </div>;
});
