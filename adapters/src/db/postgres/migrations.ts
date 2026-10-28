import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { BridgeError } from "@open-design/bridge";
import { transactionRunner, type Sql } from "./transaction.js";
export const SCHEMA_VERSION = 9;
export const migrationDirectory = new URL("../migrations/", import.meta.url);
async function businessDatabase(sql: Sql) {
  const result =
    await sql(`SELECT to_regclass('"user"') IS NOT NULL OR to_regclass('account') IS NOT NULL
    OR to_regclass('session') IS NOT NULL OR to_regclass('verification') IS NOT NULL AS authentication`);
  if (result.rows[0]?.authentication !== false)
    throw new BridgeError("db_auth_database_forbidden");
}
async function files(directory: URL) {
  const names = (await readdir(directory))
    .filter((name) => /^\d{3}-.+\.sql$/.test(name))
    .sort();
  if (
    names.length !== SCHEMA_VERSION ||
    names.some((name, i) => Number(name.slice(0, 3)) !== i + 1)
  )
    throw new BridgeError("db_migration_set_invalid");
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(new URL(name, directory), "utf8");
      return {
        version: Number(name.slice(0, 3)),
        sql,
        digest: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
}
export async function migratePostgres(
  pool: Pool,
  directory = migrationDirectory,
) {
  const migrations = await files(directory);
  await transactionRunner(
    pool,
    (sql) => sql,
  )(async (sql) => {
    await businessDatabase(sql);
    await sql("SELECT pg_advisory_xact_lock(hashtext('od-cloud-migrations'))");
    await sql(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const previous = (
      await sql<{ version: number; digest: string }>(
        "SELECT version,digest FROM schema_migrations ORDER BY version",
      )
    ).rows;
    if (
      previous.some(
        (row, index) =>
          row.version !== index + 1 || migrations[index]?.digest !== row.digest,
      )
    )
      throw new BridgeError("db_migration_checksum_mismatch");
    for (const migration of migrations.slice(previous.length)) {
      await sql(migration.sql);
      await sql("INSERT INTO schema_migrations(version,digest) VALUES($1,$2)", [
        migration.version,
        migration.digest,
      ]);
    }
  });
}
export async function assertPostgresSchema(
  pool: Pool,
  directory = migrationDirectory,
) {
  const sql: Sql = (text, values) => pool.query(text, values);
  await businessDatabase(sql);
  const expected = await files(directory);
  const applied = (
    await sql<{ version: number; digest: string }>(
      "SELECT version,digest FROM schema_migrations ORDER BY version",
    )
  ).rows;
  if (
    applied.length !== expected.length ||
    applied.some(
      (row, index) =>
        row.version !== expected[index]?.version ||
        row.digest !== expected[index]?.digest,
    )
  )
    throw new BridgeError("db_schema_incompatible");
}
