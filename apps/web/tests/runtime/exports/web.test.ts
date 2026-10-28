import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exportProjectAsPdf,
  exportProjectAsMp4,
  exportProjectAsZip,
  exportProjectAsPptx,
  exportProjectImageDataUrl,
} from '../../../src/runtime/exports/web';

const download = vi.fn();
beforeEach(() => {
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() });
  vi.stubGlobal('document', {
    createElement: () => ({ href: '', download: '', click: download }),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  download.mockClear();
});

it.each([false, true])(
  'does not replace a rejected cloud ZIP with a single HTML file (history=%s)',
  async (history) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code: 'runtime_file_read_unavailable', message: 'Files unavailable' } },
          { status: 501 },
        ),
      ),
    );
    await expect(
      exportProjectAsZip({
        projectId: 'p',
        filePath: 'index.html',
        fallbackHtml: '<h1>Incomplete</h1>',
        fallbackTitle: 'Design',
        ...(history ? { versionId: 'old' } : {}),
      }),
    ).rejects.toThrow(/request failed \(501\)/);
    expect(download).not.toHaveBeenCalled();
  },
);
it('does not replace an offline cloud ZIP with an incomplete archive', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Offline');
    }),
  );
  await expect(
    exportProjectAsZip({
      projectId: 'p',
      filePath: 'index.html',
      fallbackHtml: '<h1>Incomplete</h1>',
      fallbackTitle: 'Design',
    }),
  ).rejects.toThrow('Offline');
  expect(download).not.toHaveBeenCalled();
});
it('downloads a successful cloud archive once', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response('zip bytes', { headers: { 'content-type': 'application/zip' } }),
    ),
  );
  await exportProjectAsZip({
    projectId: 'p',
    filePath: 'index.html',
    fallbackHtml: '',
    fallbackTitle: 'Design',
  });
  expect(download).toHaveBeenCalledTimes(1);
});
it.each(['pptx', 'image'] as const)(
  'keeps Runtime 501 errors semantic for cloud %s exports',
  async (format) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code: 'runtime_history_unavailable', message: 'History unavailable' } },
          { status: 501 },
        ),
      ),
    );
    const options = { projectId: 'p', fileName: 'index.html', versionId: 'old' };
    const result = await (format === 'pptx'
      ? exportProjectAsPptx(options)
      : exportProjectImageDataUrl(options));
    expect(result).toMatchObject({ ok: false, error: 'History unavailable' });
    expect(result).not.toHaveProperty('unavailable');
    expect(download).not.toHaveBeenCalled();
  },
);

it('downloads MP4 only after the authenticated export response contains MP4 bytes', async () => {
  const bytes = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0]);
  const fetcher = vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'video/mp4' } }));
  vi.stubGlobal('fetch', fetcher);
  await exportProjectAsMp4({ projectId: 'project-a', fileName: 'index.html', title: 'Motion' });
  expect(fetcher).toHaveBeenCalledWith('/api/projects/project-a/export/mp4', expect.objectContaining({
    method: 'POST', credentials: 'same-origin', body: JSON.stringify({ fileName: 'index.html', title: 'Motion' }),
  }));
  expect(download).toHaveBeenCalledTimes(1);
});
it.each([
  [422, 'application/json', JSON.stringify({ message: 'Missing soundtrack' }), 'Missing soundtrack'],
  [200, 'text/html', '<h1>Proxy error</h1>', 'Invalid MP4 response'],
  [200, 'video/mp4', 'not a video', 'Invalid MP4 file'],
] as const)('never downloads a failed or invalid MP4 (%s, %s)', async (status, mime, body, error) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers: { 'content-type': mime } })));
  await expect(exportProjectAsMp4({ projectId: 'p', fileName: 'index.html', title: 'Motion' })).rejects.toThrow(error);
  expect(download).not.toHaveBeenCalled();
});

describe('Web PDF download', () => {
  let captured: Blob | undefined;
  let filename = '';
  beforeEach(() => {
    captured = undefined; filename = '';
    vi.stubGlobal('URL', {createObjectURL: (blob: Blob) => {captured=blob;return 'blob:test';},revokeObjectURL:vi.fn()});
    vi.stubGlobal('document', {createElement: () => ({href:'',set download(v:string){filename=v;},click:vi.fn()}),body:{appendChild:vi.fn(),removeChild:vi.fn()}});
  });
  afterEach(() => {vi.unstubAllGlobals();vi.restoreAllMocks();});
  const options=()=>({deck:false,filePath:'index.html',projectId:'p',title:'设计稿',fallbackPdf:vi.fn()});
  it('downloads actual PDF bytes using the server filename without opening a print page',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('%PDF-1.7\nfixture',{headers:{'content-type':'application/pdf','content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent('设计稿.pdf')}})));
    const opts=options();
    expect(await exportProjectAsPdf(opts)).toBe('download');
    expect(filename).toBe('设计稿.pdf');
    expect(captured?.type).toBe('application/pdf');
    expect(await captured?.text()).toBe('%PDF-1.7\nfixture');
    expect(opts.fallbackPdf).not.toHaveBeenCalled();
  });
  it.each(['error','json','invalid-pdf'])('rejects %s instead of opening the blob print fallback',async(kind)=>{
    vi.stubGlobal('fetch',vi.fn(async()=>kind==='error'?new Response('failed',{status:502}):kind==='json'?Response.json({ok:true}):new Response('<html>not PDF</html>',{headers:{'content-type':'application/pdf'}})));
    const opts=options();
    await expect(exportProjectAsPdf(opts)).rejects.toThrow();
    expect(opts.fallbackPdf).not.toHaveBeenCalled();
    expect(captured).toBeUndefined();
  });
});
