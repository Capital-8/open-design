import { describe, expect, it } from 'vitest';
import { DependencyError, HttpFailure } from '../src/index.js';
import { baseUrl, bytes, check, json } from '../src/internal/http.js';

describe('bounded protocol transport', () => {
  it.each(['file:///tmp/test', 'https://user:secret@example.com', 'https://example.com/?secret=x', 'https://example.com/#x'])
    ('rejects unsafe endpoint configuration: %s', value => { expect(() => baseUrl(value)).toThrow(TypeError); });

  it('retains configured path prefixes', () => {
    expect(baseUrl('https://example.com/prefix/')).toBe('https://example.com/prefix');
  });

  it('bounds body reads and releases the reader on failure', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(5)); },
      cancel() { cancelled = true; },
    });
    await expect(bytes(new Response(body), 4)).rejects.toMatchObject({ code: 'dependency_response_too_large' });
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it('normalizes malformed JSON without exposing the payload', async () => {
    const error = await json(new Response('private upstream response')).catch(error => error);
    expect(error).toBeInstanceOf(DependencyError);
    expect(error).toMatchObject({ message: 'dependency_protocol_error' });
    expect(JSON.stringify(error)).not.toContain('private upstream');
  });

  it('distinguishes rejection from uncertain writes and sanitizes upstream metadata', async () => {
    await expect(check(Response.json({ code: 'busy', request_id: 'request:1' }, { status: 503 }), true))
      .rejects.toMatchObject({ code: 'busy', status: 503, uncertain: true, requestId: 'request:1' });
    const error = await check(Response.json({ code: 'private secret', request_id: 'invalid id' }, { status: 403 }), true)
      .catch(error => error);
    expect(error).toBeInstanceOf(HttpFailure);
    expect(error).toMatchObject({ code: 'dependency_error', status: 403, uncertain: false, requestId: undefined });
  });
});
