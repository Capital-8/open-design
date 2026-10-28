/** Business persistence records. Timestamps are UTC ISO strings; bigint cursors remain strings. */
export type DataObject = Record<string, unknown>;
export type CreationState =
  | "provisioning"
  | "ready"
  | "creation_unknown"
  | "failed";
export type RunState =
  | "pending"
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "blocked";
export interface AccountRecord {
  id: string;
  auth_user_id: string;
  email: string;
  name: string | null;
  image: string | null;
  status: string;
  legacy_privacy: DataObject | null;
  created_at: string;
  updated_at: string;
}
export interface ProjectRecord {
  id: string;
  owner_id: string;
  name: string;
  metadata_json: DataObject;
  legacy: DataObject | null;
  runtime_id: string;
  runtime_project_id: string | null;
  workspace_id: string | null;
  creation_status: CreationState;
  creation_error: string | null;
  upstream_request_id: string | null;
  active_run_id: string | null;
  edit_state: "idle" | "editing" | "unknown";
  operation_owner: string | null;
  operation_expires_at: string | null;
  revision: number;
  created_at: string;
}
export interface ConversationRecord {
  id: string;
  project_id: string;
  title: string | null;
  legacy: DataObject | null;
  runtime_session_id: string | null;
  creation_status: CreationState;
  creation_error: string | null;
  upstream_request_id: string | null;
  runtime_cursor: string;
  event_sequence: string;
  operation_owner: string | null;
  operation_expires_at: string | null;
  revision: number;
  created_at: string;
}
export interface RunRecord {
  id: string;
  conversation_id: string;
  client_request_id: string;
  input: string;
  input_hash: string;
  legacy: DataObject | null;
  runtime_run_id: string | null;
  submission: "pending" | "confirmed" | "unconfirmed" | "rejected";
  cancel_requested: boolean;
  cancel_confirmed: boolean;
  status: RunState;
  files: "saved" | "unknown" | "not_attested";
  cleanup: string | null;
  error_code: string | null;
  upstream_request_id: string | null;
  principal_id: string | null;
  workspace_id: string | null;
  credential_ref: string | null;
  provider_environment: string | null;
  authorization_state: "ready" | "waiting" | "revoked";
  revision: number;
  created_at: string;
}
export interface MessageRecord {
  id: string;
  conversation_id: string;
  run_id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  complete: boolean;
  runtime_sequence: string | null;
  turn: string | null;
  calls: { id: string; name: string; arguments: string }[] | null;
  tool_call_id: string | null;
  created_at: string;
}
export interface EventRecord {
  conversation_id: string;
  sequence: string;
  runtime_sequence: string | null;
  body: DataObject;
  created_at: string;
}
export type OutboxKind = "submit" | "cancel" | "reconcile" | "recover";
export interface OutboxRecord {
  id: string;
  run_id: string;
  kind: OutboxKind;
  attempts: number;
  available_at: string;
  claimed_until: string | null;
  claim_token: string | null;
  claimed_by: string | null;
  version: number;
  done: boolean;
  last_error: string | null;
}
/** Only the private auth store consumes these records; never expose them as HTTP/business DTOs. */
export interface CredentialRecord {
  revocation_reason?: "logout" | "provider" | null;
  id: string;
  principal_id: string;
  provider_actor_id: string;
  environment: string;
  ciphertext: string;
  key_version: string;
  expires_at: string;
  revoked_at: string | null;
  revision: string;
}
export interface SessionRecord {
  token_hash: string;
  client_ref: string;
  principal_id: string;
  credential_ref: string;
  expires_at: string;
  revoked_at: string | null;
  revision: string;
}
export interface AttachmentRecord {
  id: string;
  project_id: string;
  path: string;
  original_name: string;
  mime: string;
  content: Uint8Array;
  sha256: string;
  created_at: string;
}
export type AttachmentSummary = Omit<AttachmentRecord, "content"> & {
  size: number;
};
export interface DraftRecord {
  conversation_id: string;
  id: string;
  content: string;
  created_at: string;
}
export type NewAccount = Pick<
  AccountRecord,
  "id" | "auth_user_id" | "email" | "name" | "image"
>;
export type NewProject = Pick<
  ProjectRecord,
  "id" | "owner_id" | "name" | "runtime_id" | "creation_status"
> &
  Partial<Omit<ProjectRecord, "created_at">>;
export type NewConversation = Pick<
  ConversationRecord,
  "id" | "project_id" | "creation_status"
> &
  Partial<Omit<ConversationRecord, "created_at">>;
export type NewRun = Pick<
  RunRecord,
  "id" | "conversation_id" | "client_request_id" | "input" | "input_hash"
> &
  Partial<Omit<RunRecord, "created_at">>;
export type NewMessage = Pick<
  MessageRecord,
  "id" | "conversation_id" | "run_id" | "role" | "content"
> &
  Partial<Omit<MessageRecord, "created_at">>;

export interface BrowserSessionRecord {
  cookie_hash: string;
  session_ref: string;
  client_ref: string;
  expires_at: string;
}
