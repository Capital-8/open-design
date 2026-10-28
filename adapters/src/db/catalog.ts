import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  BridgeError,
  type CatalogRead,
  type CatalogKind,
  type DataObject,
} from "@open-design/bridge";
/** Reads a generated catalog. Owns SQLite only; file bytes go through file capability. */
export function createCatalogDb(options: {
  file: string;
  manifest: string;
  officialMeta: string;
}) {
  const connection = new DatabaseSync(options.file, { readOnly: true });
  let closed = false;
  const digest = createHash("sha256")
    .update(readFileSync(options.manifest))
    .digest("hex");
  try {
    connection.exec("PRAGMA query_only=ON");
    if (
      connection.prepare("PRAGMA user_version").get()?.user_version !== 2 ||
      connection.prepare("SELECT manifest_sha256 FROM catalog_meta").get()
        ?.manifest_sha256 !== digest
    )
      throw new BridgeError("catalog_manifest_mismatch");
  } catch (error) {
    connection.close();
    throw error;
  }
  const guard = () => {
    if (closed) throw new BridgeError("catalog_closed");
  };
  const tables = {
    plugin: { table: "installed_plugins", column: "record_json" },
    skill: { table: "skills", column: "summary_json" },
    "design-system": { table: "design_systems", column: "summary_json" },
  };
  const table = (kind: CatalogKind) => {
    const value = tables[kind];
    if (!value) throw new BridgeError("invalid_catalog_kind");
    return value;
  };
  let metadata: DataObject;
  try {
    metadata = JSON.parse(
      readFileSync(options.officialMeta, "utf8"),
    ) as DataObject;
    const manifest = JSON.parse(readFileSync(options.manifest, "utf8"));
    if (
      metadata.schemaVersion !== 1 ||
      metadata.sourceCommit !== manifest.source.commit ||
      !Array.isArray(metadata.resources)
    )
      throw new BridgeError("catalog_manifest_mismatch");
  } catch (error) {
    connection.close();
    throw error;
  }
  const adapter: CatalogRead = {
    async officialMetadata() {
      guard();
      return structuredClone(metadata);
    },
    async digest() {
      guard();
      return digest;
    },
    async list(kind, templates = false) {
      guard();
      const t = table(kind);
      const sql =
        `SELECT ${t.column} AS value FROM ${t.table}` +
        (kind === "skill" ? " WHERE root LIKE ?" : "") +
        " ORDER BY id";
      return connection
        .prepare(sql)
        .all(
          ...(kind === "skill"
            ? [templates ? "design-templates/%" : "skills/%"]
            : []),
        )
        .map((row) => JSON.parse(String(row.value)) as DataObject);
    },
    async get(kind, id) {
      guard();
      const t = table(kind);
      const row = connection
        .prepare(`SELECT * FROM ${t.table} WHERE id=?`)
        .get(id);
      if (!row) return null;
      return {
        ...JSON.parse(String(row[t.column])),
        ...(kind === "skill" ? { body: row.body } : {}),
        ...(kind === "design-system"
          ? { manifest: JSON.parse(String(row.manifest_json)) }
          : {}),
      };
    },
    async files(kind, id) {
      guard();
      table(kind);
      return connection
        .prepare(
          "SELECT * FROM assets WHERE kind=? AND owner_id=? ORDER BY path",
        )
        .all(kind, id)
        .map((row) => ({
          path: String(row.path),
          resourcePath: String(row.resource_path),
          sha256: String(row.sha256),
          size: Number(row.size),
        }));
    },
  };
  return {
    adapter,
    close() {
      if (!closed) {
        closed = true;
        connection.close();
      }
    },
  };
}
