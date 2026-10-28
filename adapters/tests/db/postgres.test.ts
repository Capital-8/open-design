import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { database } from "./database.js";
import type { Db, DbTransaction } from "@open-design/bridge";
async function seed(db: Db) {
  const project = randomUUID(),
    conversation = randomUUID();
  await db.transaction(async (tx) => {
    await tx.accounts.upsertIdentity({
      id: "owner",
      auth_user_id: "owner",
      email: "test@example.com",
      name: null,
      image: null,
    });
    await tx.projects.insert({
      id: project,
      owner_id: "owner",
      name: "project",
      runtime_id: "amr:test",
      creation_status: "ready",
    });
    await tx.conversations.insert({
      id: conversation,
      project_id: project,
      creation_status: "ready",
    });
  });
  return { project, conversation };
}
it("rolls back task, message, active project, outbox and event at every failure point on one connection", async () => {
  const f = await database();
  try {
    const ids = await seed(f.db);
    for (let failureAt = 0; failureAt < 5; failureAt++) {
      const run = randomUUID();
      let step = 0;
      await expect(
        f.db.transaction(async (tx) => {
          const checked = async (result: Promise<unknown>) => {
            await result;
            if (step++ === failureAt) throw new Error("injected");
          };
          await tx.projects.lock(ids.project);
          await checked(
            tx.runs.insert({
              id: run,
              conversation_id: ids.conversation,
              client_request_id: run,
              input: "model",
              input_hash: "hash",
            }),
          );
          await checked(
            tx.messages.insert({
              id: randomUUID(),
              conversation_id: ids.conversation,
              run_id: run,
              role: "user",
              content: "original",
            }),
          );
          await checked(
            tx.projects.update(ids.project, { active_run_id: run }),
          );
          await checked(tx.outbox.enqueue(run, "submit"));
          await checked(
            tx.events.append(ids.conversation, { kind: "submitted" }),
          );
        }),
      ).rejects.toThrow("injected");
      expect(await f.db.read().runs.get(run)).toBeNull();
      expect(
        await f.db.read().messages.forConversation(ids.conversation),
      ).toEqual([]);
      expect(
        (await f.db.read().projects.get(ids.project))?.active_run_id,
      ).toBeNull();
      expect(await f.db.read().events.after(ids.conversation, "0", 20)).toEqual(
        [],
      );
      expect(
        (await f.pool.query("SELECT count(*)::int AS count FROM outbox"))
          .rows[0].count,
      ).toBe(0);
    }
  } finally {
    await f.close();
  }
}, 20000);
it("commits atomically, keeps read access read-only, and rejects escaped transaction operations", async () => {
  const f = await database();
  try {
    const ids = await seed(f.db);
    let escaped!: DbTransaction;
    await f.db.transaction(async (tx) => {
      escaped = tx;
      await tx.events.append(ids.conversation, { kind: "committed" });
    });
    expect(
      await f.db.read().events.after(ids.conversation, "0", 20),
    ).toHaveLength(1);
    expect("insert" in f.db.read().projects).toBe(false);
    await expect(escaped.projects.lock(ids.project)).rejects.toMatchObject({
      code: "db_transaction_closed",
    });
    await expect(
      f.db.transaction(async () => f.db.transaction(async () => 1)),
    ).rejects.toMatchObject({ code: "db_nested_transaction" });
  } finally {
    await f.close();
  }
}, 20000);
it("uses unique request identities and fencing against expired and re-enqueued outbox claims", async () => {
  const f = await database();
  try {
    const ids = await seed(f.db),
      run = randomUUID();
    await f.db.transaction(async (tx) => {
      await tx.runs.insert({
        id: run,
        conversation_id: ids.conversation,
        client_request_id: "same",
        input: "x",
        input_hash: "h",
      });
      expect(
        await tx.runs.insert({
          id: randomUUID(),
          conversation_id: ids.conversation,
          client_request_id: "same",
          input: "x",
          input_hash: "h",
        }),
      ).toBeNull();
      await tx.outbox.enqueue(run, "submit");
    });
    const claims = await Promise.all(
      ["a", "b"].map((owner) =>
        f.db.transaction((tx) =>
          tx.outbox.claim(owner, randomUUID(), 8, 60000),
        ),
      ),
    );
    expect(claims.flat()).toHaveLength(1);
    const old = claims.flat()[0]!;
    await f.pool.query(
      "UPDATE outbox SET claimed_until=now()-interval '1 second' WHERE id=$1",
      [old.id],
    );
    const result = {
      done: true,
      attempts: 0,
      availableAt: new Date().toISOString(),
      lastError: null,
    };
    expect(
      await f.db.transaction((tx) =>
        tx.outbox.finish(old.id, old.claim_token!, old.version, result),
      ),
    ).toBe(false);
    const [fresh] = await f.db.transaction((tx) =>
      tx.outbox.claim("new", randomUUID(), 8, 60000),
    );
    expect(
      await f.db.transaction((tx) =>
        tx.outbox.finish(
          fresh!.id,
          fresh!.claim_token!,
          fresh!.version,
          result,
        ),
      ),
    ).toBe(true);
    await f.db.transaction((tx) => tx.outbox.enqueue(run, "submit"));
    const [next] = await f.db.transaction((tx) =>
      tx.outbox.claim("next", randomUUID(), 8, 60000),
    );
    expect(next!.version).toBe(fresh!.version + 1);
    expect(
      await f.db.transaction((tx) =>
        tx.outbox.finish(
          fresh!.id,
          fresh!.claim_token!,
          fresh!.version,
          result,
        ),
      ),
    ).toBe(false);
  } finally {
    await f.close();
  }
}, 20000);
it("checks all migration checksums and refuses the authentication database before DDL", async () => {
  const f = await database(false);
  try {
    await f.pool.query("CREATE TABLE session(id text)");
    await expect(f.resource.migrate()).rejects.toMatchObject({
      code: "db_auth_database_forbidden",
    });
    expect(
      (await f.pool.query("SELECT to_regclass('app_users') AS table_name"))
        .rows[0].table_name,
    ).toBeNull();
    await f.pool.query("DROP TABLE session");
    await f.resource.migrate();
    await f.resource.migrate();
    await f.resource.checkReadiness();
    await f.pool.query(
      "UPDATE schema_migrations SET digest='changed' WHERE version=1",
    );
    await expect(f.resource.migrate()).rejects.toMatchObject({
      code: "db_migration_checksum_mismatch",
    });
    await expect(f.resource.checkReadiness()).rejects.toMatchObject({
      code: "db_schema_incompatible",
    });
  } finally {
    await f.close();
  }
}, 20000);
it("allows only one worker owner and releases ownership explicitly", async () => {
  const f = await database();
  try {
    const owner = await f.resource.acquireWorker(() => {});
    try {
      await expect(f.resource.acquireWorker(() => {})).rejects.toMatchObject({
        code: "db_worker_already_running",
      });
    } finally {
      await owner.close();
    }
    const replacement = await f.resource.acquireWorker(() => {});
    expect(replacement.healthy).toBe(true);
    await replacement.close();
  } finally {
    await f.close();
  }
}, 20000);

it("notifies once when the real lock connection dies and lets a replacement acquire ownership", async () => {
  const f = await database();
  let calls = 0;
  let owner: Awaited<ReturnType<typeof f.resource.acquireWorker>> | undefined;
  try {
    owner = await f.resource.acquireWorker(() => {
      calls++;
    });
    // Only this isolated temporary database is touched; no external DB is used.
    const locks = await f.pool.query(
      "SELECT pid FROM pg_locks WHERE locktype='advisory' AND granted",
    );
    expect(locks.rows).toHaveLength(1);
    await f.pool.query("SELECT pg_terminate_backend($1)", [locks.rows[0].pid]);
    await expect.poll(() => calls).toBe(1);
    expect(owner.healthy).toBe(false);
    await owner.close();
    await owner.close();
    const replacement = await f.resource.acquireWorker(() => {
      calls++;
    });
    try {
      expect(replacement.healthy).toBe(true);
    } finally {
      await replacement.close();
    }
    expect(calls).toBe(1);
  } finally {
    await owner?.close();
    await f.close();
  }
}, 20000);
