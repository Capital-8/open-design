import { Pool } from "pg";
import { BridgeError, type Db, type CatalogRead } from "@open-design/bridge";
import { databaseError, transactionRunner, type Sql } from "./transaction.js";
import { readRecords, transactionRecords } from "./records.js";
import { assertPostgresSchema, migratePostgres } from "./migrations.js";
export {
  migratePostgres,
  assertPostgresSchema,
  SCHEMA_VERSION,
} from "./migrations.js";

/** Application composition owns this resource. SQL/Pool never enter the bridge contract. */
export function createPostgresDb(options: {
  connectionString: string;
  max?: number;
  catalog?: CatalogRead;
}) {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 12,
    connectionTimeoutMillis: 10000,
  });
  const sql: Sql = async (text, values) => {
    try {
      return await pool.query(text, values);
    } catch (error) {
      throw databaseError(error);
    }
  };
  const reader = {
    ...readRecords(sql),
    ...(options.catalog ? { catalog: options.catalog } : {}),
  };
  const adapter: Db = {
    read: () => reader,
    transaction: transactionRunner(pool, transactionRecords),
  };
  return {
    adapter,
    async migrate() {
      await migratePostgres(pool);
    },
    async checkReadiness() {
      try {
        await assertPostgresSchema(pool);
      } catch (error) {
        throw databaseError(error);
      }
    },
    async close() {
      await pool.end();
    },
    async acquireWorker(onLost: () => void) {
      const client = await pool.connect();
      let released = false,
        healthy = true;
      const lost = () => {
        if (!healthy || released) return;
        healthy = false;
        onLost();
      };
      client.on("error", lost);
      client.on("end", lost);
      const detach = () => {
        client.removeListener("error", lost);
        client.removeListener("end", lost);
      };
      try {
        const result = await client.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock(hashtext('od-cloud-worker')) AS locked",
        );
        if (!result.rows[0]?.locked)
          throw new BridgeError("db_worker_already_running");
      } catch (error) {
        detach();
        client.release(true);
        throw databaseError(error);
      }
      return {
        get healthy() {
          return healthy && !released;
        },
        async close() {
          if (released) return;
          released = true;
          try {
            if (healthy)
              await client.query(
                "SELECT pg_advisory_unlock(hashtext('od-cloud-worker'))",
              );
          } catch (error) {
            healthy = false;
            throw databaseError(error);
          } finally {
            detach();
            client.release(!healthy);
          }
        },
      };
    },
  };
}
