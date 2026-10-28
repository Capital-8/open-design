import type { CatalogRead } from "./db/catalog.js";
export * from "./db/catalog.js";
import { requireCapability } from "./register.js";
import type {
  AccountRecord,
  ProjectRecord,
  ConversationRecord,
  RunRecord,
  MessageRecord,
  EventRecord,
  OutboxRecord,
  OutboxKind,
  CredentialRecord,
  SessionRecord,
  AttachmentRecord,
  AttachmentSummary,
  BrowserSessionRecord,
  DraftRecord,
  DataObject,
  NewAccount,
  NewProject,
  NewConversation,
  NewRun,
  NewMessage,
} from "./db/records.js";
export * from "./db/records.js";

type Get<T> = { get(id: string): Promise<T | null> };
export interface DbRead {
  catalog: CatalogRead;
  accounts: Get<AccountRecord> & {
    byIdentity(authUserId: string): Promise<AccountRecord | null>;
  };
  projects: Get<ProjectRecord> & {
    forOwner(ownerId: string): Promise<ProjectRecord[]>;
    expiredOperations(): Promise<ProjectRecord[]>;
    activity(id: string): Promise<string | null>;
  };
  conversations: Get<ConversationRecord> & {
    forProject(projectId: string): Promise<ConversationRecord[]>;
    expiredOperations(): Promise<ConversationRecord[]>;
  };
  runs: Get<RunRecord> & {
    byRequest(
      conversationId: string,
      requestId: string,
    ): Promise<RunRecord | null>;
    byRemote(
      conversationId: string,
      remoteId: string,
    ): Promise<RunRecord | null>;
    forConversation(conversationId: string): Promise<RunRecord[]>;
    unfinished(): Promise<RunRecord[]>;
  };
  messages: {
    forConversation(conversationId: string): Promise<MessageRecord[]>;
    userForRun(runId: string): Promise<MessageRecord | null>;
  };
  events: {
    after(
      conversationId: string,
      cursor: string,
      limit: number,
    ): Promise<EventRecord[]>;
    byRuntimeSequence(
      conversationId: string,
      sequence: string,
    ): Promise<EventRecord | null>;
  };
  outbox: Get<OutboxRecord>;
  browserSessions: Get<BrowserSessionRecord>;
  sessions: Get<SessionRecord>;
  credentials: Get<CredentialRecord> & {
    authorization(
      id: string,
    ): Promise<{
      revoked: boolean;
      reason: "logout" | "provider" | null;
    } | null>;
  };
  attachments: {
    get(projectId: string, path: string): Promise<AttachmentRecord | null>;
    forProject(projectId: string): Promise<AttachmentSummary[]>;
    usage(projectId: string): Promise<{ bytes: string; count: number }>;
  };
  drafts: { forConversation(conversationId: string): Promise<DraftRecord[]> };
}
type Patch<T> = Partial<Omit<T, "id" | "created_at" | "revision">>;
/** All operations share one physical transaction and become invalid when its callback ends. */
export interface DbTransaction extends DbRead {
  accounts: DbRead["accounts"] & {
    lock(id: string): Promise<AccountRecord | null>;
    upsertIdentity(value: NewAccount): Promise<AccountRecord>;
    update(
      id: string,
      patch: Pick<Partial<AccountRecord>, "status" | "legacy_privacy">,
    ): Promise<AccountRecord>;
  };
  projects: DbRead["projects"] & {
    lock(id: string): Promise<ProjectRecord | null>;
    insert(value: NewProject): Promise<ProjectRecord | null>;
    update(
      id: string,
      patch: Patch<ProjectRecord>,
      revision?: number,
    ): Promise<ProjectRecord | null>;
    remove(id: string): Promise<void>;
  };
  conversations: DbRead["conversations"] & {
    lock(id: string): Promise<ConversationRecord | null>;
    insert(value: NewConversation): Promise<ConversationRecord | null>;
    update(
      id: string,
      patch: Patch<ConversationRecord>,
      revision?: number,
    ): Promise<ConversationRecord | null>;
    remove(id: string): Promise<void>;
  };
  runs: DbRead["runs"] & {
    lock(id: string): Promise<RunRecord | null>;
    insert(value: NewRun): Promise<RunRecord | null>;
    update(
      id: string,
      patch: Patch<RunRecord>,
      revision?: number,
    ): Promise<RunRecord | null>;
  };
  messages: DbRead["messages"] & {
    insert(value: NewMessage): Promise<MessageRecord | null>;
    linkUser(
      runId: string,
      sequence: string,
      turn: string | null,
    ): Promise<MessageRecord | null>;
    upsertRemote(
      value: NewMessage & { runtime_sequence: string },
    ): Promise<MessageRecord>;
  };
  events: DbRead["events"] & {
    append(
      conversationId: string,
      body: DataObject,
      runtimeSequence?: string,
    ): Promise<EventRecord>;
  };
  outbox: DbRead["outbox"] & {
    lock(id: string): Promise<OutboxRecord | null>;
    enqueue(runId: string, kind: OutboxKind): Promise<void>;
    claim(
      owner: string,
      token: string,
      limit: number,
      leaseMs: number,
    ): Promise<OutboxRecord[]>;
    renew(
      id: string,
      token: string,
      version: number,
      leaseMs: number,
    ): Promise<boolean>;
    finish(
      id: string,
      token: string,
      version: number,
      result: {
        done: boolean;
        attempts: number;
        availableAt: string;
        lastError: string | null;
      },
    ): Promise<boolean>;
  };
  browserSessions: DbRead["browserSessions"] & {
    insert(value: BrowserSessionRecord): Promise<void>;
    remove(cookieHash: string): Promise<void>;
  };
  sessions: DbRead["sessions"] & {
    lock(tokenHash: string): Promise<SessionRecord | null>;
    insert(value: SessionRecord): Promise<void>;
    revoke(tokenHash: string, at: string): Promise<void>;
  };
  credentials: DbRead["credentials"] & {
    lock(id: string): Promise<CredentialRecord | null>;
    insert(value: CredentialRecord): Promise<void>;
    revoke(
      id: string,
      at: string,
      reason?: "logout" | "provider",
    ): Promise<void>;
  };
  attachments: DbRead["attachments"] & {
    insert(
      value: Omit<AttachmentRecord, "created_at">,
    ): Promise<AttachmentRecord>;
    remove(projectId: string, path: string): Promise<void>;
  };
  drafts: DbRead["drafts"] & {
    put(value: Omit<DraftRecord, "created_at">): Promise<void>;
    remove(conversationId: string, id: string): Promise<void>;
  };
}
export interface Db {
  read(): DbRead;
  /** No nested transactions, implicit fallback or automatic callback retry. */
  transaction<T>(operation: (tx: DbTransaction) => Promise<T>): Promise<T>;
}
export const db: Readonly<Db> = Object.freeze({
  read(): DbRead {
    return requireCapability("db").read();
  },
  transaction<T>(operation: (tx: DbTransaction) => Promise<T>): Promise<T> {
    return requireCapability("db").transaction(operation);
  },
});
