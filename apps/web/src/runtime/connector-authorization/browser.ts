import type { ConnectorAuthorization } from './types';
export function createBrowserConnectorAuthorization(
  openExternalUrl: (url: string) => Promise<boolean>,
): ConnectorAuthorization {
  // Reserve the popup synchronously while the click still has user activation.
  const popup = window.open('about:blank', '_blank');
  return {
    loading: (copy) => renderConnectorAuthLoading(popup, copy),
    info: (copy) => renderConnectorAuthInfo(popup, copy),
    error: (message) => renderConnectorAuthError(popup, message),
    redirect: async (url) => {
      if (popup) openConnectorAuthRedirect(popup, url);
      else await openExternalUrl(url);
      return true;
    },
  };
}
function openConnectorAuthRedirect(authWindow: Window | null, redirectUrl: string): void {
  const parsed = new URL(redirectUrl);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    throw new Error('Invalid connector authorization URL');
  const safeUrl = parsed.href;
  if (authWindow) {
    renderConnectorAuthRedirect(authWindow, safeUrl);
    try {
      authWindow.location.replace(safeUrl);
      return;
    } catch {
      // Some embedded browsers block async popup navigation. Leave the
      // clickable fallback in the popup so the user can continue.
    }
  }
  const opened = window.open(safeUrl, '_blank');
  if (!opened) window.location.assign(safeUrl);
}

function connectorAuthPage(
  authWindow: Window,
  title: string,
  body: string,
  maxWidth: number,
): HTMLElement {
  const doc = authWindow.document;
  doc.title = title;
  const main = doc.createElement('main');
  main.style.cssText =
    "min-height:100vh;display:grid;place-items:center;margin:0;background:#0f1115;color:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
  const content = doc.createElement('div');
  content.style.cssText =
    'display:grid;gap:14px;justify-items:center;text-align:center;padding:32px;';
  const heading = doc.createElement('div');
  heading.style.cssText = 'font-size:15px;font-weight:600;';
  heading.textContent = title;
  const description = doc.createElement('div');
  description.style.cssText = `max-width:${maxWidth}px;color:rgba(246,247,251,.72);font-size:13px;line-height:1.5;`;
  description.textContent = body;
  content.append(heading, description);
  main.append(content);
  doc.body.replaceChildren(main);
  return content;
}

function renderConnectorAuthLoading(
  authWindow: Window | null,
  copy: { title: string; body: string },
): void {
  if (!authWindow) return;
  try {
    const content = connectorAuthPage(authWindow, copy.title, copy.body, 300);
    const spinner = authWindow.document.createElement('div');
    spinner.setAttribute('aria-hidden', 'true');
    spinner.style.cssText =
      'width:28px;height:28px;border-radius:999px;border:3px solid rgba(255,255,255,.22);border-top-color:#fff;animation:od-spin .8s linear infinite;';
    content.prepend(spinner);
    const style = authWindow.document.createElement('style');
    style.textContent = '@keyframes od-spin{to{transform:rotate(360deg)}}';
    content.append(style);
  } catch {
    /* Popup may be unavailable or already navigated; ignore. */
  }
}

function renderConnectorAuthInfo(
  authWindow: Window | null,
  copy: { title: string; body: string },
): void {
  if (!authWindow) return;
  try {
    connectorAuthPage(authWindow, copy.title, copy.body, 360);
  } catch {
    /* Popup may be unavailable or already navigated; ignore. */
  }
}

function renderConnectorAuthRedirect(authWindow: Window, redirectUrl: string): void {
  try {
    const content = connectorAuthPage(
      authWindow,
      'Continue authorization',
      'If this window does not redirect automatically, use the button below.',
      300,
    );
    const link = authWindow.document.createElement('a');
    link.href = redirectUrl;
    link.textContent = 'Open Composio';
    link.style.cssText =
      'display:inline-flex;align-items:center;justify-content:center;min-width:164px;border-radius:8px;padding:9px 14px;background:#df7b56;color:#fff;text-decoration:none;font-size:13px;font-weight:600;';
    content.append(link);
  } catch {
    /* Popup may already be cross-origin; navigation fallback still runs. */
  }
}

function renderConnectorAuthError(authWindow: Window | null, message: string): void {
  if (!authWindow) return;
  try {
    connectorAuthPage(authWindow, 'Connection failed', message, 360);
  } catch {
    /* Popup may be unavailable or already navigated; ignore. */
  }
}
