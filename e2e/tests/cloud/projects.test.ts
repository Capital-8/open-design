import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { register } from "@open-design/bridge";
import {
  prepareProject,
  finishProject,
  recoverOperations,
} from "@open-design/biz/projects";
import {
  prepareConversation,
  finishConversation,
} from "@open-design/biz/conversations";
import { prepareSave, finishSave } from "@open-design/biz/files";
import { Attachments } from "@open-design/biz/files/attachments";
import { database } from "../../lib/vitest/cloud-postgres.js";
it("[P1] creation retries never duplicate unknown upstream effects; edit leases and attachment batches stay scoped", async () => {
  const d = await database();
  try {
    register({ db: d.db }, { required: ["db"] });
    await d.db.transaction((tx) =>
      tx.accounts.upsertIdentity({
        id: "u",
        auth_user_id: "u",
        email: "u@test",
        name: null,
        image: null,
      }),
    );
    const input = {
      id: randomUUID(),
      name: "Project",
      workspaceId: "w",
      runtimeId: "test",
    };
    const intents = await Promise.all([
      prepareProject("u", input),
      prepareProject("u", input),
    ]);
    expect(intents.filter((i) => i.execute)).toHaveLength(1);
    const intent = intents.find((i) => i.execute)!;
    await finishProject(input.id, intent.token!, {
      ok: false,
      code: "connection_lost",
      uncertain: true,
    });
    expect((await prepareProject("u", input)).execute).toBe(false);
    expect((await d.db.read().projects.get(input.id))?.creation_status).toBe(
      "creation_unknown",
    );
    await expect(
      prepareProject("u", { ...input, name: "other" }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(prepareProject("other", input)).rejects.toMatchObject({
      code: "resource_unavailable",
    });
    // Late definitive completion may confirm the SAME intent, never a new create.
    await finishProject(input.id, intent.token!, {
      ok: true,
      id: "remote-project",
    });
    const cid = randomUUID(),
      c = await prepareConversation("u", input.id, "w", { id: cid });
    await finishConversation(input.id, cid, c.token!, {
      ok: true,
      id: "remote-session",
    });
    expect(
      (await prepareConversation("u", input.id, "w", { id: cid })).execute,
    ).toBe(false);
    await expect(
      prepareConversation("u", input.id, "other", { id: randomUUID() }),
    ).rejects.toMatchObject({ code: "workspace_selection_unavailable" });
    const save = await prepareSave("u", input.id, "w", "new", "v1");
    await recoverOperations();
    expect((await d.db.read().projects.get(input.id))?.edit_state).toBe(
      "editing",
    );
    await d.pool.query(
      "UPDATE projects SET operation_expires_at=now()-interval '1 second' WHERE id=$1",
      [input.id],
    );
    await recoverOperations();
    expect((await d.db.read().projects.get(input.id))?.edit_state).toBe(
      "unknown",
    );
    await expect(
      prepareSave("u", input.id, "w", "another", "v1"),
    ).rejects.toMatchObject({ code: "project_busy" });
    await finishSave(input.id, save.token, "confirmed");
    expect((await d.db.read().projects.get(input.id))?.edit_state).toBe("idle");
    const attachments = new Attachments(),
      user = {
        id: "u",
        email: "u@test",
        name: null,
        image: null,
        status: "active",
      };
    const [uploaded] = await attachments.save(user, input.id, [
      { name: "notes.txt", bytes: Buffer.from("untrusted attachment") },
    ]);
    expect(
      (
        await attachments.textContext(
          user,
          input.id,
          [uploaded!.path],
          d.db.read(),
        )
      )[0]?.text,
    ).toBe("untrusted attachment");
    await expect(
      attachments.save(user, input.id, [
        { name: "ok", bytes: Buffer.from("ok") },
        { name: "../escape", bytes: Buffer.from("bad") },
      ]),
    ).rejects.toMatchObject({ code: "invalid_upload" });
    expect(await attachments.list(user, input.id)).toHaveLength(1);
  } finally {
    await d.close();
  }
}, 30000);
