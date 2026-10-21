import type {
  ChatMessage, ChatRunStatusResponse, CreateStandaloneConversationRequest, ProjectFile, StandaloneConversation,
  UpdateStandaloneConversationRequest, WorkspaceCollabContext, StandaloneConversationPreviewScopeResponse,
} from '@open-design/contracts';
import type { UploadProjectFilesResult } from '../providers/registry';
import { workspaceProjectHeaders, workspaceResourceUrl } from '../collab/workspace-identity';

export const STANDALONE_CONVERSATIONS_CHANGED_EVENT = 'open-design:standalone-conversations-changed';
export function notifyStandaloneConversationsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(STANDALONE_CONVERSATIONS_CHANGED_EVENT));
}
const base = '/api/conversations';
const pathFor = (id: string) => `${base}/${encodeURIComponent(id)}`;

export class StandaloneConversationError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message); this.name = 'StandaloneConversationError';
  }
}
async function request<T>(path: string, context?: WorkspaceCollabContext | null, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: {
    ...(context ? workspaceProjectHeaders(context) : {}),
    ...(init.body instanceof FormData ? {} : init.body ? { 'content-type': 'application/json' } : {}),
    ...init.headers,
  } });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body?.error;
    const message = typeof error === 'string' ? error : error?.message;
    throw new StandaloneConversationError(
      typeof message === 'string' ? message : `Request failed (${response.status})`,
      response.status, typeof error === 'object' ? error?.code ?? body?.code : body?.code,
    );
  }
  return body as T;
}
export async function listStandaloneConversations(context?: WorkspaceCollabContext | null): Promise<StandaloneConversation[]> {
  return (await request<{ conversations: StandaloneConversation[] }>(base, context)).conversations;
}
export async function createStandaloneConversation(input: CreateStandaloneConversationRequest = {}, context?: WorkspaceCollabContext | null): Promise<StandaloneConversation> {
  const result = await request<{ conversation: StandaloneConversation }>(base, context, { method: 'POST', body: JSON.stringify(input) });
  notifyStandaloneConversationsChanged(); return result.conversation;
}
export async function getStandaloneConversation(id: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<StandaloneConversation> {
  return (await request<{ conversation: StandaloneConversation }>(pathFor(id), context, { signal })).conversation;
}
export async function updateStandaloneConversation(id: string, input: UpdateStandaloneConversationRequest, context?: WorkspaceCollabContext | null): Promise<StandaloneConversation> {
  const result = await request<{ conversation: StandaloneConversation }>(pathFor(id), context, { method: 'PATCH', body: JSON.stringify(input) });
  notifyStandaloneConversationsChanged(); return result.conversation;
}
export async function renameStandaloneConversation(id: string, title: string, context?: WorkspaceCollabContext | null): Promise<StandaloneConversation> {
  return updateStandaloneConversation(id, { title }, context);
}
export async function deleteStandaloneConversation(id: string, context?: WorkspaceCollabContext | null): Promise<void> {
  await request(pathFor(id), context, { method: 'DELETE' }); notifyStandaloneConversationsChanged();
}
export async function listStandaloneMessages(id: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<ChatMessage[]> {
  return (await request<{ messages: ChatMessage[] }>(`${pathFor(id)}/messages`, context, { signal })).messages;
}
export async function listStandaloneFiles(id: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<ProjectFile[]> {
  return (await request<{ files: ProjectFile[] }>(`${pathFor(id)}/files`, context, { signal })).files;
}
export function standaloneFileUrl(id: string, file: string, context?: WorkspaceCollabContext | null): string {
  return workspaceResourceUrl(`${pathFor(id)}/files/raw?path=${encodeURIComponent(file)}`, context);
}
export async function uploadStandaloneFiles(id: string, files: File[], context?: WorkspaceCollabContext | null): Promise<UploadProjectFilesResult> {
  const form = new FormData(); for (const file of files) form.append('files', file);
  const result = await request<{ files: { name: string; path: string; size?: number; originalName?: string }[] }>(`${pathFor(id)}/upload`, context, { method: 'POST', body: form });
  return { uploaded: result.files.map((file) => ({ path: file.path, name: file.originalName ?? file.name, size: file.size,
    kind: /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(file.name) ? 'image' : 'file' })), failed: [] };
}

export async function listStandaloneActiveRuns(id: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<ChatRunStatusResponse[]> {
  return (await request<{ runs: ChatRunStatusResponse[] }>(`/api/runs?conversationId=${encodeURIComponent(id)}&status=active`, context, { signal })).runs;
}

/** Request a scoped bearer prefix; never expose workspace identity as a CORS grant. */
export async function getStandaloneFilePreviewScope(id: string, context?: WorkspaceCollabContext | null, signal?: AbortSignal): Promise<StandaloneConversationPreviewScopeResponse> {
  return request<StandaloneConversationPreviewScopeResponse>(`${pathFor(id)}/files/preview-scope`, context, { signal });
}
export function standaloneFilePreviewUrl(baseUrl: string, file: string): string {
  return `${baseUrl}${file.split('/').map(encodeURIComponent).join('/')}`;
}
