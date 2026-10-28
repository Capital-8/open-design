import type { BrowserSurfaceProps } from './types';
export function BrowserFrame({ src, title, onFrameLoad }: BrowserSurfaceProps) {
  return (
    <div className="db-fallback">
      <iframe title={title} src={src} onLoad={(event) => onFrameLoad(event.currentTarget)} />
    </div>
  );
}
