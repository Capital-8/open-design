import type {
  ProjectRecord as Project,
  ConversationRecord as Conversation,
  RunRecord as Run,
  RunRecord as RunRow,
} from "@open-design/bridge";
import { terminal } from "./model.js";
export const status = (r: RunRow) =>
  r.status === "pending"
    ? "queued"
    : r.status === "cancelling"
      ? "running"
      : r.status === "blocked"
        ? "failed"
        : r.status;
export const projectView = (p: Project) => ({
  id: p.id,
  name: p.name,
  skillId:
    (
      p.metadata_json.officialResources as
        | Array<{ type: string; id: string }>
        | undefined
    )?.find((r) => r.type === "skill")?.id ?? null,
  designSystemId:
    (
      p.metadata_json.officialResources as
        | Array<{ type: string; id: string }>
        | undefined
    )?.find((r) => r.type === "design-system")?.id ?? null,
  createdAt: Date.parse(p.created_at),
  updatedAt: Date.parse(p.created_at),
  metadata: p.metadata_json,
  workspaceId: p.legacy?.workspaceId,
  workspaceVisibility: "personal",
});
export const conversationView = (c: Conversation) => ({
  id: c.id,
  projectId: c.project_id,
  title: c.title,
  sessionMode: "chat",
  createdAt: Date.parse(c.created_at),
  updatedAt: Date.parse(c.created_at),
});
export const runView = (r: Run, projectId: string) => ({
  id: r.id,
  projectId,
  conversationId: r.conversation_id,
  assistantMessageId: r.legacy?.assistantMessageId ?? null,
  clientRequestId: r.client_request_id,
  agentId: "amr",
  status: status(r),
  createdAt: Date.parse(r.created_at),
  updatedAt: Date.parse(r.created_at),
  cancelRequested: r.cancel_requested,
  cancelOrigin: r.cancel_requested ? "user_stop" : null,
  exitCode: r.status === "succeeded" ? 0 : terminal(r.status) ? 1 : null,
  error: r.error_code,
  errorCode: r.error_code,
});
