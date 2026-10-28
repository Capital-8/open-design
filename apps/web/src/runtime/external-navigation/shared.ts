export async function bridgeFirstPartyUrl(url: string): Promise<string | null> {
  try {
    const target = new URL(url);
    if (
      !['open-design.ai', 'www.open-design.ai', 'staging.open-design.ai'].includes(target.hostname)
    )
      return null;
    const resp = await fetch('/api/attribution/bridge-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: target.toString() }),
    });
    if (!resp.ok) return null;
    const body = (await resp.json()) as { url?: unknown };
    return typeof body.url === 'string' ? body.url : null;
  } catch {
    return null;
  }
}

export async function openBrowserExternalUrl(targetUrl: string): Promise<boolean> {
  try {
    const resp = await fetch('/api/system/open-external', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl }),
    });
    if (resp.ok) {
      const json = (await resp.json().catch(() => null)) as { ok?: unknown } | null;
      if (json?.ok === true) return true;
    }
  } catch {
    // Fall through to current-tab navigation below.
  }
  try {
    window.location.assign(targetUrl);
  } catch {
    return false;
  }
  return false;
}
