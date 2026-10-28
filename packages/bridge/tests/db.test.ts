import { beforeEach, expect, it, vi } from "vitest";
import { dbFixture } from "./db-fixture.js";
import type { DbTransaction } from "../src/index.js";
beforeEach(() => vi.resetModules());
it("validates read repositories atomically and forwards exactly one transaction callback", async () => {
  const { register, db } = await import("../src/index.js");
  const f = dbFixture();
  expect(() =>
    register(
      { db: { ...f.adapter, read: () => ({}) as never } },
      { required: ["db"] },
    ),
  ).toThrow("catalog.officialMetadata");
  expect(() => db.read()).toThrow("not registered");
  const context = {} as DbTransaction;
  f.adapter.transaction = vi.fn(async (callback) => callback(context));
  register({ db: f.adapter }, { required: ["db"] });
  const callback = vi.fn(async (tx) => {
    expect(tx).toBe(context);
    return "committed";
  });
  expect(await db.transaction(callback)).toBe("committed");
  expect(callback).toHaveBeenCalledOnce();
  expect(f.adapter.transaction).toHaveBeenCalledOnce();
});
