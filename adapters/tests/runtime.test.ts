import { describe, expect, it, vi } from 'vitest';
import { BridgeError, type RuntimeScope } from '@open-design/bridge';
import { createAmrRuntimeAdapter } from '../src/runtime/index.js';

const initialTime = Date.parse('2026-10-27T00:00:00Z');
const scope: RuntimeScope = { principalId: 'user', workspaceId: 'workspace', credentialRef: 'session-secret' };
const session = { projectId: 'project', sessionId: 'conversation' };
const ref = { ...session, runId: 'run' };
const run = { id: 'run', project: 'project', session: 'conversation', status: 'running',
  answer: '', detail: '', key: 'key', created: new Date(initialTime).toISOString() };
function fixture(supportsRecovery = true) {
  let clock = initialTime, current = true;
  const grant = vi.fn(async (workspace: string): Promise<Response> => Response.json({
    token: 'od_grant_abc', actor: 'provider-user', workspace, expires: new Date(clock + 60000).toISOString(),
  }));
  const remote = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => Response.json(run));
  const credentials = {
    resolve: vi.fn(async (_ref: string, principal: string) => {
      if (!current || principal !== 'user') throw new BridgeError('runtime_reauthentication_required');
      return { controlKey: 'private-key', providerActorId: 'provider-user', expiresAt: clock + 3600000, revision: 'revision' };
    }),
    isCurrent: vi.fn(() => current),
  };
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (String(url).startsWith('https://auth.example')) {
      const body = JSON.parse(String(init?.body)) as { workspace: string };
      return grant(body.workspace);
    }
    return remote(String(url), init);
  });
  const adapter = createAmrRuntimeAdapter({
    url: 'https://runtime.example', authorizationApiUrl: 'https://auth.example',
    supportsRecovery, credentials, fetch: fetcher, now: () => clock,
  });
  return { adapter, grant, remote, credentials, fetcher, advance(ms: number) { clock += ms; }, logout() { current = false; } };
}
describe('AMR execution boundary', () => {
  it('stops after a second 401 and preserves the final rejection metadata', async () => {
    const f = fixture();
    f.remote.mockResolvedValueOnce(new Response(null, { status: 401 }));
    f.remote.mockResolvedValueOnce(Response.json({ code: 'access_denied' },
      { status: 401, headers: { 'X-Request-ID': 'runtime-request' } }));
    await expect(f.adapter.submitRun(scope, { session, idempotencyKey: 'key', input: 'hello' }))
      .rejects.toMatchObject({ name: 'BridgeError', code: 'access_denied', status: 401,
        uncertain: false, requestId: 'runtime-request' });
    expect(f.grant).toHaveBeenCalledTimes(2);
    expect(f.remote).toHaveBeenCalledTimes(2);
    expect(f.remote.mock.calls[0]![1]?.body).toBe(f.remote.mock.calls[1]![1]?.body);
    expect(f.remote.mock.calls[0]![1]?.signal).toBe(f.remote.mock.calls[1]![1]?.signal);
  });
  it('keeps a revoked credential from accepting a late grant', async () => {
    const f = fixture(), entered = Promise.withResolvers<void>(), pending = Promise.withResolvers<Response>();
    f.grant.mockImplementationOnce(async () => { entered.resolve(); return pending.promise; });
    const request = f.adapter.getRun(scope, ref);
    await entered.promise;
    f.logout();
    pending.resolve(Response.json({ token: 'od_grant_abc', actor: 'provider-user', workspace: 'workspace',
      expires: new Date(initialTime + 60000).toISOString() }));
    await expect(request).rejects.toMatchObject({ code: 'runtime_reauthentication_required' });
    expect(f.remote).not.toHaveBeenCalled();
  });
  it('maps malformed event payloads and credential failures to bridge errors without reconnecting', async () => {
    const f = fixture();
    f.remote.mockResolvedValueOnce(new Response('id: 2\ndata: {"run":"run","sequence":3}\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } }));
    const stream = f.adapter.streamEvents(scope, session, '0');
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({ name: 'BridgeError', code: 'runtime_protocol_error' });
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'runtime_stream_already_consumed' });
    f.logout();
    await expect(f.adapter.streamEvents(scope, session, '0')[Symbol.asyncIterator]().next())
      .rejects.toMatchObject({ code: 'runtime_reauthentication_required' });
    expect(f.remote).toHaveBeenCalledTimes(1);
  });
  it('encodes existing references and forwards prepared resources without altering them', async () => {
    const f = fixture(), reference = { projectId: 'project /?', sessionId: 'session/#' };
    f.remote.mockResolvedValueOnce(Response.json({ ...run, project: reference.projectId, session: reference.sessionId }));
    const resources = [{ type: 'skill' as const, id: 'skill-1' }];
    await f.adapter.submitRun(scope, { session: reference, idempotencyKey: 'key', input: 'hello', resources });
    expect(f.remote.mock.calls[0]![0]).toBe('https://runtime.example/v1/projects/project%20%2F%3F/sessions/session%2F%23/runs');
    expect(JSON.parse(String(f.remote.mock.calls[0]![1]?.body))).toEqual({ key: 'key', input: 'hello', resources });
  });
  it('uses existing references, forwards fixed input and exposes no resource creation or authorization methods', async () => {
    const f = fixture();
    const input = { session, idempotencyKey: 'key', input: 'prepared prompt' };
    expect(await f.adapter.submitRun(scope, input)).toMatchObject({ ref, status: 'running', idempotencyKey: 'key' });
    expect(f.remote.mock.calls[0]![0]).toBe('https://runtime.example/v1/projects/project/sessions/conversation/runs');
    expect(JSON.parse(String(f.remote.mock.calls[0]![1]?.body))).toEqual({ key: 'key', input: 'prepared prompt' });
    for (const name of ['createProject', 'createSession', 'createExecutionProject', 'createExecutionSession', 'getRuntimeAuthorization']) {
      expect(f.adapter).not.toHaveProperty(name);
    }
  });
  it('caches grants within session/workspace boundaries, refreshes near expiry, and checks revocation before reuse', async () => {
    const f = fixture();
    await f.adapter.getRun(scope, ref); await f.adapter.getRun(scope, ref);
    expect(f.grant).toHaveBeenCalledTimes(1);
    await f.adapter.getRun({ ...scope, workspaceId: 'second-workspace' }, ref);
    await f.adapter.getRun({ ...scope, credentialRef: 'second-session' }, ref);
    expect(f.grant).toHaveBeenCalledTimes(3);
    f.advance(31000);
    await f.adapter.getRun(scope, ref);
    expect(f.grant).toHaveBeenCalledTimes(4);
    f.logout();
    await expect(f.adapter.getRun(scope, ref)).rejects.toMatchObject({ code: 'runtime_reauthentication_required' });
    expect(f.remote).toHaveBeenCalledTimes(5);
  });
  it.each(['actor', 'workspace'])('rejects a mismatched grant %s before contacting runtime', async field => {
    const f = fixture();
    f.grant.mockResolvedValueOnce(Response.json({
      token: 'od_grant_abc', actor: 'provider-user', workspace: 'workspace',
      expires: new Date(initialTime + 60000).toISOString(), [field]: 'someone-else',
    }));
    await expect(f.adapter.getRun(scope, ref)).rejects.toMatchObject({ code: 'runtime_authorization_invalid' });
    expect(f.remote).not.toHaveBeenCalled();
  });
  it('refreshes once on explicit 401 and does not replay an ambiguous submission', async () => {
    const f = fixture();
    f.remote.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await f.adapter.getRun(scope, ref)).toMatchObject({ ref });
    expect(f.grant).toHaveBeenCalledTimes(2);
    expect(f.remote).toHaveBeenCalledTimes(2);
    f.remote.mockRejectedValueOnce(new Error('connection lost after write'));
    await expect(f.adapter.submitRun(scope, { session, idempotencyKey: 'key', input: 'hello' }))
      .rejects.toMatchObject({ code: 'runtime_unavailable', uncertain: true });
    expect(f.remote).toHaveBeenCalledTimes(3);
    expect(f.grant).toHaveBeenCalledTimes(2);
  });
  it('preserves uncertainty for malformed writes and rejects mismatched run/snapshot references', async () => {
    const f = fixture();
    f.remote.mockResolvedValueOnce(Response.json({ ...run, session: 'other' }));
    await expect(f.adapter.submitRun(scope, { session, idempotencyKey: 'key', input: 'hello' }))
      .rejects.toMatchObject({ code: 'runtime_protocol_error', uncertain: true });
    f.remote.mockResolvedValueOnce(Response.json({ ...run, id: 'another-run' }));
    await expect(f.adapter.getRun(scope, ref)).rejects.toMatchObject({ code: 'runtime_protocol_error' });
    f.remote.mockResolvedValueOnce(Response.json({ session: { id: 'conversation', project: 'other' }, cursor: 0 }));
    await expect(f.adapter.getSnapshot(scope, session)).rejects.toMatchObject({ code: 'runtime_protocol_error' });
    f.remote.mockResolvedValueOnce(Response.json({ session: { id: 'conversation', project: 'project' },
      cursor: 5, runs: [run], messages: [{ role: 'assistant', text: 'hello' }] }));
    expect(await f.adapter.getSnapshot(scope, session)).toMatchObject({ session, cursor: '5', runs: [{ ref }] });
  });
  it('reports cancellation as acceptance and does not invent recovery when unsupported', async () => {
    const f = fixture(false);
    expect(await f.adapter.getCapabilities()).toMatchObject({ recover: false });
    await expect(f.adapter.recoverRun(scope, ref)).rejects.toMatchObject({ code: 'runtime_recovery_unsupported' });
    expect(f.remote).not.toHaveBeenCalled();
    f.remote.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await f.adapter.cancelRun(scope, ref)).toEqual({ status: 'accepted' });
  });
  it('normalizes malformed error bodies without replaying failed writes', async () => {
    const f = fixture();
    f.remote.mockResolvedValueOnce(Response.json(null, { status: 503 }));
    await expect(f.adapter.submitRun(scope, { session, idempotencyKey: 'key', input: 'hello' }))
      .rejects.toMatchObject({ code: 'dependency_error', uncertain: true });
    expect(f.remote).toHaveBeenCalledTimes(1);
  });
  it('parses fragmented SSE, discards truncated tails and releases the subscription without cancelling the run', async () => {
    const f = fixture();
    const entry = { run: 'run', sequence: 3, time: new Date(initialTime).toISOString(), signal: { kind: 'text', text: '中' } };
    const wire = new TextEncoder().encode('id: 3\r\ndata: ' + JSON.stringify(entry) + '\r\n\r\nid: 4\ndata: {');
    f.remote.mockImplementationOnce(async (_url, init) => {
      expect(init?.headers).toMatchObject({ 'Last-Event-ID': '2', Accept: 'text/event-stream' });
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(wire.slice(0, 17)); controller.enqueue(wire.slice(17)); controller.close();
        },
      }), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const stream = f.adapter.streamEvents(scope, session, '2');
    const events = [];
    for await (const event of stream) events.push(event);
    expect(events).toEqual([{ cursor: '3', runId: 'run', kind: 'text', time: entry.time, payload: entry.signal }]);
    expect(f.remote).toHaveBeenCalledTimes(1);
    expect(f.remote.mock.calls[0]![0]).toContain('/stream');
  });
  it('close interrupts an outstanding event read without issuing a run cancellation', async () => {
    const f = fixture();
    let connected!: () => void;
    const ready = new Promise<void>(r => { connected = r; });
    f.remote.mockImplementationOnce(async (_url, init) => {
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          init!.signal!.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
          connected();
        },
      }), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const stream = f.adapter.streamEvents(scope, session, '0'), iterator = stream[Symbol.asyncIterator]();
    const next = iterator.next();
    await ready;
    stream.close();
    expect(await next).toEqual({ done: true, value: undefined });
    expect(f.remote).toHaveBeenCalledTimes(1);
    expect(f.remote.mock.calls[0]![0]).toMatch(/\/stream$/);
  });
});
