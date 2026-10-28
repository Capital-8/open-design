import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  register,
  type Db,
  type ExecutionRun,
  type ExecutionSnapshot,
} from "@open-design/bridge";
import { submitRun, cancelRun } from "@open-design/biz/runs";
import {
  prepareJob,
  completeJob,
  revokeTasks,
  reauthorizeTask,
  recoverIntents,
} from "@open-design/biz/runs/recovery";
import { applyEvent, locked, mergeSnapshot } from "@open-design/biz/journal";
import { database } from "../../lib/vitest/cloud-postgres.js";
it("[P1] task admission is atomic; claims fence results, cancellation awaits terminal facts, and restart discovers rather than resubmits", async () => {
  const d = await database();
  let inject = false;
  try {
    const proxy: Db = {
      read: () => d.db.read(),
      transaction: (fn) =>
        d.db.transaction((tx) =>
          fn({
            ...tx,
            events: {
              ...tx.events,
              append: async (...args) => {
                if (inject) throw Error("injected event failure");
                return tx.events.append(...args);
              },
            },
          }),
        ),
    };
    register({ db: proxy }, { required: ["db"] });
    const pid = randomUUID(),
      cid = randomUUID();
    await d.db.transaction(async (tx) => {
      await tx.accounts.upsertIdentity({
        id: "u",
        auth_user_id: "u",
        email: "u@test",
        name: null,
        image: null,
      });
      await tx.projects.insert({
        id: pid,
        owner_id: "u",
        name: "p",
        runtime_id: "test",
        runtime_project_id: "remote-p",
        workspace_id: "w",
        creation_status: "ready",
      });
      await tx.conversations.insert({
        id: cid,
        project_id: pid,
        runtime_session_id: "remote-c",
        creation_status: "ready",
      });
    });
    await d.db.transaction((tx) =>
      tx.credentials.insert({
        id: "cred",
        principal_id: "u",
        provider_actor_id: "actor",
        environment: "test",
        ciphertext: "fixture",
        key_version: "fixture",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        revoked_at: null,
        revision: "one",
      }),
    );
    const input = {
      conversationId: cid,
      clientRequestId: "request",
      original: "user message",
      modelInput: "frozen rules + user message",
      requestHash: "request-hash",
      legacy: {},
      scope: { principalId: "u", workspaceId: "w", credentialRef: "cred" },
      environment: "test",
      projectRevision: 1,
      conversationRevision: 1,
      admission: {
        principalId: "u",
        workspaceId: "w",
        workspaceMemberId: "m",
        checkedAt: Date.now(),
      },
    };
    inject = true;
    await expect(submitRun("u", input)).rejects.toThrow("injected");
    inject = false;
    expect(await d.db.read().runs.forConversation(cid)).toEqual([]);
    expect(await d.db.read().messages.forConversation(cid)).toEqual([]);
    expect((await d.db.read().projects.get(pid))?.active_run_id).toBeNull();
    expect(
      (await d.pool.query("SELECT count(*)::int AS n FROM outbox")).rows[0].n,
    ).toBe(0);
    const run = await submitRun("u", input);
    expect((await submitRun("u", input)).id).toBe(run.id);
    await expect(
      submitRun("u", { ...input, requestHash: "different" }),
    ).rejects.toMatchObject({ code: "conflict" });
    const claim = async () =>
      (
        await d.db.transaction((tx) =>
          tx.outbox.claim("worker", randomUUID(), 8, 60000),
        )
      )[0]!;
    const old = await claim(),
      plan = await prepareJob(old, "test");
    expect(plan?.action).toBe("submit");
    expect((await d.db.read().runs.get(run.id))?.submission).toBe(
      "unconfirmed",
    );
    await d.pool.query(
      "UPDATE outbox SET claimed_until=now()-interval '1 second' WHERE id=$1",
      [old.id],
    );
    await recoverIntents();
    const fresh = await claim();
    expect((await prepareJob(fresh, "test"))?.action).toBe("discover");
    const remote: ExecutionRun = {
      ref: {
        projectId: "remote-p",
        sessionId: "remote-c",
        runId: "remote-run",
      },
      idempotencyKey: run.id,
      status: "running",
      answer: "",
      detail: "",
      createdAt: new Date().toISOString(),
    };
    expect(
      await completeJob(old, "cred", { kind: "submitted", run: remote }),
    ).toBe(false);
    expect((await d.db.read().runs.get(run.id))?.runtime_run_id).toBeNull();
    expect(
      await completeJob(fresh, "cred", { kind: "submitted", run: remote }),
    ).toBe(true);
    await cancelRun("u", run.id);
    expect((await d.db.read().projects.get(pid))?.active_run_id).toBe(run.id);
    const jobs = await d.db.transaction((tx) =>
        tx.outbox.claim("worker", randomUUID(), 8, 60000),
      ),
      cancel = jobs.find((j) => j.kind === "cancel")!,
      reconcile = jobs.find((j) => j.kind === "reconcile")!;
    await completeJob(cancel, "cred", { kind: "cancel-accepted" });
    expect((await d.db.read().runs.get(run.id))?.cancel_confirmed).toBe(false);
    expect((await d.db.read().projects.get(pid))?.active_run_id).toBe(run.id);
    const event = {
      cursor: "1",
      runId: "remote-run",
      kind: "message.delta",
      time: new Date().toISOString(),
      payload: { kind: "message.delta", turn: "t", text: "hello" },
    };
    await applyEvent(cid, event, "cred");
    await applyEvent(cid, event, "cred");
    await expect(
      applyEvent(cid, { ...event, cursor: "3" }, "cred"),
    ).rejects.toMatchObject({ code: "invalid_cursor" });
    const snapshot: ExecutionSnapshot = {
      session: { projectId: "remote-p", sessionId: "remote-c" },
      cursor: "2",
      messages: [
        {
          sequence: 1,
          run: "remote-run",
          role: "user",
          text: "must not replace original",
        },
        {
          sequence: 2,
          run: "remote-run",
          role: "assistant",
          text: "hello",
          turn: "t",
        },
      ],
      runs: [{ ...remote, status: "cancelled" }],
      previews: [],
    };
    await completeJob(reconcile, "cred", {
      kind: "observed",
      run: { ...remote, status: "cancelled" },
      snapshot,
    });
    expect((await d.db.read().runs.get(run.id))?.cancel_confirmed).toBe(true);
    expect((await d.db.read().projects.get(pid))?.active_run_id).toBeNull();
    expect((await d.db.read().messages.userForRun(run.id))?.content).toBe(
      "user message",
    );
    expect(await d.db.read().messages.forConversation(cid)).toHaveLength(2);
    await locked(cid, (tx, c) =>
      mergeSnapshot(tx, c, {
        ...snapshot,
        cursor: "0",
        messages: [],
        runs: [remote],
      }),
    );
    expect((await d.db.read().conversations.get(cid))?.runtime_cursor).toBe(
      "2",
    );
    expect((await d.db.read().runs.get(run.id))?.status).toBe("cancelled");
    const p = (await d.db.read().projects.get(pid))!,
      c = (await d.db.read().conversations.get(cid))!;
    const pending = await submitRun("u", {
      ...input,
      clientRequestId: "second",
      projectRevision: p.revision,
      conversationRevision: c.revision,
      admission: { ...input.admission, checkedAt: Date.now() },
    });
    // Crash after durable logout but before the facade updates tasks must still prohibit rebinding.
    await d.db.transaction((tx) =>
      tx.credentials.revoke("cred", new Date().toISOString(), "logout"),
    );
    expect(await d.db.read().credentials.authorization("cred")).toEqual({
      revoked: true,
      reason: "logout",
    });

    await expect(
      reauthorizeTask({
        runId: pending.id,
        principalId: "u",
        workspaceId: "w",
        environment: "test",
        credentialRef: "fresh",
      }),
    ).rejects.toMatchObject({ code: "reauthorization_unavailable" });
    await revokeTasks("u", "cred");
  } finally {
    await d.close();
  }
}, 30000);
