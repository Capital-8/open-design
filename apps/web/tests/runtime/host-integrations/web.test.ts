// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installMockOpenDesignHost } from '@open-design/host/testing';
import {
  pickWorkingDir,
  importFolder,
  canImportFolder,
} from '../../../src/runtime/project-folders/web';
import { createProjectDirectoryLauncher } from '../../../src/runtime/project-directory/web';
import { exportDiagnostics } from '../../../src/runtime/diagnostics-export/web';
import { createConnectorAuthorization } from '../../../src/runtime/connector-authorization/web';
import { saveExportDownload } from '../../../src/runtime/export-download/web';
import {
  readBrowserSnapshotWithRetry,
  clearBrowserData,
  focusBrowserForExtraction,
  requestBrowserArchive,
} from '../../../src/runtime/brand-browser/web';
import {
  captureHostRegionSnapshot,
  captureHostIframeSnapshot,
  saveImageExport,
} from '../../../src/runtime/exports/web';
import {
  readClientContext,
  syncWindowTheme,
  setPetVisible,
} from '../../../src/runtime/client-context/web';
import { supportsCampaigns } from '../../../src/runtime/campaign-support/web';
import {
  getLatestHostPreviewNavigationFailure,
  subscribeHostPreviewNavigationFailure,
} from '../../../src/runtime/preview-navigation/web';
import {
  deriveUpdaterModel,
  checkForUpdaterUpdate,
  subscribeToUpdaterStatus,
} from '../../../src/lib/updater/web';

let restoreHost: () => void;
const native = vi.fn();
beforeEach(() => {
  restoreHost = installMockOpenDesignHost({
    host: {
      shell: { openExternal: native, openPath: native },
      pdf: { print: native },
      capture: { page: native },
      project: { pickWorkingDir: native },
      pet: { setVisible: native },
      updater: { check: native },
    },
  });
});
afterEach(() => {
  restoreHost();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  native.mockReset();
  delete window.openDesignDesktop;
});

it('ignores native metadata and actions even if a bridge is present', async () => {
  expect(readClientContext()).toEqual({ type: 'web' });
  expect(supportsCampaigns()).toBe(false);
  syncWindowTheme('dark');
  setPetVisible(true);
  expect(await captureHostRegionSnapshot(null)).toBeNull();
  expect(await captureHostIframeSnapshot(null)).toBeNull();
  expect(await createProjectDirectoryLauncher().open('p')).toEqual({
    kind: 'web-fallback',
    ok: true,
  });
  expect(deriveUpdaterModel(null, { hostAvailable: true }).environment).toBe('web');
  expect(await checkForUpdaterUpdate()).toEqual({ ok: false, reason: 'host-unavailable' });
  subscribeToUpdaterStatus(vi.fn())();
  subscribeHostPreviewNavigationFailure(vi.fn())();
  expect(getLatestHostPreviewNavigationFailure()).toBeNull();
  expect(native).not.toHaveBeenCalled();
});

it('preserves browser-to-daemon directory selection without using host tokens', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ path: '/project' })),
  );
  expect(await pickWorkingDir()).toEqual({ ok: true, baseDir: '/project', token: null });
  const onImportFolder = vi.fn();
  expect(canImportFolder({ onImportFolder })).toBe(true);
  await importFolder({ onImportFolder, workspaceContext: () => null });
  expect(onImportFolder).toHaveBeenCalledWith('/project');
  expect(native).not.toHaveBeenCalled();
});

it('downloads diagnostics through HTTP and preserves its server filename', async () => {
  window.openDesignDesktop = { exportDiagnostics: native };
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('zip', {
          headers: { 'content-disposition': 'attachment; filename="support.zip"' },
        }),
    ),
  );
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:diag');
      static revokeObjectURL = vi.fn();
    },
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  expect(await exportDiagnostics()).toEqual({ ok: true, path: 'support.zip' });
  expect(click).toHaveBeenCalledOnce();
  expect(native).not.toHaveBeenCalled();
});

it('uses browser downloads without waiting for native completion events', async () => {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:web');
      static revokeObjectURL = vi.fn();
    },
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  expect(await saveExportDownload(new Blob(['zip']), 'archive.zip')).toBe('download');
  const save = vi.fn();
  await saveImageExport(
    { method: 'download', filename: 'image.png', save },
    new Blob(['a']),
    'png',
    'data:image/png;base64,YQ==',
  );
  expect(click).toHaveBeenCalledTimes(2);
  expect(save).not.toHaveBeenCalled();
});

it('uses a browser popup even with a host and handles popup blocking', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  const fallback = vi.fn(async () => true);
  const auth = createConnectorAuthorization(fallback);
  expect(open).toHaveBeenCalledExactlyOnceWith('about:blank', '_blank');
  await auth.redirect('https://auth.example.test');
  expect(fallback).toHaveBeenCalledExactlyOnceWith('https://auth.example.test');
  expect(native).not.toHaveBeenCalled();
});

it('does not retry or focus a native browser and reports unsupported native data clearing', async () => {
  const read = vi.fn(async () => ({ status: 'unavailable' }));
  await readBrowserSnapshotWithRetry(read);
  expect(read).toHaveBeenCalledOnce();
  const focus = vi.fn();
  await focusBrowserForExtraction('https://example.test', 'brand', focus);
  requestBrowserArchive('https://example.test', 'brand', focus);
  expect(focus).not.toHaveBeenCalled();
  expect(await clearBrowserData()).toEqual({ ok: false, reason: 'host-unavailable' });
});
