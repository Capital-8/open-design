import { describe, expect, it, vi } from 'vitest';
import { createHttpRenderAdapter } from '../src/render/index.js';
import { BridgeError, type RenderFormat } from '@open-design/bridge';

describe('HTTP rendering boundary', () => {
  it('preserves HTTP error metadata and injected transport failures as bridge errors', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ code: 'renderer_busy' }, { status: 503, headers: { 'X-Request-ID': 'render-request' } }))
      .mockRejectedValueOnce(new BridgeError('custom_transport', false, 'custom-request'));
    const adapter = createHttpRenderAdapter({ url: 'https://renderer.example/prefix/', fetch: fetcher });
    await expect(adapter.render({ html: 'hello', format: 'pdf' })).rejects.toMatchObject({ name: 'BridgeError',
      code: 'renderer_busy', uncertain: true, status: 503, requestId: 'render-request' });
    expect(fetcher.mock.calls[0]![0]).toBe('https://renderer.example/prefix/render-export');
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body)))
      .toEqual({ html: 'hello', format: 'pdf', deck: false, editable: false });
    await expect(adapter.render({ html: 'hello', format: 'pdf' })).rejects.toMatchObject({ name: 'BridgeError',
      code: 'custom_transport', uncertain: false, requestId: 'custom-request' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('distinguishes unsupported formats from an unavailable renderer', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = createHttpRenderAdapter({ url: 'https://renderer.example', fetch: fetcher });
    fetcher.mockResolvedValueOnce(Response.json({ exportFormats: ['pdf', 'future-format'], editablePptx: false }));
    expect(await adapter.getCapabilities()).toMatchObject({ available: true, formats: ['pdf'], editablePptx: false });
    fetcher.mockRejectedValueOnce(new Error('offline'));
    expect(await adapter.getCapabilities()).toEqual({ available: false, reason: 'renderer_unavailable' });
  });
  it.each([
    ['pdf', 'application/pdf', Buffer.from('%PDF-1.7')],
    ['pdf-image', 'application/pdf', Buffer.from('%PDF-1.7')],
    ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', Buffer.from([80,75,3,4,1])],
    ['image', 'image/png', Buffer.from('89504e470d0a1a0a00', 'hex')],
    ['mp4', 'video/mp4', Buffer.from('000000186674797069736f6d00000000', 'hex')],
  ] as [RenderFormat, string, Buffer][])('renders %s without persisting or naming a business artifact', async (format, mime, input) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(new Uint8Array(input), { headers: { 'Content-Type': mime } }));
    const adapter = createHttpRenderAdapter({ url: 'https://renderer.example', fetch: fetcher });
    expect(await adapter.render({ html: '<html>test</html>', format, deck: format === 'pptx' }))
      .toEqual({ bytes: new Uint8Array(input), mimeType: mime, format });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe('https://renderer.example/render-export');
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'POST', redirect: 'error' });
  });
  it('validates modes and UTF-8 input size before sending, and never treats wrong bytes as success', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = createHttpRenderAdapter({ url: 'https://renderer.example', fetch: fetcher });
    await expect(adapter.render({ html: 'x', format: 'pptx' })).rejects.toMatchObject({ code: 'invalid_render_request' });
    await expect(adapter.render({ html: '中'.repeat(800000), format: 'pdf' })).rejects.toMatchObject({ code: 'invalid_render_request' });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(new Response('not a PDF', { headers: { 'Content-Type': 'application/pdf' } }));
    await expect(adapter.render({ html: 'x', format: 'pdf' })).rejects.toMatchObject({ code: 'renderer_invalid_output' });
    fetcher.mockResolvedValueOnce(new Response('%PDF-', { headers: { 'Content-Type': 'text/plain' } }));
    await expect(adapter.render({ html: 'x', format: 'pdf' })).rejects.toMatchObject({ code: 'renderer_invalid_output' });
  });
  it('bounds output bytes and does not retry an uncertain renderer request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('connection lost'));
    const adapter = createHttpRenderAdapter({ url: 'https://renderer.example', fetch: fetcher });
    await expect(adapter.render({ html: 'x', format: 'pdf' })).rejects.toMatchObject({ code: 'renderer_unavailable', uncertain: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(20 * 1024 * 1024 + 1)); },
      cancel() { cancelled = true; },
    });
    fetcher.mockResolvedValueOnce(new Response(stream, { headers: { 'Content-Type': 'application/pdf' } }));
    await expect(adapter.render({ html: 'x', format: 'pdf' })).rejects.toMatchObject({ code: 'dependency_response_too_large' });
    expect(cancelled).toBe(true);
  });
});
