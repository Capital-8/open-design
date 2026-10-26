import { prependAfterDoctype } from '@open-design/contracts/runtime/html-injection-points';
import { buildSrcdoc } from './srcdoc';

export const MOTION_FILMSTRIP_LIMIT = 6;

export function motionFilmstripTimes(duration: number, width: number): number[] {
  if (!(duration > 0) || !Number.isFinite(duration) || !(width > 0)) return [];
  const count = Math.min(MOTION_FILMSTRIP_LIMIT, Math.max(2, Math.ceil(width / 100)));
  // Each image represents the middle of its visible time interval.
  return Array.from({ length: count }, (_, i) => Math.min(duration, Number((duration * (i + .5) / count).toFixed(3))));
}

/** Reuse preview sandbox/redirect guards; each miniature owns a separate, muted clock. */
export function buildMotionFilmstripDocument(source: string, baseHref: string, reloadKey: number): string {
  const document = buildSrcdoc(source, { motionPreview: true, baseHref, reloadKey });
  return prependAfterDoctype(document, `<script data-od-motion-filmstrip>
window.__odMotionThumbnail = true;
document.addEventListener('play', function (event) {
  if (event.target instanceof HTMLMediaElement) { event.target.muted = true; event.target.pause(); }
}, true);
</script>`);
}
