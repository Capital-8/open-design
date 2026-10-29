// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { injectMotionSourcePlayer, MOTION_AUDIO_SYNC_RUNTIME, MOTION_PREVIEW_ACTIVITY, MOTION_PREVIEW_REQUEST, MOTION_PREVIEW_CONNECT, MOTION_PREVIEW_COMMAND, MOTION_PREVIEW_STATE } from '@open-design/contracts/runtime/motion-source-player';

type MotionWindow = Window & {
  __odMotionSourcePlayer?: boolean;
  __odMotionPreview?: boolean;
  __odMotionThumbnail?: boolean;
  __odMotionRender?: boolean;
  __timelines?: Record<string, unknown>;
  __odMotionPlayer?: { state(): { playing: boolean; time: number; locked: boolean; muted: boolean; userMuted?: boolean; fps?: number }; pause(): void; play(): void; seek(time: number): void; replay(): void; setMuted(value: boolean): void; setLocked(value: boolean): void; setLoop(range: { start: number; end: number } | null): boolean };
};
const motionWindow = window as MotionWindow;
let dispose: (() => void) | undefined;
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  dispose?.();
  delete motionWindow.__odMotionSourcePlayer;
  delete motionWindow.__odMotionPreview;
  delete motionWindow.__odMotionThumbnail;
  delete motionWindow.__odMotionRender;
  delete motionWindow.__odMotionPlayer;
  delete motionWindow.__timelines;
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function boot(hosted: boolean, playResult: Promise<void> = Promise.resolve(), thumbnail = false, fps?: string, render = false, duration = 15) {
  vi.useFakeTimers();
  const listeners = vi.spyOn(window, 'addEventListener');
  const post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
  document.head.innerHTML = '<meta name="od-motion-output" content="video">';
  document.body.innerHTML = '<main data-composition-id="main" data-duration="15" data-width="1920" data-height="1080"><audio src="sound.wav" data-duration="15"></audio></main>';
  document.querySelector('main')!.setAttribute('data-duration', String(duration));
  if (fps !== undefined) document.querySelector('main')!.setAttribute('data-fps', fps);
  const audio = document.querySelector('audio')!;
  let audioPaused = true;
  Object.defineProperties(audio, { paused: { get: () => audioPaused }, readyState: { value: 4 } });
  vi.spyOn(audio, 'play').mockImplementation(() => { audioPaused = false; return playResult; });
  vi.spyOn(audio, 'pause').mockImplementation(() => { audioPaused = true; });
  let time = 0, paused = false;
  const timeline = {
    time: () => time, duration: () => duration, timeScale: () => 1,
    repeat: () => 0, delay: () => 0, paused: () => paused,
    seek: (value: number) => { time = value; },
    play: () => { paused = false; }, pause: () => { paused = true; },
  };
  motionWindow.__timelines = { main: timeline };
  motionWindow.__odMotionPreview = hosted;
  motionWindow.__odMotionThumbnail = thumbnail;
  motionWindow.__odMotionRender = render;
  const html = injectMotionSourcePlayer(document.documentElement.outerHTML);
  const script = /<script data-od-motion-source-player[^>]*>([\s\S]*?)<\/script>/.exec(html)![1];
  window.eval(script!);
  document.dispatchEvent(new Event('DOMContentLoaded'));
  dispose = () => {
    for (const [type, listener, options] of listeners.mock.calls) window.removeEventListener(type, listener, options);
  };
  const id = (post.mock.calls.find(([data]) => data.type === MOTION_PREVIEW_REQUEST)?.[0] as {id?: string} | undefined)?.id;
  const activity = (active: boolean, instance = id, source: MessageEventSource | null = window.parent, muted = false) => {
    window.dispatchEvent(new MessageEvent('message', {source, data:{type:MOTION_PREVIEW_ACTIVITY, id:instance, active, muted}}));
  };
  const message = (data: unknown, source: MessageEventSource | null = window.parent) => window.dispatchEvent(new MessageEvent('message', { source, data }));
  return { audio, timeline, activity, post, id, message, simulateDelayedStart: () => { audioPaused = false; }, player: motionWindow.__odMotionPlayer! };
}

it('keeps frame rendering free from preview clocks, chrome, and layout scaling', () => {
  const { player } = boot(true, Promise.resolve(), false, '30', true);
  expect(player).toBeUndefined();
  expect(document.querySelector('[data-od-motion-status]')).toBeNull();
  expect(document.querySelector('main')!.parentElement).toBe(document.body);
});

it('confirms actual pause and seek with a per-document challenge and request acknowledgement', () => {
  const { activity, timeline, message, post, id, player } = boot(true, Promise.resolve(), false, '30');
  activity(true); timeline.seek(2.4);
  message({ type: MOTION_PREVIEW_CONNECT, clientId: 'client-a', requestId: 'connect-a' });
  expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ type: MOTION_PREVIEW_STATE, clientId: 'client-a', instance: id, requestId: 'connect-a', state: { playing: true, time: 2.4, fps: 30 } });
  message({ type: MOTION_PREVIEW_COMMAND, clientId: 'client-a', instance: id, requestId: 'pause-a', control: { action: 'pause' } });
  expect(timeline.paused()).toBe(true);
  expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ requestId: 'pause-a', state: { playing: false, time: 2.4 } });
  message({ type: MOTION_PREVIEW_COMMAND, clientId: 'client-a', instance: id, requestId: 'seek-a', control: { action: 'seek', time: 99 } });
  expect(player.state().time).toBe(15);
  expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ requestId: 'seek-a', state: { playing: false, time: 15 } });
});

it('ignores wrong source, obsolete challenge and obsolete document instance commands', () => {
  const { message, id, player } = boot(true);
  message({ type: MOTION_PREVIEW_CONNECT, clientId: 'old-client', requestId: 'first' });
  message({ type: MOTION_PREVIEW_CONNECT, clientId: 'new-client', requestId: 'second' });
  for (const [clientId, instance, source] of [['old-client', id, window.parent], ['new-client', 'old-document', window.parent], ['new-client', id, null]] as const) {
    message({ type: MOTION_PREVIEW_COMMAND, clientId, instance, requestId: 'ignored', control: { action: 'seek', time: 9 } }, source);
    expect(player.state().time).toBe(0);
  }
});

it('keeps a locked annotation paused through root clicks, controls, and reactivation', async () => {
  const { activity, message, player, audio, id } = boot(true);
  activity(true);
  message({ type: MOTION_PREVIEW_CONNECT, clientId: 'annotation', requestId: 'connect' });
  const command = (action: string, extra: object = {}) => message({ type: MOTION_PREVIEW_COMMAND, clientId: 'annotation', instance: id, requestId: action, control: { action, ...extra } });
  command('seek', { time: 2.4 }); command('lock', { value: true });
  document.querySelector('main')!.click();
  command('play'); command('replay'); command('seek', { time: 5 });
  activity(false); activity(true);
  await vi.advanceTimersByTimeAsync(150);
  expect(player.state()).toMatchObject({ playing: false, locked: true, time: 2.4 });
  expect(audio.paused).toBe(true);
  command('lock', { value: false });
  expect(player.state().playing).toBe(false);
  command('play');
  expect(player.state().playing).toBe(true);
});

it.each([undefined, '', 'NaN', '0', '-30', '241'])('does not invent a frame rate from data-fps=%s', fps => {
  const { player } = boot(true, Promise.resolve(), false, fps);
  expect(player.state().fps).toBeUndefined();
});

it('rejects non-finite seek values without corrupting the visual clock', () => {
  const { player } = boot(false);
  player.seek(2.4);
  player.seek(NaN); player.seek(Infinity);
  expect(player.state().time).toBe(2.4);
});

it('atomically restores a paused time and lock before acknowledging a replacement preview', () => {
  const { activity, message, player, post } = boot(true, Promise.resolve(), false, '30');
  activity(true);
  message({ type: MOTION_PREVIEW_CONNECT, clientId: 'replacement', requestId: 'restore', restore: { time: 2.5, locked: true, muted: true } });
  expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ requestId: 'restore', restored: true, state: { time: 2.5, playing: false, locked: true, muted: true } });
  activity(false); activity(true);
  expect(player.state()).toMatchObject({ time: 2.5, playing: false, locked: true });
});

it.each([false, true])('preserves user mute=%s without turning temporary host suppression into a user preference', userMuted => {
  const { activity, message, player } = boot(true);
  activity(true, undefined, window.parent, true);
  player.setMuted(userMuted); player.seek(2.5);
  const paused = player.state();
  expect(paused).toMatchObject({ playing: false, muted: true, userMuted });
  message({ type: MOTION_PREVIEW_CONNECT, clientId: 'replacement', requestId: 'restore',
    restore: { time: paused.time, locked: paused.locked, muted: paused.userMuted ?? false } });
  activity(true, undefined, window.parent, false);
  expect(player.state()).toMatchObject({ time: 2.5, playing: false, muted: userMuted, userMuted });
});

it('keeps a hosted motion source and its audio paused until the host confirms it is active', () => {
  const { audio, timeline, player } = boot(true);
  expect(player.state().playing).toBe(false);
  expect(timeline.paused()).toBe(true);
  expect(audio.paused).toBe(true);
});

it('keeps standalone motion autoplay unchanged', () => {
  const { audio, timeline, player } = boot(false);
  expect(player.state().playing).toBe(true);
  expect(timeline.paused()).toBe(false);
  expect(audio.paused).toBe(false);
});

it('loops the thumbnail timeline while keeping its soundtrack paused and permanently muted', async () => {
  const { audio, timeline, player, activity } = boot(true, Promise.resolve(), true);
  activity(true);
  expect(player.state().playing).toBe(true);
  expect(timeline.paused()).toBe(false);
  expect(audio.paused).toBe(true);
  expect(audio.muted).toBe(true);
  expect(audio.play).not.toHaveBeenCalled();
  timeline.seek(15);
  await vi.advanceTimersByTimeAsync(34);
  expect(timeline.time()).toBe(0);
  expect(timeline.paused()).toBe(false);
  player.setMuted(false);
  expect(audio.muted).toBe(true);
  expect(audio.play).not.toHaveBeenCalled();
  activity(false);
  expect(timeline.paused()).toBe(true);
});

it('loops a hosted range at the composition end without waiting for host state polling', async () => {
  const { timeline, player, activity, message, post, id, audio } = boot(true, Promise.resolve(), false, '30', false, 5);
  activity(true);
  message({ type: MOTION_PREVIEW_CONNECT, clientId: 'range', requestId: 'connect' });
  message({ type: MOTION_PREVIEW_COMMAND, clientId: 'range', instance: id, requestId: 'set-range', control: { action: 'loop', range: { start: 4, end: 5 } } });
  expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ requestId: 'set-range', error: undefined, state: { playing: true, time: 4 } });
  for (let cycle = 0; cycle < 3; cycle++) {
    // GSAP may already be paused at the exact end before the next 33 ms tick.
    timeline.seek(5); timeline.pause();
    await vi.advanceTimersByTimeAsync(34);
    expect(timeline.time()).toBe(4);
    expect(timeline.paused()).toBe(false);
    expect(audio.currentTime).toBe(4);
  }
  expect(timeline.duration()).toBe(5);
  expect(timeline.timeScale()).toBe(1);
  expect(timeline.repeat()).toBe(0);
  player.seek(2);
  expect(player.state()).toMatchObject({ playing: false, time: 2 });
  player.play();
  expect(timeline.time()).toBe(4);
  player.replay();
  expect(timeline.time()).toBe(4);
  expect(player.setLoop(null)).toBe(true);
  timeline.seek(5);
  await vi.advanceTimersByTimeAsync(34);
  expect(timeline.time()).toBe(0);
});

it('rejects invalid or locked loop commands without replacing the previous valid interval', async () => {
  const { player, timeline, activity, message, post, id } = boot(true, Promise.resolve(), false, '30', false, 5);
  activity(true);
  message({ type: MOTION_PREVIEW_CONNECT, clientId: 'range', requestId: 'connect' });
  expect(player.setLoop({ start: 4, end: 5 })).toBe(true);
  for (const range of [undefined, {}, { start: NaN, end: 5 }, { start: 4, end: Infinity }, { start: -1, end: 5 }, { start: 5, end: 5 }, { start: 4, end: 6 }, { start: '4', end: 5 }]) {
    message({ type: MOTION_PREVIEW_COMMAND, clientId: 'range', instance: id, requestId: 'invalid-range', control: { action: 'loop', range } });
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ requestId: 'invalid-range', error: 'Invalid Motion loop range.' });
  }
  player.seek(4.5); player.setLocked(true);
  message({ type: MOTION_PREVIEW_COMMAND, clientId: 'range', instance: id, requestId: 'locked-range', control: { action: 'loop', range: null } });
  expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ requestId: 'locked-range', error: 'Motion preview is locked for annotation.' });
  expect(player.setLoop(null)).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  expect(player.state()).toMatchObject({ playing: false, time: 4.5, locked: true });
  player.setLocked(false); player.play(); timeline.seek(5);
  await vi.advanceTimersByTimeAsync(34);
  expect(timeline.time()).toBe(4);
});

it('does not introduce preview range looping into standalone playback', () => {
  const { player } = boot(false);
  expect(player.setLoop({ start: 4, end: 5 })).toBe(false);
  player.replay();
  expect(player.state()).toMatchObject({ playing: true, time: 0 });
});

it('pauses audio and the timeline while hidden, blocks play while inactive and resumes when active', async () => {
  const { audio, timeline, player, activity } = boot(true);
  activity(true);
  expect(audio.paused).toBe(false);
  activity(false);
  player.play();
  await vi.advanceTimersByTimeAsync(1000);
  expect(player.state().playing).toBe(false);
  expect(timeline.paused()).toBe(true);
  expect(audio.paused).toBe(true);
  activity(true);
  expect(player.state().playing).toBe(true);
  expect(audio.paused).toBe(false);
});

it('preserves a user pause across hiding and reactivation', () => {
  const { audio, player, activity } = boot(true);
  activity(true);
  player.pause();
  activity(false);
  activity(true);
  expect(player.state().playing).toBe(false);
  expect(audio.paused).toBe(true);
});

it('does not activate on a stale document ID or a different message source', () => {
  const { audio, activity } = boot(true);
  activity(true, 'previous-document');
  activity(true, undefined, null);
  expect(audio.paused).toBe(true);
});

it('stops a late audio start after the preview was deactivated', async () => {
  let resolve!: () => void;
  const pending = new Promise<void>(r => { resolve = r; });
  const { audio, activity, simulateDelayedStart } = boot(true, pending);
  activity(true);
  expect(audio.play).toHaveBeenCalled();
  expect(vi.mocked(audio.play).mock.results[0]?.value).toBe(pending);
  activity(false);
  expect(motionWindow.__odMotionPlayer?.state().playing).toBe(false);
  simulateDelayedStart();
  resolve();
  await vi.waitFor(() => expect(audio.paused).toBe(true));
  expect(audio.paused).toBe(true);
});


it('does not seek audio for transient or oscillating visual clock drift', async () => {
  const { audio, timeline } = boot(false);
  const seek = vi.spyOn(audio, 'currentTime', 'set');
  for (const delta of [.4, -.4, .5, -.5, 0]) {
    audio.currentTime = 5;
    timeline.seek(5 + delta);
    seek.mockClear();
    await vi.advanceTimersByTimeAsync(100);
    expect(seek).not.toHaveBeenCalled();
  }
});

it('waits for seek completion and sustained drift before correcting playback', async () => {
  const { audio, timeline } = boot(false);
  timeline.seek(5);
  audio.currentTime = 4;
  let seeking = true;
  Object.defineProperty(audio, 'seeking', { get: () => seeking });
  const seek = vi.spyOn(audio, 'currentTime', 'set');
  await vi.advanceTimersByTimeAsync(2000);
  expect(seek).not.toHaveBeenCalled();
  seeking = false;
  await vi.advanceTimersByTimeAsync(700);
  expect(seek).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(150);
  expect(seek).toHaveBeenCalledTimes(1);
  expect(audio.currentTime).toBe(5);
});

it('does not restart audio synchronization for duplicate host activity', () => {
  const { audio, activity } = boot(true);
  activity(true);
  const seek = vi.spyOn(audio, 'currentTime', 'set');
  activity(true);
  activity(true);
  expect(seek).not.toHaveBeenCalled();
});

it('pauses without seeking and performs only the requested seek or replay', async () => {
  const { audio, timeline, player } = boot(false);
  await vi.advanceTimersByTimeAsync(0);
  timeline.seek(4);
  audio.currentTime = 4;
  const seek = vi.spyOn(audio, 'currentTime', 'set');
  player.pause();
  expect(audio.paused).toBe(true);
  expect(seek).not.toHaveBeenCalled();
  player.seek(8);
  expect(audio.currentTime).toBe(8);
  expect(audio.paused).toBe(true);
  expect(seek).toHaveBeenCalledTimes(1);
  seek.mockClear();
  player.replay();
  expect(audio.currentTime).toBe(0);
  expect(audio.paused).toBe(false);
  expect(seek).toHaveBeenCalledTimes(1);
});


function audioSync() {
  vi.useFakeTimers();
  const audio = document.createElement('audio');
  Object.defineProperties(audio, { readyState: { value: 4, configurable: true }, paused: { value: false }, seeking: { value: false, configurable: true } });
  const sync = window.eval(MOTION_AUDIO_SYNC_RUNTIME + ';createMotionAudioSync')(audio) as (target: number, moving: boolean, force?: boolean) => void;
  const seek = vi.spyOn(audio, 'currentTime', 'set');
  return { audio, sync, seek };
}

it('keeps sound continuous through long render stalls and corrects once after recovery', () => {
  const { audio, sync, seek } = audioSync();
  for (let n = 0; n < 8; n++) {
    vi.advanceTimersByTime(550);
    sync(.6, true);
  }
  expect(seek).not.toHaveBeenCalled();
  for (let n = 0; n < 9; n++) { vi.advanceTimersByTime(100); sync(.6, true); }
  expect(seek).toHaveBeenCalledTimes(1);
  expect(audio.currentTime).toBe(.6);
  // Another sustained offset cannot immediately cause a reverse seek.
  for (let n = 0; n < 10; n++) { vi.advanceTimersByTime(100); sync(0, true); }
  expect(seek).toHaveBeenCalledTimes(1);
});

it('retains explicit seeking while paused, before metadata, and during another seek', () => {
  const { audio, sync, seek } = audioSync();
  Object.defineProperty(audio, 'readyState', { value: 0, configurable: true });
  sync(4, false, true);
  expect(seek).not.toHaveBeenCalled();
  Object.defineProperty(audio, 'readyState', { value: 4, configurable: true });
  sync(4, false);
  expect(audio.currentTime).toBe(4);
  Object.defineProperty(audio, 'seeking', { value: true, configurable: true });
  sync(7, false, true);
  expect(audio.currentTime).toBe(7);
});


it('keeps a generating preview visual-only through reload activation, transport controls and a pending play', async () => {
  let resolve!: () => void;
  const pending = new Promise<void>(r => { resolve = r; });
  const { audio, timeline, activity, player, simulateDelayedStart } = boot(true, pending);
  activity(true, undefined, window.parent, true);
  expect(timeline.paused()).toBe(false);
  expect(audio.muted).toBe(true);
  expect(audio.paused).toBe(true);
  expect(audio.play).not.toHaveBeenCalled();
  player.setMuted(false); player.replay();
  await vi.advanceTimersByTimeAsync(100);
  expect(audio.play).not.toHaveBeenCalled();
  activity(false, undefined, window.parent, true);
  expect(timeline.paused()).toBe(true);
  activity(true, undefined, window.parent, true);
  expect(audio.paused).toBe(true);
  activity(true);
  expect(audio.play).toHaveBeenCalledTimes(1);
  activity(true, undefined, window.parent, true);
  simulateDelayedStart(); resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(audio.paused).toBe(true);
  expect(audio.muted).toBe(true);
});
