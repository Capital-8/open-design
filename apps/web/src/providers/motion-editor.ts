import type { MotionEditorDocument, MotionEditorResponse, WorkspaceCollabContext } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';

export async function requestMotionEditor(projectId: string, filePath: string, workspace?: WorkspaceCollabContext | null,
  change?: { baseRevision: string; document: MotionEditorDocument; label: string }, signal?: AbortSignal): Promise<MotionEditorResponse> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/motion/editor/${change ? 'save' : 'read'}`, {
    method: 'POST', signal,
    headers: { ...(workspace ? workspaceProjectHeaders(workspace) : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, ...change }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? result.message ?? `Save failed (${response.status})`);
  return result;
}

export async function previewMotionEditor(projectId: string, filePath: string, baseRevision: string, document: MotionEditorDocument,
  workspace?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<{ source: string }> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/motion/editor/preview`, {
    method: 'POST', signal,
    headers: { ...(workspace ? workspaceProjectHeaders(workspace) : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, baseRevision, document }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? result.message ?? `Preview failed (${response.status})`);
  return result;
}
