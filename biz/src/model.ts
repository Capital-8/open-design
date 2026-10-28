import type {
  ProjectRecord,
  ConversationRecord,
  RunRecord,
  MessageRecord,
} from "@open-design/bridge";
import type {
  Project,
  Conversation,
  Run,
  Message,
} from "@open-design/contracts/cloud/api";
export const projectDTO = (r: ProjectRecord): Project => ({
  id: r.id,
  name: r.name,
  creationStatus: r.creation_status,
  creationError: r.creation_error,
  activeRunId: r.active_run_id,
  editState: r.edit_state,
  createdAt: r.created_at,
});
export const conversationDTO = (r: ConversationRecord): Conversation => ({
  id: r.id,
  projectId: r.project_id,
  creationStatus: r.creation_status,
  creationError: r.creation_error,
  createdAt: r.created_at,
});
export const runDTO = (r: RunRecord): Run => ({
  id: r.id,
  conversationId: r.conversation_id,
  clientRequestId: r.client_request_id,
  status: r.status,
  submission: r.submission,
  cancelRequested: r.cancel_requested,
  cancelConfirmed: r.cancel_confirmed,
  files: r.files,
  cleanup: r.cleanup,
  errorCode: r.error_code,
  createdAt: r.created_at,
});
export const messageDTO = (r: MessageRecord): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  runId: r.run_id,
  role: r.role,
  content: r.content,
  complete: r.complete,
  turn: r.turn,
  calls: r.calls,
  toolCallId: r.tool_call_id,
  createdAt: r.created_at,
});
export const terminal = (status: string) =>
  ["succeeded", "failed", "cancelled"].includes(status);
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
