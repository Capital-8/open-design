import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrateStandaloneConversations, migrateStandalonePluginSnapshots } from '../../src/storage/standalone-conversation-schema.js';
describe('standalone conversation migration', () => {
  it('preserves old rows and cascade relations, permits null, and is idempotent', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);
        CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT,
          session_mode TEXT NOT NULL DEFAULT 'design', intent_signals_json TEXT,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, applied_plugin_snapshot_id TEXT,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
        CREATE INDEX idx_conv_project ON conversations(project_id, updated_at DESC);
        CREATE INDEX idx_legacy_conversation_pin ON conversations(applied_plugin_snapshot_id);
        CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE);
        CREATE TABLE agent_sessions (conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE, session_id TEXT);
        INSERT INTO projects VALUES ('project');
        INSERT INTO conversations VALUES ('conversation','project','Kept','chat','{"kept":true}',1,2,'snapshot-kept');
        INSERT INTO messages VALUES ('message','conversation');
        INSERT INTO agent_sessions VALUES ('conversation','session');`);
      migrateStandaloneConversations(db); migrateStandaloneConversations(db);
      expect(db.prepare('SELECT * FROM conversations').get()).toMatchObject({ id:'conversation',project_id:'project',session_mode:'chat',intent_signals_json:'{"kept":true}',applied_plugin_snapshot_id:'snapshot-kept' });
      expect(db.prepare('SELECT * FROM agent_sessions').get()).toEqual({conversation_id:'conversation',session_id:'session'});
      db.exec("INSERT INTO conversations VALUES ('standalone',NULL,NULL,'design',NULL,3,3,NULL)");
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='idx_legacy_conversation_pin'").get()).toEqual({name:'idx_legacy_conversation_pin'});
      expect(db.pragma('foreign_keys', {simple:true})).toBe(1); expect(db.pragma('foreign_key_check')).toEqual([]);
      db.exec("DELETE FROM projects WHERE id='project'");
      expect(db.prepare('SELECT * FROM messages').all()).toEqual([]); expect(db.prepare('SELECT * FROM agent_sessions').all()).toEqual([]);
      expect(db.prepare('SELECT id FROM conversations').all()).toEqual([{id:'standalone'}]);
    } finally { db.close(); }
  });
  it('keeps existing plugin snapshots and dependent rows while admitting conversation-owned snapshots', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);
        CREATE TABLE conversations (id TEXT PRIMARY KEY);
        CREATE TABLE applied_plugin_snapshots (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), conversation_id TEXT REFERENCES conversations(id), manifest TEXT NOT NULL);
        CREATE INDEX idx_snapshot_project ON applied_plugin_snapshots(project_id);
        CREATE TABLE snapshot_child (snapshot_id TEXT REFERENCES applied_plugin_snapshots(id));
        INSERT INTO projects VALUES ('project');
        INSERT INTO conversations VALUES ('conversation');
        INSERT INTO applied_plugin_snapshots VALUES ('kept','project','conversation','preserved');
        INSERT INTO snapshot_child VALUES ('kept');`);
      migrateStandalonePluginSnapshots(db); migrateStandalonePluginSnapshots(db);
      db.exec("INSERT INTO applied_plugin_snapshots VALUES ('independent',NULL,'conversation','new')");
      expect(db.prepare("SELECT * FROM applied_plugin_snapshots WHERE id='kept'").get()).toEqual({id:'kept',project_id:'project',conversation_id:'conversation',manifest:'preserved'});
      expect(db.prepare('SELECT * FROM snapshot_child').all()).toEqual([{snapshot_id:'kept'}]);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally { db.close(); }
  });

});
