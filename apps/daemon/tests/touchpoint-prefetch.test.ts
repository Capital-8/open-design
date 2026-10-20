import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { createTouchpointPrefetch, TOUCHPOINT_PREFETCH_BACKOFF_MS, type TouchpointProxyResponse } from '../src/routes/touchpoint-prefetch.js';
const request = (locale = 'en-US') => Object.assign(new EventEmitter(), { method: 'GET', path: '/api/touchpoints/production-runtime', url: `/api/touchpoints/production-runtime?placementKey=opend.home.campaign-modal&locale=${locale}&emptyResponse=200`, headers: {}, body: undefined, query: {} });
afterEach(() => vi.useRealTimers());
it('makes one attempt, with no automatic retries, and permits a later observation only after backoff', async () => {
  vi.useFakeTimers();
  const run = vi.fn((_req, res: TouchpointProxyResponse) => res.status(503).json({ error: 'down' }));
  const prefetch = createTouchpointPrefetch(run);
  prefetch.warm('a', 'en-US');
  await vi.runAllTimersAsync();
  prefetch.warm('a', 'en-US'); expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(TOUCHPOINT_PREFETCH_BACKOFF_MS - 1);
  prefetch.warm('a', 'en-US'); expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(1); // Backoff is passive, not a retry timer.
  prefetch.warm('a', 'en-US'); expect(run).toHaveBeenCalledTimes(2);
  await vi.runAllTimersAsync(); prefetch.close();
});
it('discards a stale flight even for a UI consumer already waiting on it', async () => {
  let response!: TouchpointProxyResponse;
  const prefetch = createTouchpointPrefetch((_req, res) => { response = res; });
  prefetch.warm('a', 'en-US');
  const joined = prefetch.join('a', request());
  prefetch.reset(null);
  response.status(200).end('{"stale":true}');
  expect(await joined).toBeNull();
  prefetch.close();
});
it('does not join another locale or retain a completed authorization for later replay', async () => {
  let response!: TouchpointProxyResponse;
  const prefetch = createTouchpointPrefetch((_req, res) => { response = res; });
  prefetch.warm('a', 'en-US');
  expect(await prefetch.join('a', request('zh-CN'))).toBeNull();
  const joined = prefetch.join('a', request());
  response.status(404).end('{}');
  expect((await joined)?.status).toBe(404);
  expect(await prefetch.join('a', request())).toBeNull();
  prefetch.close();
});
it('limits a completed warm result to one handoff within ten seconds', async () => {
  vi.useFakeTimers();
  const prefetch = createTouchpointPrefetch((_req, res) => res.status(200).json({ decision: true }));
  prefetch.warm('a', 'en-US'); await vi.runAllTimersAsync();
  expect(prefetch.consumeReady('a', request())?.status).toBe(200);
  expect(prefetch.consumeReady('a', request())).toBeNull();
  prefetch.warm('b', 'en-US'); await vi.runAllTimersAsync();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(prefetch.consumeReady('b', request())).toBeNull();
  prefetch.close();
});
