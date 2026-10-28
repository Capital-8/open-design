import { createPostgresDb } from "@open-design/adapters/db";
import { BridgeError } from "@open-design/bridge";
const connectionString = process.env.OD_CLOUD_DATABASE_URL;
if (!connectionString)
  throw new Error(
    "OD_CLOUD_DATABASE_URL is required for the cloud migration command",
  );
const resource = createPostgresDb({ connectionString });
try {
  await resource.migrate();
  console.log("Cloud database migrations applied.");
} catch (error) {
  console.error(
    error instanceof BridgeError ? error.code : "cloud_migration_failed",
  );
  process.exitCode = 1;
} finally {
  await resource.close();
}
