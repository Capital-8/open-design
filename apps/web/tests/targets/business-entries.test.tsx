// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as login from '../../src/runtime/cloud-device-login';
import * as desktopLogin from '../../src/runtime/cloud-device-login/desktop';
import * as webLogin from '../../src/runtime/cloud-device-login/web';
import * as funding from '../../src/runtime/amr-funding-feedback';
import * as desktopFunding from '../../src/runtime/amr-funding-feedback/desktop';
import * as webFunding from '../../src/runtime/amr-funding-feedback/web';
import * as exports from '../../src/runtime/exports';
import * as desktopExports from '../../src/runtime/exports/desktop';
import * as webExports from '../../src/runtime/exports/web';
import { MessageFilePreview } from '../../src/components/MessageFilePreview';
import { MessageFilePreview as DesktopPreview } from '../../src/components/MessageFilePreview/Desktop';
import { MessageFilePreview as WebPreview } from '../../src/components/MessageFilePreview/Web';
import { MotionExportButton } from '../../src/components/MotionExportButton';
import { MotionExportButton as DesktopMotion } from '../../src/components/MotionExportButton/Desktop';
import { MotionExportButton as WebMotion } from '../../src/components/MotionExportButton/Web';
import type { FundingFeedbackApi } from '../../src/runtime/amr-funding-feedback/types';
import type { CreateDeviceLogin } from '../../src/runtime/cloud-device-login/types';

const webTarget = process.env.OD_WEB_TARGET === 'web';
// Type-check both implementations even when only one target is selected.
const fundingImplementations: FundingFeedbackApi[] = [desktopFunding, webFunding];
const loginImplementations: CreateDeviceLogin[] = [desktopLogin.createCloudDeviceLogin, webLogin.createCloudDeviceLogin];
afterEach(() => { cleanup(); funding.invalidateAmrFundingFeedback(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('resolves all five real feature entries to the selected implementation', () => {
  expect(login.createCloudDeviceLogin).toBe(loginImplementations[webTarget ? 1 : 0]);
  for (const name of ['cachedHomeAmrFundingBlock', 'checkAmrFundingFeedback', 'invalidateAmrFundingFeedback'] as const) {
    expect(funding[name]).toBe(fundingImplementations[webTarget ? 1 : 0]![name]);
  }
  for (const name of ['exportProjectAsPdf', 'exportProjectAsZip', 'exportProjectAsPptx', 'exportProjectImageDataUrl', 'exportProjectScreenshotPdf', 'exportProjectAsMp4', 'canRenderProjectImage'] as const) {
    expect(exports[name]).toBe((webTarget ? webExports : desktopExports)[name]);
  }
  expect(MessageFilePreview).toBe(webTarget ? WebPreview : DesktopPreview);
  expect(MotionExportButton).toBe(webTarget ? WebMotion : DesktopMotion);
});

it('uses the selected entry to preserve server 501 errors or permit the local fallback', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'History unavailable' } }, { status: 501 })));
  const result = await exports.exportProjectImageDataUrl({ projectId: 'p', fileName: 'index.html' });
  expect(result).toEqual(webTarget
    ? { ok: false, error: 'History unavailable', status: 501 }
    : { ok: false, unavailable: true, reason: 'no-renderer' });
});

it('keeps ordinary message links and DOM attributes intact in both targets', () => {
  const onClick = vi.fn(event => event.preventDefault());
  render(<MessageFilePreview projectId="p" id="message" className="msg" data-assistant-message-id="m" onClick={onClick}>
    <a href="https://example.test">External link</a>
  </MessageFilePreview>);
  const link = screen.getByRole('link');
  fireEvent.click(link);
  expect(onClick).toHaveBeenCalledOnce();
  expect(link.parentElement?.id).toBe('message');
  expect(link.parentElement?.getAttribute('data-assistant-message-id')).toBe('m');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('does not offer MP4 for non-motion sources', () => {
  render(<MotionExportButton projectId="p" fileName="index.html" title="Page" source="<h1>Page</h1>" />);
  expect(screen.queryByRole('button')).toBeNull();
});

it('executes the selected login lifecycle through the public entry', () => {
  const popup = { opener: {}, closed: false, close: vi.fn(), location: { replace: vi.fn() } };
  const browser = { open: vi.fn(() => popup), location: { replace: vi.fn() } };
  const lifecycle = login.createCloudDeviceLogin(browser as unknown as Window);
  lifecycle.begin();
  lifecycle.activate('https://open-design.powerformer.net/cloud/cli/activate?deviceId=test&userCode=ABC123');
  expect(lifecycle.finish()).toBe(webTarget);
  if (webTarget) {
    expect(browser.open).toHaveBeenCalledExactlyOnceWith('about:blank', '_blank');
    expect(popup.opener).toBeNull();
    expect(popup.location.replace).toHaveBeenCalledOnce();
    expect(popup.close).toHaveBeenCalledOnce();
    expect(browser.location.replace).toHaveBeenCalledExactlyOnceWith('/');
  } else {
    expect(browser.open).not.toHaveBeenCalled();
    expect(browser.location.replace).not.toHaveBeenCalled();
  }
});

it('executes the selected funding policy, including network and cache effects', async () => {
  const scope = { workspaceType: 'personal' as const, workspaceId: 'target-entry', workspaceMemberId: 'member' };
  const fetcher = vi.fn(async () => Response.json({ preflight: {
    schemaVersion: 1, ...scope, modelId: 'model', generatedAt: new Date().toISOString(),
    fundingCheck: 'insufficient', balanceUsd: '0',
  } }));
  vi.stubGlobal('fetch', fetcher);
  expect(await funding.checkAmrFundingFeedback(scope, 'model')).toBe(webTarget ? 'unknown' : 'insufficient');
  if (webTarget) {
    expect(fetcher).not.toHaveBeenCalled();
    expect(funding.cachedHomeAmrFundingBlock(scope, 'model')).toBeNull();
  } else {
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/workspace/billing/preflight?workspaceId=target-entry&modelId=model', expect.objectContaining({ cache: 'no-store' }));
    expect(funding.cachedHomeAmrFundingBlock(scope, 'model')).toMatchObject({ balanceUsd: '0', stale: false });
  }
});

it('handles the selected PDF protocol through the public export entry', async () => {
  const fetcher = vi.fn(async () => webTarget
    ? new Response('%PDF-1.7\nentry fixture', { headers: { 'content-type': 'application/pdf' } })
    : Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetcher);
  const createObjectURL = vi.fn(() => 'blob:entry');
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const fallbackPdf = vi.fn();
  const result = await exports.exportProjectAsPdf({ projectId: 'p', filePath: 'index.html', title: 'Design', deck: false, fallbackPdf });
  expect(result).toBe(webTarget ? 'download' : 'desktop');
  expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/projects/p/export/pdf', expect.objectContaining({ method: 'POST' }));
  expect(fallbackPdf).not.toHaveBeenCalled();
  expect(click).toHaveBeenCalledTimes(webTarget ? 1 : 0);
  if (webTarget) expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'application/pdf' }));
  else expect(createObjectURL).not.toHaveBeenCalled();
});
