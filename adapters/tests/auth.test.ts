import { describe, expect, it, vi } from 'vitest';
import { BridgeError } from '@open-design/bridge';
import { createVelaAuthAdapter } from '../src/auth/index.js';

const startTime = Date.parse('2026-10-27T00:00:00Z');
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function fixture() {
  let clock = startTime;
  const user = { id: 'provider-user', authUserId: 'user-1', email: 'user@example.com', name: 'User', status: 'active' };
  const getProfile = vi.fn(async (): Promise<Response> => Response.json(user));
  const getToken = vi.fn(async (): Promise<Response> => Response.json({ status: 'approved', controlKey: 'private-control-key' }));
  const created = () => Response.json({ deviceId: 'device', deviceSecret: 'private-device-secret', userCode: 'CODE',
    activationUrl: 'https://login.example/cloud/cli/activate?deviceId=device&userCode=CODE',
    expiresAt: new Date(clock + 60000).toISOString(), pollIntervalSeconds: 1 });
  const create = vi.fn(async (): Promise<Response> => created());
  const fetcher = vi.fn(async (url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/v1/me') return getProfile();
    if (path.endsWith('/token')) return getToken();
    if (path === '/api/v1/cli/device-authorizations') return create();
    throw new Error('Unexpected request');
  });
  const { adapter, credentials } = createVelaAuthAdapter({
    apiUrl: 'https://auth.example', webUrl: 'https://login.example/cloud', profile: 'test',
    clientVersion: 'test', host: 'test', fetch: fetcher, now: () => clock,
  });
  const ctx = { clientRef: 'client-1' };
  const advance = (ms: number) => { clock += ms; };
  const start = () => adapter.startLogin(ctx, { requestId: 'request-1' });
  async function login() {
    const attempt = await start(); advance(1000);
    const result = await adapter.pollLogin(ctx, attempt.attemptRef);
    if (result.status !== 'succeeded') throw new Error('Expected login success');
    return { attempt, result, context: { ...ctx, sessionRef: result.sessionRef } };
  }
  return { adapter, credentials, ctx, create, created, getProfile, getToken, fetcher, advance, start, login, user };
}
describe('Vela auth protocol boundary', () => {
  it('preserves wire payloads and error metadata without exposing upstream bodies', async () => {
    const f = fixture();
    f.create.mockResolvedValueOnce(Response.json({ code: 'provider_busy', secret: 'private-upstream' },
      { status: 503, headers: { 'X-Request-ID': 'auth-request' } }));
    await expect(f.start()).rejects.toMatchObject({ name: 'BridgeError', code: 'provider_busy',
      status: 503, uncertain: false, requestId: 'auth-request' });
    const { context } = await f.login();
    expect(f.fetcher.mock.calls[0]![1]).toMatchObject({ method: 'POST', redirect: 'error',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' } });
    expect(JSON.parse(String(f.fetcher.mock.calls[0]![1]?.body)))
      .toEqual({ cliVersion: 'test', host: 'test', profile: 'test' });
    f.getProfile.mockRejectedValueOnce(new BridgeError('injected_failure', true, 'custom-transport'));
    await expect(f.adapter.getLoginState(context)).rejects.toMatchObject({ name: 'BridgeError',
      code: 'injected_failure', uncertain: true, requestId: 'custom-transport' });
  });
  it('prioritizes a cancelled start before activation URL validation', async () => {
    const f = fixture(), pending = deferred<Response>();
    f.create.mockReturnValueOnce(pending.promise);
    const start = f.start();
    await f.adapter.logout(f.ctx);
    const created = await f.created().json() as Record<string, unknown>;
    pending.resolve(Response.json({ ...created, activationUrl: 'https://wrong.example/activate' }));
    await expect(start).rejects.toMatchObject({ code: 'login_cancelled' });
  });
  it('keeps upstream secrets private and binds login sessions to a client and principal', async () => {
    const f = fixture();
    const { result, context } = await f.login();
    expect(JSON.stringify(result)).not.toContain('private-');
    expect(await f.adapter.getLoginState(context)).toMatchObject({ status: 'signed-in', identity: { id: 'user-1' } });
    expect(await f.adapter.getLoginState({ ...context, clientRef: 'other' })).toEqual({ status: 'expired' });
    await expect(f.credentials.resolve(result.sessionRef, 'other-user')).rejects.toMatchObject({ code: 'runtime_reauthentication_required' });
    const credential = await f.credentials.resolve(result.sessionRef, 'user-1');
    expect(credential.controlKey).toBe('private-control-key');
    await f.adapter.logout(context);
    expect(f.credentials.isCurrent(result.sessionRef, credential.revision)).toBe(false);
    await expect(f.credentials.resolve(result.sessionRef, 'user-1')).rejects.toMatchObject({ code: 'runtime_reauthentication_required' });
  });
  it('does not equate network failure with logout, but expires revoked sessions', async () => {
    const f = fixture(), { context } = await f.login();
    f.getProfile.mockRejectedValueOnce(new Error('offline'));
    await expect(f.adapter.getLoginState(context)).rejects.toMatchObject({ code: 'auth_unavailable' });
    expect(await f.adapter.getLoginState(context)).toMatchObject({ status: 'signed-in' });
    f.getProfile.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await f.adapter.getLoginState(context)).toEqual({ status: 'expired' });
  });
  it('respects poll intervals and shares one in-flight token exchange', async () => {
    const f = fixture(), attempt = await f.start(), token = deferred<Response>();
    expect(await f.adapter.pollLogin(f.ctx, attempt.attemptRef)).toEqual({ status: 'pending' });
    expect(f.getToken).not.toHaveBeenCalled();
    f.advance(1000); f.getToken.mockReturnValueOnce(token.promise);
    const a = f.adapter.pollLogin(f.ctx, attempt.attemptRef);
    const b = f.adapter.pollLogin(f.ctx, attempt.attemptRef);
    expect(f.getToken).toHaveBeenCalledTimes(1);
    token.resolve(Response.json({ status: 'approved', controlKey: 'private-control-key' }));
    expect(await a).toEqual(await b);
  });
  it('does not resurrect a cancelled attempt when token exchange completes late', async () => {
    const f = fixture(), attempt = await f.start(), token = deferred<Response>();
    f.advance(1000); f.getToken.mockReturnValueOnce(token.promise);
    const pending = f.adapter.pollLogin(f.ctx, attempt.attemptRef);
    expect(await f.adapter.cancelLogin({ clientRef: 'other' }, attempt.attemptRef)).toEqual({ cancelled: false });
    expect(await f.adapter.cancelLogin(f.ctx, attempt.attemptRef)).toEqual({ cancelled: true });
    token.resolve(Response.json({ status: 'approved', controlKey: 'private-control-key' }));
    expect(await pending).toEqual({ status: 'cancelled' });
    expect(f.getProfile).not.toHaveBeenCalled();
  });
  it('retains a consumed control key across a transient profile outage without polling it twice', async () => {
    const f = fixture(), attempt = await f.start();
    f.advance(1000); f.getProfile.mockRejectedValueOnce(new Error('offline'));
    await expect(f.adapter.pollLogin(f.ctx, attempt.attemptRef)).rejects.toMatchObject({ code: 'auth_unavailable' });
    f.advance(1000);
    expect(await f.adapter.pollLogin(f.ctx, attempt.attemptRef)).toMatchObject({ status: 'succeeded' });
    expect(f.getToken).toHaveBeenCalledTimes(1);
  });
  it('logout wins over pending start and pending identity validation', async () => {
    const f = fixture(), create = deferred<Response>();
    f.create.mockReturnValueOnce(create.promise);
    const start = f.start();
    await f.adapter.logout(f.ctx);
    create.resolve(f.created());
    await expect(start).rejects.toMatchObject({ code: 'login_cancelled' });
    const { context } = await f.login(), profile = deferred<Response>();
    f.getProfile.mockReturnValueOnce(profile.promise);
    const state = f.adapter.getLoginState(context);
    await f.adapter.logout(context);
    profile.resolve(Response.json(f.user));
    expect(await state).toEqual({ status: 'expired' });
  });
  it('expires attempts and sessions and rejects a provider redirect to an unrelated site', async () => {
    const f = fixture(), attempt = await f.start();
    f.advance(60001);
    expect(await f.adapter.pollLogin(f.ctx, attempt.attemptRef)).toEqual({ status: 'expired' });
    const { context } = await f.login();
    f.advance(8 * 60 * 60 * 1000 + 1);
    expect(await f.adapter.getLoginState(context)).toEqual({ status: 'expired' });
    f.create.mockImplementationOnce(async () => {
      const data = await f.created().json() as Record<string, unknown>;
      return Response.json({ ...data, activationUrl: 'https://unrelated.example/cli/activate?deviceId=device&userCode=CODE' });
    });
    await expect(f.start()).rejects.toMatchObject({ code: 'auth_protocol_error' });
  });
});
