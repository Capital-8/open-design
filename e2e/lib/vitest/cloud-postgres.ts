import EmbeddedPostgres from "embedded-postgres";
import { Pool, type PoolClient } from "pg";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { createPostgresDb } from "@open-design/adapters/db";
export async function database(migrate = true) {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  if (!address || typeof address === "string")
    throw new Error("Port unavailable");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  const directory = await mkdtemp(join(tmpdir(), "od-cloud-pg-")),
    password = randomUUID();
  const postgres = new EmbeddedPostgres({
    databaseDir: directory,
    user: "cloud_test",
    password,
    port,
    persistent: true,
    postgresFlags: ["-h", "127.0.0.1", "-k", ""],
    onLog() {},
    onError() {},
  });
  const connectionString = `postgresql://cloud_test:${password}@127.0.0.1:${port}/postgres`;
  const pool = new Pool({ connectionString }),
    resource = createPostgresDb({ connectionString });
  const clients = new Set<PoolClient>();
  pool.on("connect", (client) => {
    clients.add(client);
    client.once("end", () => clients.delete(client));
  });
  const close = async () => {
    await resource.close();
    await pool.end();
    await Promise.all(
      [...clients].map(
        (client) => new Promise<void>((resolve) => client.once("end", resolve)),
      ),
    );
    await postgres.stop();
    await rm(directory, { force: true, recursive: true });
  };
  try {
    await postgres.initialise();
    await postgres.start();
    if (migrate) await resource.migrate();
  } catch (error) {
    await close();
    throw error;
  }
  return { resource, db: resource.adapter, pool, connectionString, close };
}
