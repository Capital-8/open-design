// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStandaloneConversation, getStandaloneConversation, standaloneFilePreviewUrl, standaloneFileUrl, getStandaloneFilePreviewScope, uploadStandaloneFiles } from '../../src/state/standalone-conversations';
import type { WorkspaceCollabContext } from '@open-design/contracts';
const context = { workspaceId: 'workspace/1', workspaceMemberId: 'member 1', permissions: {} } as WorkspaceCollabContext;
afterEach(() => vi.unstubAllGlobals());
describe('standalone conversation transport', () => {
  it('creates a real conversation without a project payload', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ conversation: { id: 'c', projectId: null } })));
    vi.stubGlobal('fetch', fetch);
    expect(await createStandaloneConversation()).toEqual({ id: 'c', projectId: null });
    expect(fetch).toHaveBeenCalledWith('/api/conversations', expect.objectContaining({ method: 'POST', body: '{}' }));
  });
  it('preserves the server error message and code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Access denied' } }), { status: 403 })));
    await expect(getStandaloneConversation('c')).rejects.toMatchObject({ message: 'Access denied', status: 403, code: 'FORBIDDEN' });
  });
  it('requests an authorized preview scope and encodes relative paths under its bearer prefix', async () => {
    const scope = { baseUrl: '/api/conversations/c/files/preview/opaque-token/', expiresAt: Date.now() + 60_000 };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(scope))); vi.stubGlobal('fetch', fetch);
    expect(await getStandaloneFilePreviewScope('c', context)).toEqual(scope);
    expect(fetch.mock.calls[0]![1].headers['x-od-workspace-id']).toBe('workspace/1');
    expect(standaloneFilePreviewUrl(scope.baseUrl, 'site/my index.html')).toBe('/api/conversations/c/files/preview/opaque-token/site/my%20index.html');
    expect(standaloneFileUrl('c', 'asset.png', context)).toContain('workspaceMemberId=member%201');
  });
  it('uploads actual multipart files and adapts returned attachment metadata', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ files: [{ name: 'uuid.png', originalName: 'reference.png', path: 'uploads/uuid.png', size: 3 }] })));
    vi.stubGlobal('fetch', fetch);
    const file = new File(['png'], 'reference.png');
    expect(await uploadStandaloneFiles('c', [file], context)).toEqual({ uploaded: [{ name: 'reference.png', path: 'uploads/uuid.png', size: 3, kind: 'image' }], failed: [] });
    const init = fetch.mock.calls[0]![1]; expect(init.body.get('files')).toBe(file);
    expect(init.headers['content-type']).toBeUndefined(); expect(init.headers['x-od-workspace-id']).toBe('workspace/1');
  });
});
