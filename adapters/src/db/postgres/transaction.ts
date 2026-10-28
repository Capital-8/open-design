import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { BridgeError } from "@open-design/bridge";

export type Sql = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
) => Promise<{ rows: T[]; rowCount: number | null }>;
/** Never leak SQL or provider messages through the capability boundary. */
export function databaseError(error: unknown): BridgeError {
  if (error instanceof BridgeError) return error;
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (code === "23505") return new BridgeError("db_conflict");
  if (code === "23503") return new BridgeError("db_reference_conflict");
  if (["40001", "40P01", "55P03"].includes(code))
    return new BridgeError("db_transaction_conflict");
  return new BridgeError("db_unavailable");
}
export function transactionRunner<Context>(
  pool: Pick<Pool, "connect">,
  records: (sql: Sql) => Context,
) {
  const activeContext = new AsyncLocalStorage<boolean>();
  return async function transaction<T>(
    operation: (tx: Context) => Promise<T>,
  ): Promise<T> {
    if (activeContext.getStore())
      throw new BridgeError("db_nested_transaction");
    let client: PoolClient;
    try {
      client = await pool.connect();
    } catch (error) {
      throw databaseError(error);
    }
    let active = true,
      pending = 0,
      commitSent = false,
      destroy = false,
      began = false;
    const sql: Sql = async (text, values) => {
      if (!active) throw new BridgeError("db_transaction_closed");
      pending++;
      try {
        return await client.query(text, values);
      } catch (error) {
        throw databaseError(error);
      } finally {
        pending--;
      }
    };
    try {
      await client.query("BEGIN");
      began = true;
      const result = await activeContext.run(true, () =>
        operation(records(sql)),
      );
      active = false;
      if (pending) throw new BridgeError("db_unawaited_operation");
      commitSent = true;
      await client.query("COMMIT");
      return result;
    } catch (error) {
      active = false;
      if (commitSent) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "";
        // A server-reported serialization/deferred constraint rejection is definite. Transport loss is not.
        if (/^(23|40)/.test(code)) throw databaseError(error);
        destroy = true;
        throw new BridgeError("db_commit_unknown", true);
      }
      await client.query("ROLLBACK").catch(() => {
        destroy = true;
      });
      throw began ? error : databaseError(error);
    } finally {
      active = false;
      client.release(destroy);
    }
  };
}
