/** Shared source for the URL/srcdoc bridges; importing this module does not access the DOM. */
export const MOTION_TARGET_VISIBILITY_HELPER = `
function strictMotionTargetForSelector(selector) {
  if (typeof selector !== 'string' || !selector.trim()) return null;
  try {
    var nodes = document.querySelectorAll(selector);
    if (nodes.length !== 1) return null;
    var target = nodes[0];
    var rect = target.getBoundingClientRect();
    var viewportWidth = window.innerWidth, viewportHeight = window.innerHeight;
    if (![rect.left, rect.top, rect.width, rect.height, viewportWidth, viewportHeight].every(Number.isFinite)
      || rect.width <= 0 || rect.height <= 0 || viewportWidth <= 0 || viewportHeight <= 0
      || Math.min(rect.left + rect.width, viewportWidth) <= Math.max(rect.left, 0)
      || Math.min(rect.top + rect.height, viewportHeight) <= Math.max(rect.top, 0)) return null;
    for (var node = target; node; node = node.parentElement) {
      var style = window.getComputedStyle(node);
      var opacity = Number.parseFloat(style.opacity);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
        || (Number.isFinite(opacity) && opacity <= 0)) return null;
    }
    return target;
  } catch (_) { return null; }
}
`;
