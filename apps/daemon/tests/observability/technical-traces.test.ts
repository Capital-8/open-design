import { describe, expect, it, vi } from 'vitest';
import { createTechnicalTraces, type TraceRun } from '../../src/observability/technical-traces.js';
function setup(response: () => Promise<Response> = async () => new Response(null, { status: 200 })) {
  const batches: Record<string, any>[] = []; const warn = vi.fn();
  const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => { batches.push(JSON.parse(String(init?.body))); return response(); });
  let clock = 1000;
  const traces = createTechnicalTraces({ env: { OD_TRACE_ENDPOINT: 'http://localhost:4318/v1/traces', OD_TRACE_TOKEN: 'telemetry-only' }, fetch: request as typeof fetch, now: () => clock++, warn });
  const spans = () => batches.flatMap(batch => batch.resourceSpans[0].scopeSpans[0].spans) as Record<string, any>[];
  return { traces, spans, request, warn };
}
const attrs = (span: Record<string, any>) => Object.fromEntries(span.attributes.map((a: any) => [a.key, a.value.stringValue ?? Number(a.value.intValue)]));
describe('technical run trace boundary', () => {
  it('connects the runtime carrier to its run and ends once only at terminal', async () => {
    const { traces, spans } = setup();
    const run: TraceRun = { id: 'run-1', conversationId: 'conversation-1', agentId: 'amr', status: 'running' };
    traces.beginAttempt(run); const env = traces.runtimeEnv(run);
    expect(env.TRACEPARENT).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
    expect(env.OPEN_DESIGN_RUNTIME_GENERATION_ID).toBe(run.runtimeGenerationId);
    await traces.flush(); expect(spans().map(s => s.name)).toEqual(['open_design.prepare']);
    run.status = 'succeeded'; traces.finish(run); traces.finish(run); await traces.flush();
    const [prepare, runtime, attempt, root] = spans();
    expect(root!.name).toBe('open_design.run'); expect(root!.traceId).toBe(run.traceId);
    expect(attempt!.parentSpanId).toBe(root!.spanId); expect(prepare!.parentSpanId).toBe(attempt!.spanId); expect(runtime!.parentSpanId).toBe(attempt!.spanId);
    expect(env.TRACEPARENT).toContain(runtime!.spanId); expect(attrs(runtime!)['open_design.run_attempt']).toBe(0);
    for (const span of spans()) { expect(span.traceId).toBe(root!.traceId); expect(span.kind).toBe(1); expect(span.status.code).toBe(1); expect(BigInt(span.endTimeUnixNano)).toBeGreaterThanOrEqual(BigInt(span.startTimeUnixNano)); }
    expect(JSON.stringify(spans())).not.toContain('telemetry-only');
  });
  it('keeps retries in one trace with separate generations and a failed first attempt', async () => {
    const { traces, spans } = setup(); const run: TraceRun = { id: 'run-2', status: 'running' };
    traces.beginAttempt(run); const first = traces.runtimeEnv(run); run.retryAttemptCount = 1; traces.beginAttempt(run); const second = traces.runtimeEnv(run);
    expect(first.OPEN_DESIGN_RUNTIME_GENERATION_ID).not.toBe(second.OPEN_DESIGN_RUNTIME_GENERATION_ID);
    expect(first.TRACEPARENT!.split('-')[1]).toBe(second.TRACEPARENT!.split('-')[1]);
    run.status = 'succeeded'; traces.finish(run); await traces.flush();
    const attempts = spans().filter(s => s.name === 'open_design.run.attempt');
    expect(attempts.map(s => attrs(s)['open_design.run_attempt'])).toEqual([0, 1]); expect(attempts.map(s => s.status.code)).toEqual([2, 1]);
    expect(spans().filter(s => s.name === 'open_design.run')).toHaveLength(1);
  });
  it.each(['canceled', 'failed'])('records %s in preparation without inventing runtime work', async status => {
    const { traces, spans } = setup(); const run: TraceRun = { id: 'early', status, errorCode: 'STARTUP_FAILED' };
    traces.beginAttempt(run); traces.finish(run); await traces.flush();
    expect(spans()).toHaveLength(3); expect(spans().every(s => s.status.code === 2)).toBe(true); expect(spans().every(s => attrs(s)['open_design.status'] === status)).toBe(true);
    expect(spans().some(s => s.name === 'open_design.runtime')).toBe(false);
  });
  it('isolates network failure and HTTP rejection with bounded safe diagnostics', async () => {
    let requests = 0; const { traces, warn } = setup(async () => { if (++requests === 1) return new Response('secret upstream body', { status: 401 }); throw new Error('secret network error'); });
    const run: TraceRun = { id: 'outage', status: 'running' }; traces.beginAttempt(run); traces.runtimeEnv(run); await traces.flush();
    run.status = 'succeeded'; traces.finish(run); await expect(traces.flush()).resolves.toBeUndefined();
    expect(run.status).toBe('succeeded'); expect(warn).toHaveBeenCalledTimes(1); expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
  });
  it('visibly disables incomplete configuration without altering business identity', () => {
    const warn = vi.fn(); const request = vi.fn(); const traces = createTechnicalTraces({ env: { OD_TRACE_ENDPOINT: 'http://localhost:4318/v1/traces' }, warn, fetch: request });
    const run: TraceRun = { id: 'disabled' }; traces.beginAttempt(run); expect(traces.runtimeEnv(run)).toEqual({}); expect(run.traceId).toBeUndefined(); expect(request).not.toHaveBeenCalled(); expect(warn).toHaveBeenCalledOnce();
  });
});
