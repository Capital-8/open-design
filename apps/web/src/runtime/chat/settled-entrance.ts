/**
 * OPEND-3922 · which transcript rows must not replay their entrance.
 *
 * `.msg` plays `msg-enter` (fade + rise) the moment it mounts. That is right
 * for a message arriving in front of the user, and wrong for a message the
 * user is already looking at that merely changed which component draws it.
 *
 * Creating a project from Home hands the first turn across three surfaces:
 * the pending frame's card → ProjectView's hand-off card → the real ChatPane.
 * The real ChatPane spends the hand-off mounted but parked out of sight under
 * the card (`composerLayerHidden`), and the auto-sent turn lands there. When
 * the card comes down, those rows were already on screen — drawn by the card —
 * so they must appear settled instead of fading in from transparent again.
 *
 * The rule: every message id ChatPane renders while parked is remembered for
 * the life of that pane. Rows for those ids skip the entrance; any message
 * that first appears after the pane is visible animates as usual.
 *
 * Returns the same set when nothing new was learned, so callers can keep it
 * in a ref without allocating on every render. Adding ids is idempotent, which
 * keeps StrictMode's double render and discarded concurrent renders harmless:
 * the worst outcome of an extra id is one message that does not fade in.
 */
export function rememberParkedMessageIds(
  seen: ReadonlySet<string>,
  parked: boolean,
  messageIds: readonly string[],
): ReadonlySet<string> {
  if (!parked) return seen;
  let next: Set<string> | null = null;
  for (const id of messageIds) {
    if (seen.has(id) || next?.has(id)) continue;
    next ??= new Set(seen);
    next.add(id);
  }
  return next ?? seen;
}

/** Value for a `.msg` row's `data-enter`; `undefined` keeps the attribute off. */
export function messageEnterAttribute(skip: boolean): 'skip' | undefined {
  return skip ? 'skip' : undefined;
}
