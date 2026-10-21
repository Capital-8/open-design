import { describe, expect, it } from 'vitest';

import {
  messageEnterAttribute,
  rememberParkedMessageIds,
} from '../../../src/runtime/chat/settled-entrance';

// OPEND-3922: rows ChatPane rendered while parked under the creation hand-off
// card were already shown to the user by that card, so they must not replay
// `msg-enter` when the card comes down. Anything arriving later still enters.

describe('rememberParkedMessageIds', () => {
  it('remembers every id rendered while the pane is parked', () => {
    const seen = rememberParkedMessageIds(new Set(), true, ['u1', 'a1']);
    expect([...seen]).toEqual(['u1', 'a1']);
  });

  it('learns nothing once the pane is visible, so later messages still animate', () => {
    const parked = rememberParkedMessageIds(new Set(), true, ['u1', 'a1']);
    const visible = rememberParkedMessageIds(parked, false, ['u1', 'a1', 'u2', 'a2']);
    expect(visible).toBe(parked);
    expect(visible.has('u2')).toBe(false);
    expect(visible.has('a2')).toBe(false);
  });

  it('keeps ids learned while parked after the pane becomes visible', () => {
    const parked = rememberParkedMessageIds(new Set(), true, ['u1']);
    const visible = rememberParkedMessageIds(parked, false, []);
    expect(visible.has('u1')).toBe(true);
  });

  it('returns the same set when nothing new was learned (idempotent under re-render)', () => {
    const first = rememberParkedMessageIds(new Set(), true, ['u1', 'a1']);
    expect(rememberParkedMessageIds(first, true, ['u1', 'a1'])).toBe(first);
    expect(rememberParkedMessageIds(first, true, ['a1'])).toBe(first);
  });

  it('does not mutate the set it was given', () => {
    const start = new Set(['u1']);
    const next = rememberParkedMessageIds(start, true, ['u1', 'a1']);
    expect([...start]).toEqual(['u1']);
    expect([...next]).toEqual(['u1', 'a1']);
  });
});

describe('messageEnterAttribute', () => {
  it('only emits the attribute when the entrance is skipped', () => {
    expect(messageEnterAttribute(true)).toBe('skip');
    expect(messageEnterAttribute(false)).toBeUndefined();
  });
});
