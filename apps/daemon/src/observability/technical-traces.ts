import { randomBytes, randomUUID } from 'node:crypto';

/** Technical timing only. Never accepts prompts, tool input/output, or credentials as attributes. */
type Attributes = Record<string, string | number>;
interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: 1;
  startTimeUnixNano: string;
  endTimeUnixNano?: string;
  attributes: { key: string; value: { stringValue: string } | { intValue: string } }[];
  status?: { code: 1 | 2; message?: string };
}
export interface TraceRun {
  id: string;
  conversationId?: string | null;
  agentId?: string | null;
  status?: string;
  errorCode?: string | null;
  traceId?: string;
  runtimeGenerationId?: string | null;
  cumulativeRetryAttemptCount?: number;
  retryAttemptCount?: number;
  manualResumeAttemptCount?: number;
}
interface RunTrace { root: Span; attempt?: Span; phase?: Span; attributes: Attributes; ended: boolean }
const nanos = (ms: number): string => (BigInt(Math.floor(ms)) * 1_000_000n).toString();
const safeCode = (value: unknown): string => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,96}$/.test(value) ? value : 'execution_failed';
const attributes = (values: Attributes): Span['attributes'] => Object.entries(values).map(([key, value]) => ({ key, value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: value } }));

/** Bounded, best-effort OTLP delivery: no retry amplification and no dependency on business completion. */
export function createTechnicalTraces(options: {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => number;
  warn?: (message: string) => void;
} = {}) {
  const env = options.env ?? process.env;
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const warn = options.warn ?? console.warn;
  let lastWarning = -Infinity;
  const diagnostic = (reason: string): void => {
    if (now() - lastWarning < 60_000) return;
    lastWarning = now();
    warn(`[od.trace] ${reason}`);
  };
  let endpoint: string | undefined;
  const token = env.OD_TRACE_TOKEN?.trim();
  if (env.OD_TRACE_ENDPOINT || token) {
    try {
      const url = new URL(env.OD_TRACE_ENDPOINT ?? '');
      if (!token || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('invalid trace configuration');
      endpoint = url.href;
    } catch { diagnostic('disabled: invalid endpoint/token configuration'); }
  }
  const states = new WeakMap<TraceRun, RunTrace>();
  const queue: Span[] = [];
  let sending: Promise<void> | undefined;
  let scheduled = false;
  const drain = async (): Promise<void> => {
    while (queue.length) {
      const batch = queue.splice(0, 64);
      try {
        const response = await request(endpoint!, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ resourceSpans: [{ resource: { attributes: attributes({ 'service.name': 'open-design-daemon' }) }, scopeSpans: [{ scope: { name: 'open-design.technical-traces', version: '1' }, spans: batch }] }] }),
          signal: AbortSignal.timeout(2_000),
        });
        // Never print the response body: a gateway error can contain credentials.
        await response.body?.cancel();
        if (!response.ok) diagnostic(`export rejected: HTTP ${response.status}`);
      } catch { diagnostic('export unavailable or timed out'); }
    }
  };
  const flush = async (): Promise<void> => {
    if (!endpoint) return;
    if (!sending) sending = drain().finally(() => { sending = undefined; });
    await sending;
    if (queue.length) await flush();
  };
  const emit = (span: Span): void => {
    if (queue.length >= 512) { diagnostic('export queue full: span dropped'); return; }
    queue.push(span);
    if (!scheduled) {
      scheduled = true;
      setImmediate(() => { scheduled = false; void flush(); });
    }
  };
  const make = (name: string, values: Attributes, parent?: Span): Span => ({
    traceId: parent?.traceId ?? randomBytes(16).toString('hex'),
    spanId: randomBytes(8).toString('hex'),
    ...(parent ? { parentSpanId: parent.spanId } : {}), name, kind: 1,
    startTimeUnixNano: nanos(now()), attributes: attributes(values),
  });
  const end = (span: Span | undefined, status: string, errorCode?: string | null): void => {
    if (!span || span.endTimeUnixNano) return;
    span.endTimeUnixNano = nanos(now());
    span.attributes.push(...attributes({ 'open_design.status': status, ...(errorCode ? { 'error.type': safeCode(errorCode) } : {}) }));
    span.status = status === 'succeeded' ? { code: 1 } : { code: 2, message: status === 'canceled' ? 'canceled' : 'execution failed' };
    emit(span);
  };
  return {
    /** Called on every real startup, including automatic retry and native reseed. */
    beginAttempt(run: TraceRun): void {
      if (!endpoint) return;
      let state = states.get(run);
      if (!state || state.ended) {
        // A manually resumed terminal Run is a new active execution. Business run/session IDs join it to the previous trace.
        const values: Attributes = { 'open_design.run_id': run.id, ...(run.conversationId ? { 'open_design.session_id': run.conversationId } : {}), ...(run.agentId ? { 'open_design.agent_id': run.agentId } : {}) };
        const root = make('open_design.run', values);
        state = { root, attributes: values, ended: false };
        states.set(run, state);
        run.traceId = root.traceId;
        console.info(`[od.trace] run=${run.id} trace_id=${root.traceId}`);
      }
      // The previous generation may still emit late child-close callbacks; its spans cannot own this attempt.
      end(state.phase, 'failed', 'attempt_replaced');
      end(state.attempt, 'failed', 'attempt_replaced');
      const attempt = [run.cumulativeRetryAttemptCount, run.retryAttemptCount, run.manualResumeAttemptCount].reduce<number>((sum, value) => sum + (Number.isFinite(value) && value! >= 0 ? Math.floor(value!) : 0), 0);
      run.runtimeGenerationId = randomUUID();
      state.attributes = { 'open_design.run_id': run.id, ...(run.conversationId ? { 'open_design.session_id': run.conversationId } : {}), 'open_design.run_attempt': attempt, 'open_design.runtime_generation_id': run.runtimeGenerationId };
      state.attempt = make('open_design.run.attempt', state.attributes, state.root);
      state.phase = make('open_design.prepare', state.attributes, state.attempt);
    },
    /** Captured immediately before process spawn; the returned environment belongs only to that generation. */
    runtimeEnv(run: TraceRun): NodeJS.ProcessEnv {
      const state = states.get(run);
      if (!state || state.ended) return {};
      end(state.phase, 'succeeded');
      state.phase = make('open_design.runtime', state.attributes, state.attempt);
      return { TRACEPARENT: `00-${state.phase.traceId}-${state.phase.spanId}-01`, TRACESTATE: '', OPEN_DESIGN_RUNTIME_GENERATION_ID: run.runtimeGenerationId!, OD_TRACE_ENDPOINT: endpoint!, OD_TRACE_TOKEN: token! };
    },
    /** Registry end is authoritative, including cancellation, startup failure and shutdown. */
    finish(run: TraceRun): void {
      const state = states.get(run);
      if (!state || state.ended) return;
      state.ended = true;
      const status = run.status === 'succeeded' ? 'succeeded' : run.status === 'canceled' ? 'canceled' : 'failed';
      end(state.phase, status, run.errorCode);
      end(state.attempt, status, run.errorCode);
      end(state.root, status, run.errorCode);
    },
    flush,
  };
}
