import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportProjectImageDataUrl, exportProjectAsPdf, exportProjectAsPptx, exportProjectAsZip, exportProjectAsMp4 } from '../../../src/runtime/exports/desktop';
import { exportProjectAsHtml, downloadProjectArchive } from '../../../src/runtime/exports/shared';
import { workspaceContextFixture } from '../../helpers/workspace-context';

describe('exportProjectAsPdf', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([{}, { ok: 'true' }, null])('does not confirm saving from an invalid PDF acknowledgement %j', async body => {
    const fallback = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(body)));
    const result = await exportProjectAsPdf({ deck: false, fallbackPdf: fallback, filePath: 'index.html', projectId: 'proj-1', title: 'Page' });
    expect(result).toBe('fallback');
    expect(fallback).toHaveBeenCalledOnce();
  });
  it('uses the daemon desktop PDF export API before falling back to browser print', async () => {
    const fallback = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));

    const result = await exportProjectAsPdf({
      deck: true,
      fallbackPdf: fallback,
      filePath: 'deck/index.html',
      projectId: 'proj-1',
      title: 'Seed Deck',
    });

    expect(result).toBe('desktop');
    expect(fallback).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('/api/projects/proj-1/export/pdf', {
      body: JSON.stringify({ deck: true, fileName: 'deck/index.html', title: 'Seed Deck' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
  });

  it('passes versionId to the daemon desktop PDF export API', async () => {
    const fallback = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));

    const result = await exportProjectAsPdf({
      deck: false,
      fallbackPdf: fallback,
      filePath: 'index.html',
      projectId: 'proj-1',
      title: 'Landing v1',
      versionId: 'v1',
    });

    expect(result).toBe('desktop');
    expect(fallback).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('/api/projects/proj-1/export/pdf', {
      body: JSON.stringify({ deck: false, fileName: 'index.html', title: 'Landing v1', versionId: 'v1' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
  });

  it('treats a canceled desktop PDF save dialog as a silent no-op', async () => {
    const fallback = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, canceled: true }), { status: 200 })));

    const result = await exportProjectAsPdf({
      deck: true,
      fallbackPdf: fallback,
      filePath: 'deck/index.html',
      projectId: 'proj-1',
      title: 'Seed Deck',
    });

    expect(result).toBe('cancelled');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back to browser print when the desktop PDF export API is unavailable', async () => {
    const fallback = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'unavailable' } }), { status: 501 })));

    const result = await exportProjectAsPdf({
      deck: false,
      fallbackPdf: fallback,
      filePath: 'index.html',
      projectId: 'proj-1',
      title: 'Landing',
    });

    expect(result).toBe('fallback');
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});

describe('exportProjectImageDataUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('passes versionId to the daemon image export endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'desktop only' } }), { status: 501 })),
    );

    const result = await exportProjectImageDataUrl({
      projectId: 'proj 1',
      fileName: 'screens/main page.html',
      index: 2,
      deck: false,
      width: 390,
      height: 844,
      versionId: 'v1',
    });

    expect(result).toEqual({ ok: false, unavailable: true, reason: 'no-renderer' });
    expect(fetch).toHaveBeenCalledWith('/api/projects/proj%201/export/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileName: 'screens/main page.html',
        index: 2,
        deck: false,
        width: 390,
        height: 844,
        versionId: 'v1',
      }),
    });
  });

  it('omits viewport dimensions when the caller uses renderer defaults', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'desktop only' } }), { status: 501 })),
    );

    await exportProjectImageDataUrl({
      projectId: 'proj-1',
      fileName: 'index.html',
      deck: false,
    });

    expect(fetch).toHaveBeenCalledWith('/api/projects/proj-1/export/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: 'index.html', deck: false }),
    });
  });
});

describe('desktop project exports', () => {
  let capturedBlob: Blob | undefined;
  let capturedFilename: string | undefined;

  beforeEach(() => {
    capturedBlob = undefined;
    capturedFilename = undefined;
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        capturedBlob = blob;
        return 'blob:test';
      },
      revokeObjectURL: () => {},
    });
    vi.stubGlobal('document', {
      createElement: () => {
        const anchor = { href: '', click: () => {} } as { href: string; download?: string; click: () => void };
        Object.defineProperty(anchor, 'download', {
          set(value: string) {
            capturedFilename = value;
          },
          get() {
            return capturedFilename ?? '';
          },
        });
        return anchor;
      },
      body: { appendChild: () => {}, removeChild: () => {} },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('POSTs to the pptx export route and downloads the returned bytes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('PK-fake-pptx', { status: 200 })),
    );

    const res = await exportProjectAsPptx({ projectId: 'proj 1', fileName: 'decks/pitch.html' });

    expect(res.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/projects/proj%201/export/pptx', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: 'decks/pitch.html', deck: true }),
    });
    expect(capturedFilename).toBe('pitch.pptx');
    expect(await capturedBlob!.text()).toBe('PK-fake-pptx');
  });

  it('carries the project-pinned Workspace identity across every project export transport', async () => {
    const workspaceContext = workspaceContextFixture({
      workspaceId: 'workspace-a',
      workspaceMemberId: 'member-a',
    });
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/export/pdf')) {
        return Response.json({ ok: true });
      }
      if (url.endsWith('/export/image')) {
        return Response.json(
          { error: { message: 'desktop only' } },
          { status: 501 },
        );
      }
      if (url.endsWith('/export/html')) {
        return new Response('<!doctype html><p>exported</p>', { status: 200 });
      }
      return new Response('archive-or-rendered-bytes', {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream',
          'content-disposition': 'attachment; filename="export.bin"',
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await exportProjectAsHtml({
      projectId: 'project-a',
      filePath: 'index.html',
      fallbackTitle: 'HTML',
      workspaceContext,
    });
    await exportProjectAsPdf({
      deck: false,
      fallbackPdf: vi.fn(),
      filePath: 'index.html',
      projectId: 'project-a',
      title: 'PDF',
      workspaceContext,
    });
    await exportProjectAsPptx({
      projectId: 'project-a',
      fileName: 'index.html',
      workspaceContext,
    });
    await exportProjectImageDataUrl({
      projectId: 'project-a',
      fileName: 'index.html',
      workspaceContext,
    });
    await exportProjectAsZip({
      projectId: 'project-a',
      filePath: 'index.html',
      fallbackHtml: '<p>fallback</p>',
      fallbackTitle: 'ZIP',
      workspaceContext,
    });
    await downloadProjectArchive({
      projectId: 'project-a',
      fallbackTitle: 'Archive',
      workspaceContext,
    });

    expect(fetchMock).toHaveBeenCalledTimes(6);
    for (const [, init] of fetchMock.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get('x-od-workspace-id')).toBe('workspace-a');
      expect(headers.get('x-od-workspace-member-id')).toBe('member-a');
    }
  });

  it('requests editable PPTX when the caller selects native shapes and text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('PK-editable-pptx', { status: 200 })),
    );

    const res = await exportProjectAsPptx({
      projectId: 'proj 1',
      fileName: 'decks/pitch.html',
      editable: true,
    });

    expect(res.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/projects/proj%201/export/pptx', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: 'decks/pitch.html', deck: true, editable: true }),
    });
    expect(capturedFilename).toBe('pitch.pptx');
    expect(await capturedBlob!.text()).toBe('PK-editable-pptx');
  });

  it('passes versionId to the screenshot export route', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('PK-version-pptx', { status: 200 })),
    );

    const res = await exportProjectAsPptx({
      projectId: 'proj 1',
      fileName: 'decks/pitch.html',
      versionId: 'v1',
    });

    expect(res.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/projects/proj%201/export/pptx', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: 'decks/pitch.html', versionId: 'v1', deck: true }),
    });
    expect(capturedFilename).toBe('pitch.pptx');
  });

  it('honors the server UTF-8 Content-Disposition filename over the local fallback', async () => {
    // Production always returns a Content-Disposition (title/RFC-5987 based); the
    // happy-path test above only exercises the no-header fallback. This pins the
    // branch the download actually uses in the desktop runtime.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('PK-fake-pptx', {
            status: 200,
            headers: {
              'content-disposition':
                "attachment; filename=\"Caf_ Deck __.pptx\"; filename*=UTF-8''Caf%C3%A9%20Deck%20%E7%AE%80%E6%8A%A5.pptx",
            },
          }),
      ),
    );

    const res = await exportProjectAsPptx({ projectId: 'p', fileName: 'decks/pitch.html', title: 'Café Deck 简报' });

    expect(res.ok).toBe(true);
    expect(capturedFilename).toBe('Café Deck 简报.pptx');
  });

  it('routes pdf format to the raster pdf-image endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('%PDF-fake', { status: 200 })));

    await exportProjectAsPptx({ projectId: 'p', fileName: 'deck.html', format: 'pdf' });

    expect(fetch).toHaveBeenCalledWith('/api/projects/p/export/pdf-image', expect.anything());
    expect(capturedFilename).toBe('deck.pdf');
  });

  it('reports 501 (no off-screen renderer) as unavailable, not a semantic error', async () => {
    // The caller may fall back to the vector/browser PDF only on genuine
    // unavailability — so 501 must surface as `unavailable`, with no error.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'desktop only' } }), { status: 501 })),
    );

    const res = await exportProjectAsPptx({ projectId: 'p', fileName: 'deck.html' });

    expect(res).toEqual({ ok: false, unavailable: true, reason: 'no-renderer' });
  });

  it('surfaces a semantic failure (non-501) as an error, not unavailable', async () => {
    // A bad-deck 422 / renderer 502 must NOT be masked as "fall back to vector";
    // it carries the daemon message so the caller can surface it.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'this artifact is not a slide deck' } }), { status: 422 })),
    );

    const res = await exportProjectAsPptx({ projectId: 'p', fileName: 'deck.html' });

    expect(res).toEqual({ ok: false, error: 'this artifact is not a slide deck' });
  });

  it('treats a transport failure as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));

    const res = await exportProjectAsPptx({ projectId: 'p', fileName: 'deck.html' });

    expect(res).toEqual({ ok: false, unavailable: true, reason: 'unreachable' });
  });

  it('a post-response failure (renderer already produced bytes) is an error, not unavailable', async () => {
    // The 200 came back — a failure reading the body / triggering the download
    // must NOT be reported as `unavailable`, or the caller silently downgrades to
    // the lower-fidelity vector PDF instead of surfacing the failure.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        blob: async () => {
          throw new Error('corrupt response body');
        },
      })),
    );

    const res = await exportProjectAsPptx({ projectId: 'p', fileName: 'deck.html', format: 'pdf' });

    expect(res).toEqual({ ok: false, error: 'corrupt response body' });
  });

  it('downloads version ZIPs from the daemon inline HTML export endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><p>version</p>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })));

    await exportProjectAsZip({
      projectId: 'proj 1',
      filePath: 'screens/main page.html',
      fallbackHtml: '<main>fallback</main>',
      fallbackTitle: 'Main Page v1',
      versionId: 'v1',
    });

    expect(fetch).toHaveBeenCalledWith('/api/projects/proj%201/export/screens/main%20page.html?inline=1&versionId=v1');
    expect(capturedFilename).toBe('Main-Page-v1.zip');
    expect(capturedBlob?.type).toBe('application/zip');
  });
});

it('rejects unsupported MP4 without sending a request', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  try {
    await expect(exportProjectAsMp4({ projectId: 'p', fileName: 'index.html', title: 'Film' })).rejects.toThrow('unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
