import { expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { transactionRunner } from "../../src/db/postgres/transaction.js";
function fixture(commit?: () => void) {
  const query = vi.fn(async (sql: string) => {
    if (sql === "COMMIT") commit?.();
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const pool = { connect: vi.fn(async () => client) } as unknown as Pick<
    Pool,
    "connect"
  >;
  return { query, release, run: transactionRunner(pool, (sql) => sql) };
}
it("preserves callback failure, rolls back, and invalidates escaped handles", async () => {
  const f = fixture(),
    failure = new Error("business rejection");
  let escaped!: Parameters<Parameters<typeof f.run>[0]>[0];
  await expect(
    f.run(async (sql) => {
      escaped = sql;
      await sql("SELECT 1");
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(f.query.mock.calls.map((call) => call[0])).toEqual([
    "BEGIN",
    "SELECT 1",
    "ROLLBACK",
  ]);
  await expect(escaped("SELECT 1")).rejects.toMatchObject({
    code: "db_transaction_closed",
  });
  expect(f.release).toHaveBeenCalledWith(false);
});
it("distinguishes a lost COMMIT response from a server-confirmed rejection without replay", async () => {
  const f = fixture(() => {
      throw new Error("socket gone");
    }),
    operation = vi.fn(async () => "value");
  await expect(f.run(operation)).rejects.toMatchObject({
    code: "db_commit_unknown",
    uncertain: true,
  });
  expect(operation).toHaveBeenCalledOnce();
  expect(f.query.mock.calls.map((call) => call[0])).toEqual([
    "BEGIN",
    "COMMIT",
  ]);
  expect(f.release).toHaveBeenCalledWith(true);
  const definite = fixture(() => {
    throw Object.assign(new Error("serialization"), { code: "40001" });
  });
  await expect(definite.run(async () => "value")).rejects.toMatchObject({
    code: "db_transaction_conflict",
    uncertain: false,
  });
});
it("rejects nested transactions and closes successful callback handles", async () => {
  const f = fixture();
  let escaped!: Parameters<Parameters<typeof f.run>[0]>[0];
  await expect(f.run(async () => f.run(async () => 1))).rejects.toMatchObject({
    code: "db_nested_transaction",
  });
  expect(
    await f.run(async (sql) => {
      escaped = sql;
      return 42;
    }),
  ).toBe(42);
  await expect(escaped("SELECT 1")).rejects.toMatchObject({
    code: "db_transaction_closed",
  });
});
