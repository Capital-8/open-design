import { DependencyError, HttpFailure } from '../error.js';

export function baseUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new TypeError('Expected a configured HTTP(S) endpoint without credentials, query or fragment');
  }
  return url.toString().replace(/\/$/, '');
}
export function safeCode(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[a-z_]{1,80}$/.test(value) ? value : fallback;
}
export async function bytes(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) throw new DependencyError('dependency_protocol_error');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) throw new DependencyError('dependency_response_too_large');
      chunks.push(next.value);
    }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export async function json(response: Response, limit = 4 * 1024 * 1024): Promise<unknown> {
  try { return JSON.parse(new TextDecoder().decode(await bytes(response, limit))) as unknown; }
  catch (error) {
    if (error instanceof DependencyError) throw error;
    throw new DependencyError('dependency_protocol_error');
  }
}
export async function check(response: Response, mutation = false): Promise<void> {
  if (response.ok) return;
  const payload = await json(response, 65536).catch(() => null);
  const body = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown> : {};
  const requestId = response.headers.get('X-Request-ID') ?? body.request_id;
  throw new HttpFailure(
    response.status,
    safeCode(response.headers.get('X-Error-Code') ?? body.code, 'dependency_error'),
    mutation && response.status >= 500,
    typeof requestId === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(requestId) ? requestId : undefined,
  );
}
