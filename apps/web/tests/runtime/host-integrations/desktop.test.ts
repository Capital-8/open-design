// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { installMockOpenDesignHost } from '@open-design/host/testing';
import {
  pickWorkingDir,
  canImportFolder,
  importFolder,
} from '../../../src/runtime/project-folders/desktop';
import { createProjectDirectoryLauncher } from '../../../src/runtime/project-directory/desktop';
import { exportDiagnostics } from '../../../src/runtime/diagnostics-export/desktop';
import { createConnectorAuthorization } from '../../../src/runtime/connector-authorization/desktop';
import { openExternalUrl } from '../../../src/runtime/external-navigation/desktop';
import { saveExportDownload } from '../../../src/runtime/export-download/desktop';
import {
  readBrowserSnapshotWithRetry,
  focusBrowserForExtraction,
} from '../../../src/runtime/brand-browser/desktop';
import {
  captureHostRegionSnapshot,
  exportPreviewPdf,
  saveImageExport,
  exportAsPdf,
} from '../../../src/runtime/exports/desktop';
import { readClientContext } from '../../../src/runtime/client-context/desktop';
import { supportsCampaigns } from '../../../src/runtime/campaign-support/desktop';
import { getLatestHostPreviewNavigationFailure } from '../../../src/runtime/preview-navigation/desktop';
import type { OpenDesignHostDownloadResult } from '@open-design/host';

let restoreHost: (() => void) | undefined;
afterEach(() => {
  restoreHost?.();
  restoreHost = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.openDesignDesktop;
});

it('preserves a native directory token and never falls back after cancellation or host failure', async () => {
  const picker = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, baseDir: '/workspace', token: 'pick-token' })
    .mockResolvedValueOnce({ ok: false, canceled: true })
    .mockResolvedValueOnce({ ok: false, reason: 'missing-method' });
  restoreHost = installMockOpenDesignHost({ host: { project: { pickWorkingDir: picker } } });
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect(await pickWorkingDir()).toEqual({ ok: true, baseDir: '/workspace', token: 'pick-token' });
  expect(await pickWorkingDir()).toEqual({ ok: false, canceled: true });
  expect(await pickWorkingDir()).toMatchObject({
    ok: false,
    error: expect.stringContaining('missing-method'),
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it('uses the local daemon picker with no token in browser development', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ path: '/browser-project' })),
  );
  expect(await pickWorkingDir()).toEqual({ ok: true, baseDir: '/browser-project', token: null });
  const onImportFolder = vi.fn();
  expect(canImportFolder({ onImportFolder })).toBe(true);
  await importFolder({ onImportFolder, workspaceContext: () => null });
  expect(onImportFolder).toHaveBeenCalledExactlyOnceWith('/browser-project');
});

it('passes native import responses through and respects workspace authority errors', async () => {
  const response = {
    ok: true as const,
    projectId: 'p',
    conversationId: 'c',
    entryFile: 'index.html',
  };
  const pick = vi.fn(async () => response);
  restoreHost = installMockOpenDesignHost({ host: { project: { pickAndImport: pick } } });
  const receive = vi.fn();
  await expect(
    importFolder({
      onImportFolderResponse: receive,
      workspaceContext: () => {
        throw new Error('no authority');
      },
    }),
  ).rejects.toThrow('no authority');
  expect(pick).not.toHaveBeenCalled();
  await importFolder({
    onImportFolderResponse: receive,
    skillId: 'deck',
    workspaceContext: () => null,
  });
  expect(receive).toHaveBeenCalledExactlyOnceWith(response);
});

it('opens a project directory natively and reports host failures', async () => {
  expect(await createProjectDirectoryLauncher().open('p')).toEqual({
    kind: 'web-fallback',
    ok: true,
  });
  const openPath = vi
    .fn()
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({ ok: false, reason: 'denied' });
  restoreHost = installMockOpenDesignHost({ host: { shell: { openPath } } });
  expect(await createProjectDirectoryLauncher().open('p')).toEqual({ kind: 'host', ok: true });
  expect(await createProjectDirectoryLauncher().open('p')).toEqual({ kind: 'host', ok: false });
  expect(openPath).toHaveBeenCalledWith('p');
});

it('does not turn native diagnostics cancellation into an HTTP download', async () => {
  window.openDesignDesktop = {
    exportDiagnostics: vi.fn(async () => ({ ok: false as const, cancelled: true as const })),
  };
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect(await exportDiagnostics()).toEqual({ ok: false, cancelled: true });
  expect(fetcher).not.toHaveBeenCalled();
});

it('reserves connector popups synchronously in browser development and rejects invalid redirects', async () => {
  const popup = { location: { replace: vi.fn() } } as unknown as Window;
  const open = vi.spyOn(window, 'open').mockReturnValue(popup);
  const fallback = vi.fn();
  const auth = createConnectorAuthorization(fallback);
  expect(open).toHaveBeenCalledExactlyOnceWith('about:blank', '_blank');
  await expect(auth.redirect('javascript:alert(1)')).rejects.toThrow('Invalid connector');
  await auth.redirect('https://auth.example.test/authorize');
  expect(popup.location.replace).toHaveBeenCalledWith('https://auth.example.test/authorize');
  expect(fallback).not.toHaveBeenCalled();
});

it('opens native connector authorization without a popup, surfacing rejection', async () => {
  const openExternal = vi.fn(async () => ({ ok: false as const, reason: 'denied' }));
  restoreHost = installMockOpenDesignHost({ host: { shell: { openExternal } } });
  const open = vi.spyOn(window, 'open');
  expect(await createConnectorAuthorization(vi.fn()).redirect('https://auth.example.test')).toBe(
    false,
  );
  expect(open).not.toHaveBeenCalled();
});

it('falls back to the daemon when native external navigation fails', async () => {
  restoreHost = installMockOpenDesignHost({
    host: { shell: { openExternal: async () => ({ ok: false, reason: 'failed' }) } },
  });
  const fetcher = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetcher);
  expect(await openExternalUrl('https://docs.example.test')).toBe(true);
  expect(fetcher).toHaveBeenCalledWith(
    '/api/system/open-external',
    expect.objectContaining({ method: 'POST' }),
  );
});

it.each(['completed', 'cancelled', 'interrupted'] as const)(
  'waits for the matching native download %s, then cleans up',
  async (state) => {
    let listener: ((result: OpenDesignHostDownloadResult) => void) | undefined;
    const unsubscribe = vi.fn();
    restoreHost = installMockOpenDesignHost({
      host: {
        downloads: {
          subscribe: (fn) => {
            listener = fn;
            return unsubscribe;
          },
        },
      },
    });
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = vi.fn(() => 'blob:ours');
        static revokeObjectURL = vi.fn();
      },
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const pending = saveExportDownload(new Blob(['pdf']), 'file.pdf');
    listener!({ url: 'blob:other', state: 'completed' });
    expect(unsubscribe).not.toHaveBeenCalled();
    const assertion =
      state === 'interrupted'
        ? expect(pending).rejects.toThrow('interrupted')
        : expect(pending).resolves.toBe(state === 'completed' ? 'desktop' : 'cancelled');
    listener!({ url: 'blob:ours', state });
    await assertion;
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:ours');
  },
);

it('returns null for unavailable capture and uses the native clip when present', async () => {
  const rect = { left: -3, top: 4.4, width: 100.4, height: 20.6 };
  expect(await captureHostRegionSnapshot(rect)).toBeNull();
  const page = vi.fn(async () => ({
    ok: true as const,
    dataUrl: 'data:image/png;base64,YQ==',
    w: 100,
    h: 21,
  }));
  restoreHost = installMockOpenDesignHost({ host: { capture: { page } } });
  expect(await captureHostRegionSnapshot(rect)).toMatchObject({ w: 100, h: 21 });
  expect(page).toHaveBeenCalledWith({ clip: { x: 0, y: 4, width: 100, height: 21 } });
});

it('surfaces semantic screenshot PDF failures without downgrading to vector print', async () => {
  restoreHost = installMockOpenDesignHost();
  const fetcher = vi.fn(async () =>
    Response.json({ error: { message: 'unreadable deck' } }, { status: 502 }),
  );
  vi.stubGlobal('fetch', fetcher);
  const fallbackPdf = vi.fn();
  await expect(
    exportPreviewPdf({
      projectId: 'p',
      filePath: 'deck.html',
      title: 'Deck',
      deck: true,
      versionId: 'v1',
      fallbackPdf,
    }),
  ).rejects.toThrow('unreadable deck');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toMatchObject({
    versionId: 'v1',
    deck: true,
  });
  expect(fallbackPdf).not.toHaveBeenCalled();
});

it('falls back only when the screenshot renderer is unavailable, preserving native cancellation', async () => {
  restoreHost = installMockOpenDesignHost();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response('', { status: 501 }))
    .mockResolvedValueOnce(Response.json({ ok: true, canceled: true }));
  vi.stubGlobal('fetch', fetcher);
  const fallbackPdf = vi.fn();
  expect(
    await exportPreviewPdf({
      projectId: 'p',
      filePath: 'index.html',
      title: 'Page',
      deck: false,
      fallbackPdf,
    }),
  ).toBe('cancelled');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fallbackPdf).not.toHaveBeenCalled();
});

it('skips offscreen PDF in browser development and preserves the browser fallback', async () => {
  const fetcher = vi.fn(async () => new Response('', { status: 501 }));
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const fallbackPdf = vi.fn();
  expect(
    await exportPreviewPdf({
      projectId: 'p',
      filePath: 'index.html',
      title: 'Page',
      deck: false,
      fallbackPdf,
    }),
  ).toBe('fallback');
  expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/projects/p/export/pdf', expect.anything());
  expect(fallbackPdf).toHaveBeenCalledOnce();
});

it('uses a direct PNG URL in browser development and the save result with a host', async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const save = vi.fn(async () => 'cancelled' as const);
  const target = { method: 'download' as const, filename: 'image.png', save };
  const blob = new Blob(['a']);
  await saveImageExport(target, blob, 'png', 'data:image/png;base64,YQ==');
  expect(click).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  restoreHost = installMockOpenDesignHost();
  expect(await saveImageExport(target, blob, 'png', 'data:image/png;base64,YQ==')).toBe(
    'cancelled',
  );
  expect(save).toHaveBeenCalledExactlyOnceWith(blob);
});

it('retries native browser registration races but avoids delays without a host', async () => {
  const read = vi.fn(async (_timeout: number) => ({ status: 'unavailable' }));
  await readBrowserSnapshotWithRetry(read);
  expect(read).toHaveBeenCalledTimes(1);
  const focus = vi.fn();
  await focusBrowserForExtraction('https://example.test', 'brand', focus);
  expect(focus).not.toHaveBeenCalled();
  restoreHost = installMockOpenDesignHost();
  vi.useFakeTimers();
  read.mockClear();
  read.mockResolvedValueOnce({ status: 'unavailable' }).mockResolvedValueOnce({ status: 'ready' });
  const pending = readBrowserSnapshotWithRetry(read);
  await vi.runAllTimersAsync();
  expect(await pending).toEqual({ status: 'ready' });
  expect(read.mock.calls).toEqual([[8000], [3000]]);
});

it('reports real client context and gates campaigns in browser development', () => {
  expect(readClientContext()).toEqual({ type: 'web' });
  expect(supportsCampaigns()).toBe(false);
  restoreHost = installMockOpenDesignHost({
    host: { client: { platform: 'darwin', osLocale: 'zh-CN' } },
  });
  expect(readClientContext()).toMatchObject({
    type: 'desktop',
    platform: 'darwin',
    osLocale: 'zh-CN',
  });
  expect(supportsCampaigns()).toBe(true);
  expect(getLatestHostPreviewNavigationFailure()).toBeNull();
});
