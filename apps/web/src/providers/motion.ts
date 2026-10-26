import type { MotionStructureResponse, WorkspaceCollabContext } from '@open-design/contracts';
import { workspaceProjectHeaders } from '../collab/workspace-identity';

export async function inspectMotionStructure(projectId: string, filePath: string, source: string, signal: AbortSignal, workspace?: WorkspaceCollabContext | null): Promise<MotionStructureResponse> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/motion/structure`, {
    method: 'POST', signal,
    headers: { ...(workspace ? workspaceProjectHeaders(workspace) : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, source }),
  });
  if (!response.ok) throw new Error('Motion structure unavailable');
  return response.json();
}
