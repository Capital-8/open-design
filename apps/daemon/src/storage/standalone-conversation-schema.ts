import type Database from 'better-sqlite3';

/** Rebuild only the ownership constraint, preserving all legacy columns and indexes. */
function allowNullableProject(db: Database.Database, table: 'conversations' | 'applied_plugin_snapshots'): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number }>;
  if (!columns.find((column) => column.name === 'project_id')?.notnull) return;
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string };
  const dependents = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = ? AND type IN ('index', 'trigger') AND sql IS NOT NULL").all(table) as Array<{ sql: string }>;
  const replacement = `${table}_nullable`;
  const schema = row.sql.replace(new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?[\"\\x60]?${table}[\"\\x60]?`, 'i'), `CREATE TABLE ${replacement}`)
    .replace(/\bproject_id\s+TEXT\s+NOT\s+NULL/i, 'project_id TEXT');
  if (schema === row.sql || /\bproject_id\s+TEXT\s+NOT\s+NULL/i.test(schema)) throw new Error(`Unsupported ${table} ownership schema`);
  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(schema);
      db.exec(`INSERT INTO ${replacement} SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${replacement} RENAME TO ${table};`);
      for (const dependent of dependents) db.exec(dependent.sql);
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Conversation migration would break foreign keys');
    })();
  } finally { db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`); }
}

/** Preserve conversation ids and every referencing message/session while allowing no project. */
export function migrateStandaloneConversations(db: Database.Database): void {
  allowNullableProject(db, 'conversations');
  db.exec(`CREATE TABLE IF NOT EXISTS standalone_conversation_scopes (
    conversation_id TEXT PRIMARY KEY,
    workspace_id TEXT,
    workspace_member_id TEXT,
    CHECK ((workspace_id IS NULL) = (workspace_member_id IS NULL)),
    FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_standalone_conversation_scope
    ON standalone_conversation_scopes(workspace_id, workspace_member_id);`);
}

export function migrateStandalonePluginSnapshots(db: Database.Database): void {
  allowNullableProject(db, 'applied_plugin_snapshots');
}
