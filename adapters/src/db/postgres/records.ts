import {
  BridgeError,
  type DbRead,
  type DbTransaction,
} from "@open-design/bridge";
import type { Sql } from "./transaction.js";

function record(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return value.map(record);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, record(item)]),
    );
  return value;
}
function parameter(value: unknown): unknown {
  if (value instanceof Uint8Array) return Buffer.from(value);
  return value !== null && typeof value === "object"
    ? JSON.stringify(value)
    : value;
}
const columns = {
  projects:
    "id owner_id name metadata_json legacy runtime_id runtime_project_id workspace_id creation_status creation_error upstream_request_id active_run_id edit_state operation_owner operation_expires_at",
  conversations:
    "id project_id title legacy runtime_session_id creation_status creation_error upstream_request_id runtime_cursor event_sequence operation_owner operation_expires_at",
  runs: "id conversation_id client_request_id input input_hash legacy runtime_run_id submission cancel_requested cancel_confirmed status files cleanup error_code upstream_request_id principal_id workspace_id credential_ref provider_environment authorization_state",
  messages:
    "id conversation_id run_id role content complete runtime_sequence turn calls tool_call_id",
  project_attachments: "id project_id path original_name mime content sha256",
  cloud_credentials:
    "id principal_id provider_actor_id environment ciphertext key_version revocation_reason expires_at revoked_at revision",
  cloud_sessions:
    "token_hash client_ref principal_id credential_ref expires_at revoked_at revision",
} as const;
type Table = keyof typeof columns;

/** SQL interpolation is confined to closed, internal table/column declarations. */
function queries(sql: Sql) {
  const all = async <T>(text: string, values: unknown[] = []): Promise<T[]> =>
    (await sql(text, values)).rows.map((row) => record(row) as T);
  const one = async <T>(
    text: string,
    values: unknown[] = [],
  ): Promise<T | null> => (await all<T>(text, values))[0] ?? null;
  const get =
    <T>(table: string, key = "id", lock = false) =>
    (id: string) =>
      one<T>(
        `SELECT * FROM ${table} WHERE ${key}=$1${lock ? " FOR UPDATE" : ""}`,
        [id],
      );
  async function insert<T>(table: Table, value: object): Promise<T | null> {
    const fields = Object.entries(value).filter(
      ([, value]) => value !== undefined,
    );
    if (
      !fields.length ||
      fields.some(([key]) => !columns[table].split(" ").includes(key))
    )
      throw new BridgeError("db_invalid_record");
    return one<T>(
      `INSERT INTO ${table}(${fields.map(([key]) => key).join(",")}) VALUES(${fields.map((_, i) => "$" + (i + 1)).join(",")}) ON CONFLICT DO NOTHING RETURNING *`,
      fields.map(([, value]) => parameter(value)),
    );
  }
  async function update<T>(
    table: "projects" | "conversations" | "runs",
    id: string,
    patch: object,
    revision?: number,
  ): Promise<T | null> {
    const fields = Object.entries(patch).filter(
      ([, value]) => value !== undefined,
    );
    if (
      !fields.length ||
      fields.some(
        ([key]) => key === "id" || !columns[table].split(" ").includes(key),
      )
    )
      throw new BridgeError("db_invalid_record");
    const values: unknown[] = [
      id,
      ...fields.map(([, value]) => parameter(value)),
    ];
    if (revision !== undefined) values.push(revision);
    return one<T>(
      `UPDATE ${table} SET ${fields.map(([key], i) => key + "=$" + (i + 2)).join(",")}, revision=revision+1 WHERE id=$1${revision === undefined ? "" : " AND revision=$" + values.length} RETURNING *`,
      values,
    );
  }
  return { all, one, get, insert, update };
}
export function readRecords(sql: Sql): DbRead {
  const q = queries(sql);
  return {
    catalog: {
      officialMetadata: async () => {
        throw new BridgeError("catalog_unavailable");
      },
      digest: async () => {
        throw new BridgeError("catalog_unavailable");
      },
      list: async () => {
        throw new BridgeError("catalog_unavailable");
      },
      get: async () => {
        throw new BridgeError("catalog_unavailable");
      },
      files: async () => {
        throw new BridgeError("catalog_unavailable");
      },
    },
    accounts: {
      get: q.get("app_users"),
      byIdentity: (id) =>
        q.one("SELECT * FROM app_users WHERE auth_user_id=$1", [id]),
    },
    projects: {
      async activity(id: string) {
        const value = await sql(
          "SELECT max(e.created_at) AS time FROM events e JOIN conversations c ON c.id=e.conversation_id WHERE c.project_id=$1",
          [id],
        );
        return value.rows[0]?.time
          ? new Date(value.rows[0].time as string).toISOString()
          : null;
      },
      get: q.get("projects"),
      forOwner: (id) =>
        q.all(
          "SELECT * FROM projects WHERE owner_id=$1 ORDER BY created_at,id",
          [id],
        ),
      expiredOperations: () =>
        q.all(
          "SELECT * FROM projects WHERE (creation_status='provisioning' OR edit_state='editing') AND (operation_expires_at IS NULL OR operation_expires_at<clock_timestamp()) ORDER BY id",
        ),
    },
    conversations: {
      get: q.get("conversations"),
      forProject: (id) =>
        q.all(
          "SELECT * FROM conversations WHERE project_id=$1 ORDER BY created_at,id",
          [id],
        ),
      expiredOperations: () =>
        q.all(
          "SELECT * FROM conversations WHERE creation_status='provisioning' AND (operation_expires_at IS NULL OR operation_expires_at<clock_timestamp()) ORDER BY id",
        ),
    },
    runs: {
      get: q.get("runs"),
      byRequest: (id, key) =>
        q.one(
          "SELECT * FROM runs WHERE conversation_id=$1 AND client_request_id=$2",
          [id, key],
        ),
      byRemote: (id, key) =>
        q.one(
          "SELECT * FROM runs WHERE conversation_id=$1 AND runtime_run_id=$2",
          [id, key],
        ),
      forConversation: (id) =>
        q.all(
          "SELECT * FROM runs WHERE conversation_id=$1 ORDER BY created_at,id",
          [id],
        ),
      unfinished: () =>
        q.all(
          "SELECT * FROM runs WHERE status NOT IN ('succeeded','failed','cancelled') ORDER BY created_at,id",
        ),
    },
    messages: {
      forConversation: (id) =>
        q.all(
          "SELECT * FROM messages WHERE conversation_id=$1 ORDER BY created_at,runtime_sequence NULLS FIRST,id",
          [id],
        ),
      userForRun: (id) =>
        q.one("SELECT * FROM messages WHERE run_id=$1 AND role='user'", [id]),
    },
    events: {
      after: (id, cursor, limit) =>
        q.all(
          "SELECT * FROM events WHERE conversation_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3",
          [id, cursor, Math.max(1, Math.min(1000, limit))],
        ),
      byRuntimeSequence: (id, sequence) =>
        q.one(
          "SELECT * FROM events WHERE conversation_id=$1 AND runtime_sequence=$2",
          [id, sequence],
        ),
    },
    outbox: { get: q.get("outbox") },
    browserSessions: { get: q.get("cloud_browser_sessions", "cookie_hash") },
    sessions: { get: q.get("cloud_sessions", "token_hash") },
    credentials: {
      get: q.get("cloud_credentials"),
      async authorization(id: string) {
        const result = await sql(
          "SELECT revoked_at, revocation_reason FROM cloud_credentials WHERE id=$1",
          [id],
        );
        const row = result.rows[0];
        return row
          ? {
              revoked: !!row.revoked_at,
              reason: row.revocation_reason as "logout" | "provider" | null,
            }
          : null;
      },
    },
    attachments: {
      get: (id, path) =>
        q.one(
          "SELECT * FROM project_attachments WHERE project_id=$1 AND path=$2",
          [id, path],
        ),
      forProject: (id) =>
        q.all(
          "SELECT id,project_id,path,original_name,mime,sha256,created_at,octet_length(content) AS size FROM project_attachments WHERE project_id=$1 ORDER BY created_at,id",
          [id],
        ),
      usage: async (id) =>
        (await q.one<{ bytes: string; count: number }>(
          "SELECT coalesce(sum(octet_length(content)),0)::text AS bytes,count(*)::int AS count FROM project_attachments WHERE project_id=$1",
          [id],
        ))!,
    },
    drafts: {
      forConversation: (id) =>
        q.all(
          "SELECT * FROM legacy_message_drafts WHERE conversation_id=$1 ORDER BY created_at,id",
          [id],
        ),
    },
  };
}
export function transactionRecords(sql: Sql): DbTransaction {
  const read = readRecords(sql),
    q = queries(sql);
  return {
    ...read,
    accounts: {
      ...read.accounts,
      lock: q.get("app_users", "id", true),
      async upsertIdentity(value) {
        await sql(
          `INSERT INTO app_users(id,auth_user_id,email,name,image) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(auth_user_id) DO UPDATE SET email=excluded.email,name=excluded.name,image=excluded.image,updated_at=now()
          WHERE app_users.status NOT IN ('deleting','deleted')`,
          [value.id, value.auth_user_id, value.email, value.name, value.image],
        );
        return (await read.accounts.byIdentity(value.auth_user_id))!;
      },
      async update(id, patch) {
        if (patch.status !== undefined)
          await sql(
            "UPDATE app_users SET status=$2,updated_at=now() WHERE id=$1",
            [id, patch.status],
          );
        if (patch.legacy_privacy !== undefined)
          await sql(
            "UPDATE app_users SET legacy_privacy=$2::jsonb,updated_at=now() WHERE id=$1",
            [id, JSON.stringify(patch.legacy_privacy)],
          );
        const row = await read.accounts.get(id);
        if (!row) throw new BridgeError("db_not_found");
        return row;
      },
    },
    projects: {
      ...read.projects,
      lock: q.get("projects", "id", true),
      insert: (value) => q.insert("projects", value),
      update: (id, patch, revision) =>
        q.update("projects", id, patch, revision),
      async remove(id) {
        await sql("DELETE FROM projects WHERE id=$1", [id]);
      },
    },
    conversations: {
      ...read.conversations,
      lock: q.get("conversations", "id", true),
      insert: (value) => q.insert("conversations", value),
      update: (id, patch, revision) =>
        q.update("conversations", id, patch, revision),
      async remove(id) {
        await sql("DELETE FROM conversations WHERE id=$1", [id]);
      },
    },
    runs: {
      ...read.runs,
      lock: q.get("runs", "id", true),
      insert: (value) => q.insert("runs", value),
      update: (id, patch, revision) => q.update("runs", id, patch, revision),
    },
    messages: {
      ...read.messages,
      insert: (value) => q.insert("messages", value),
      linkUser: (id, sequence, turn) =>
        q.one(
          "UPDATE messages SET runtime_sequence=$2,turn=$3 WHERE run_id=$1 AND role='user' RETURNING *",
          [id, sequence, turn],
        ),
      async upsertRemote(value) {
        return (await q.one(
          `INSERT INTO messages(id,conversation_id,run_id,role,content,runtime_sequence,turn,calls,tool_call_id,complete)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,true) ON CONFLICT(conversation_id,runtime_sequence)
        DO UPDATE SET content=excluded.content,calls=excluded.calls,tool_call_id=excluded.tool_call_id
        WHERE messages.run_id=excluded.run_id AND messages.role=excluded.role RETURNING *`,
          [
            value.id,
            value.conversation_id,
            value.run_id,
            value.role,
            value.content,
            value.runtime_sequence,
            value.turn ?? null,
            JSON.stringify(value.calls ?? null),
            value.tool_call_id ?? null,
          ],
        ))!;
      },
    },
    events: {
      ...read.events,
      async append(id, body, runtimeSequence) {
        const sequence = await q.one<{ event_sequence: string }>(
          "UPDATE conversations SET event_sequence=event_sequence+1 WHERE id=$1 RETURNING event_sequence",
          [id],
        );
        if (!sequence) throw new BridgeError("db_not_found");
        return (await q.one(
          "INSERT INTO events(conversation_id,sequence,runtime_sequence,body) VALUES($1,$2,$3,$4::jsonb) RETURNING *",
          [
            id,
            sequence.event_sequence,
            runtimeSequence ?? null,
            JSON.stringify(body),
          ],
        ))!;
      },
    },
    outbox: {
      ...read.outbox,
      lock: q.get("outbox", "id", true),
      async enqueue(run, kind) {
        await sql(
          `INSERT INTO outbox(run_id,kind) VALUES($1,$2) ON CONFLICT(run_id,kind) DO UPDATE SET done=false,available_at=now(),claim_token=NULL,claimed_until=NULL,claimed_by=NULL,version=outbox.version+1,attempts=0,last_error=NULL WHERE outbox.done`,
          [run, kind],
        );
      },
      claim: (owner, token, limit, leaseMs) => {
        if (
          !owner ||
          !token ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 32 ||
          !Number.isInteger(leaseMs) ||
          leaseMs < 1000 ||
          leaseMs > 300000
        )
          throw new BridgeError("db_invalid_claim");
        return q.all(
          `UPDATE outbox SET claimed_until=clock_timestamp()+($4*interval '1 millisecond'),claim_token=$2,claimed_by=$1 WHERE id IN
          (SELECT id FROM outbox WHERE NOT done AND available_at<=clock_timestamp() AND (claimed_until IS NULL OR claimed_until<clock_timestamp()) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $3) RETURNING *`,
          [owner, token, limit, leaseMs],
        );
      },
      async renew(id, token, version, leaseMs) {
        return (
          (
            await sql(
              "UPDATE outbox SET claimed_until=clock_timestamp()+($4*interval '1 millisecond') WHERE id=$1 AND claim_token=$2 AND version=$3 AND NOT done AND claimed_until>clock_timestamp()",
              [id, token, version, leaseMs],
            )
          ).rowCount === 1
        );
      },
      async finish(id, token, version, result) {
        return (
          (
            await sql(
              `UPDATE outbox SET done=$4,attempts=$5,available_at=$6,last_error=$7,claim_token=NULL,claimed_until=NULL,claimed_by=NULL WHERE id=$1 AND claim_token=$2 AND version=$3 AND NOT done AND claimed_until>clock_timestamp()`,
              [
                id,
                token,
                version,
                result.done,
                result.attempts,
                result.availableAt,
                result.lastError,
              ],
            )
          ).rowCount === 1
        );
      },
    },
    browserSessions: {
      ...read.browserSessions,
      async insert(value) {
        await sql(
          "INSERT INTO cloud_browser_sessions(cookie_hash,session_ref,client_ref,expires_at) VALUES($1,$2,$3,$4)",
          [
            value.cookie_hash,
            value.session_ref,
            value.client_ref,
            value.expires_at,
          ],
        );
      },
      async remove(id) {
        await sql("DELETE FROM cloud_browser_sessions WHERE cookie_hash=$1", [
          id,
        ]);
      },
    },
    credentials: {
      ...read.credentials,
      lock: q.get("cloud_credentials", "id", true),
      async insert(value) {
        if (!(await q.insert("cloud_credentials", value)))
          throw new BridgeError("db_conflict");
      },
      async revoke(id, at, reason = "provider") {
        await sql(
          "UPDATE cloud_credentials SET revoked_at=coalesce(revoked_at,$2),revocation_reason=CASE WHEN revocation_reason='logout' THEN 'logout' ELSE $3 END WHERE id=$1",
          [id, at, reason],
        );
      },
    },
    sessions: {
      ...read.sessions,
      lock: q.get("cloud_sessions", "token_hash", true),
      async insert(value) {
        if (!(await q.insert("cloud_sessions", value)))
          throw new BridgeError("db_conflict");
      },
      async revoke(id, at) {
        await sql(
          "UPDATE cloud_sessions SET revoked_at=coalesce(revoked_at,$2) WHERE token_hash=$1",
          [id, at],
        );
      },
    },
    attachments: {
      ...read.attachments,
      async insert(value) {
        const row = await q.insert<
          import("@open-design/bridge").AttachmentRecord
        >("project_attachments", value);
        if (!row) throw new BridgeError("db_conflict");
        return row;
      },
      async remove(id, path) {
        await sql(
          "DELETE FROM project_attachments WHERE project_id=$1 AND path=$2",
          [id, path],
        );
      },
    },
    drafts: {
      ...read.drafts,
      async put(value) {
        await sql(
          "INSERT INTO legacy_message_drafts(conversation_id,id,content) VALUES($1,$2,$3) ON CONFLICT(conversation_id,id) DO UPDATE SET content=excluded.content",
          [value.conversation_id, value.id, value.content],
        );
      },
      async remove(id, draft) {
        await sql(
          "DELETE FROM legacy_message_drafts WHERE conversation_id=$1 AND id=$2",
          [id, draft],
        );
      },
    },
  };
}
