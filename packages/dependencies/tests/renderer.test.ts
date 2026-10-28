import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRendererClient } from '../src/renderer/index.js';

describe('renderer wire protocol', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('reports readiness failures as protocol errors without returning raw parser or transport details', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ exportFormats: 'private invalid value' }))
      .mockRejectedValueOnce(new Error('private endpoint details'));
    const client = createRendererClient({ url: 'https://renderer.example', fetch: fetcher });
    await expect(client.getReady()).rejects.toMatchObject({ name: 'DependencyError', code: 'dependency_protocol_error' });
    await expect(client.getReady()).rejects.toMatchObject({ name: 'DependencyError', code: 'renderer_unavailable' });
  });

  it('retains unknown advertised formats for the adapter to interpret', async () => {
    const data = { exportFormats: ['pdf', 'future'], editablePptx: false };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(data));
    const client = createRendererClient({ url: 'https://renderer.example', fetch: fetcher });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await client.getReady()).toEqual(data);
    expect(fetcher.mock.calls[0]![0]).toBe('https://renderer.example/ready');
  });

  it('keeps request defaults and format-specific deadlines', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ exportFormats: ['pdf'], editablePptx: false }))
      .mockResolvedValueOnce(new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } }))
      .mockResolvedValueOnce(new Response(Buffer.from('000000186674797069736f6d00000000', 'hex'), { headers: { 'Content-Type': 'video/mp4' } }));
    const client = createRendererClient({ url: 'https://renderer.example', fetch: fetcher });
    await client.getReady();
    await client.renderExport({ html: 'test', format: 'pdf' });
    await client.renderExport({ html: 'test', format: 'mp4' });
    expect(timeout.mock.calls.map(call => call[0])).toEqual([2000, 35000, 310000]);
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]?.body))).toEqual({ html: 'test', format: 'pdf', deck: false, editable: false });
  });

  it('rejects invalid requests locally and invalid output as an uncertain protocol failure', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createRendererClient({ url: 'https://renderer.example', fetch: fetcher });
    await expect(client.renderExport({ html: 'test', format: 'pptx' })).rejects.toMatchObject({ code: 'invalid_render_request', uncertain: false });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(new Response('not-pdf', { headers: { 'Content-Type': 'application/pdf' } }));
    await expect(client.renderExport({ html: 'test', format: 'pdf' })).rejects.toMatchObject({ code: 'renderer_invalid_output', uncertain: true });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
