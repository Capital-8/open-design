import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { assertMotionCommentAttachments, parsePreviewCommentMotionAnchor } from '@open-design/contracts';
import { closeDatabase, getPreviewComment, insertConversation, insertProject, listPreviewComments, mergeSyncedPreviewComment, openDatabase, upsertPreviewComment } from '../src/db.js';
import { previewCommentToCloud } from '../src/collab/collab-cloud-service.js';
import { parseMemberPage } from '../src/integrations/collab-cloud.js';
import { normalizeCommentAttachments, renderCommentAttachmentHint } from '../src/runtimes/chat-prompt-inputs.js';

const motion = { timeSeconds: 2.4, durationSeconds: 8, fps: 30, sourceFingerprint: 'source-123', range: { startSeconds: 1, endSeconds: 5 } };
const image = { path: 'captures/frame.png', name: 'frame.png' };
const target = { filePath: 'index.html', elementId: 'title', selector: '#title', label: 'Title', text: 'Hello',
  htmlHint: '<h1 id="title">Hello</h1>', position: { x: 10, y: 20, width: 100, height: 30 } };
let root = '';
function seed() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'od-motion-comments-'));
  const db = openDatabase(root, { dataDir: root });
  insertProject(db, { id: 'project', name: 'Motion', createdAt: 1, updatedAt: 1 });
  insertConversation(db, { id: 'chat', projectId: 'project', title: 'Review', createdAt: 1, updatedAt: 1 });
  return db;
}
afterEach(() => {
  closeDatabase();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = '';
});

describe('Motion comment evidence', () => {
  it('persists the reference and original screenshot across note edits and reopen', () => {
    let db = seed();
    const saved = upsertPreviewComment(db, 'project', 'chat', { target: { ...target, motion }, note: 'Move title', attachments: [image] })!;
    const updated = upsertPreviewComment(db, 'project', 'chat', { id: saved.id, target, note: 'Move title left', attachments: [] })!;
    expect(updated).toMatchObject({ motion, attachments: [image], note: 'Move title left' });
    expect(() => upsertPreviewComment(db, 'project', 'chat', { id: saved.id, target: { ...target, motion: { ...motion, timeSeconds: 4 } }, note: 'Retarget' }))
      .toThrow('cannot be retargeted');
    expect(() => upsertPreviewComment(db, 'project', 'chat', { id: saved.id, target: { ...target, motion: { ...motion, range: { startSeconds: 2, endSeconds: 6 } } }, note: 'Change range' }))
      .toThrow('cannot be retargeted');
    closeDatabase();
    db = openDatabase(root, { dataDir: root });
    expect(listPreviewComments(db, 'project', 'chat')).toEqual([expect.objectContaining({ id: saved.id, motion, attachments: [image] })]);
  });

  it('rejects absent, unsafe and non-image evidence, and invalid time metadata', () => {
    const db = seed();
    for (const attachments of [[], [{ path: '../escape.png', name: 'bad' }], [{ path: 'capture.txt', name: 'bad' }]]) {
      expect(() => upsertPreviewComment(db, 'project', 'chat', { target: { ...target, motion }, note: 'Review', attachments })).toThrow('requires a project image');
    }
    for (const invalid of [{ ...motion, timeSeconds: 9 }, { ...motion, fps: 0 }, { ...motion, sourceFingerprint: '' }, { ...motion, timeSeconds: NaN },
      { ...motion, range: { startSeconds: 5, endSeconds: 9 } }, { ...motion, range: { startSeconds: 5, endSeconds: 5 } }]) {
      expect(parsePreviewCommentMotionAnchor(invalid)).toBeNull();
      expect(() => upsertPreviewComment(db, 'project', 'chat', { target: { ...target, motion: invalid }, note: 'Review', attachments: [image] })).toThrow('Invalid Motion');
    }
    expect(listPreviewComments(db, 'project', 'chat')).toEqual([]);
  });

  it('adds the nullable time column after the legacy slide-key rebuild without losing old comments', () => {
    seed();
    closeDatabase();
    const legacy = new Database(path.join(root, 'app.sqlite'));
    legacy.exec(`DROP TABLE preview_comments;
      CREATE TABLE preview_comments (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
        file_path TEXT NOT NULL, element_id TEXT NOT NULL, selector TEXT NOT NULL, label TEXT NOT NULL,
        text TEXT NOT NULL, position_json TEXT NOT NULL, html_hint TEXT NOT NULL, note TEXT NOT NULL,
        status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(project_id, conversation_id, file_path, element_id));
      INSERT INTO preview_comments VALUES ('old','project','chat','index.html','title','#title','Title','Hello','{"x":1,"y":2,"width":3,"height":4}','<h1>Hello</h1>','Old comment','open',1,1);`);
    legacy.close();
    const db = openDatabase(root, { dataDir: root });
    expect(getPreviewComment(db, 'project', 'chat', 'old')).toMatchObject({ note: 'Old comment', motion: undefined });
    const saved = upsertPreviewComment(db, 'project', 'chat', { target: { ...target, motion }, note: 'New comment', attachments: [image] });
    expect(saved?.motion).toEqual(motion);
  });

  it('round-trips relay evidence and preserves it when an older relay omits new fields', () => {
    const db = seed();
    const saved = upsertPreviewComment(db, 'project', 'chat', { target: { ...target, motion }, note: 'Review', attachments: [image] })!;
    const cloud = { ...previewCommentToCloud(saved, ''), updatedAt: saved.updatedAt + 1, seq: 1 };
    expect(cloud.motion).toEqual(motion);
    const { motion: _omitted, attachments: _images, ...oldRelay } = cloud;
    expect(mergeSyncedPreviewComment(db, 'project', 'chat', { ...oldRelay, note: 'Old relay edit' })).toBe('changed');
    expect(getPreviewComment(db, 'project', 'chat', saved.id)).toMatchObject({ motion, attachments: [image], note: 'Old relay edit' });
    const remote = { ...cloud, id: 'remote', memberId: 'member' };
    const page = parseMemberPage({ mode: 'incremental', comments: [remote], hasMore: false, complete: true,
      nextPageToken: null, resumeToken: 'resume', scopeToken: 'scope', streamEpoch: 'epoch', watermarkSeq: 1, scanThroughSeq: 1 }, 'incremental', 'project');
    expect(page.skipped).toEqual([]);
    expect(page.comments[0]).toMatchObject({ motion });
    expect(mergeSyncedPreviewComment(db, 'project', 'chat', remote)).toBe('changed');
    expect(getPreviewComment(db, 'project', 'chat', 'remote')).toMatchObject({ motion, attachments: [image] });
  });

  it('rejects missing screenshots at chat admission and carries time plus image paths into the Agent prompt', () => {
    const attachment = { id: 'comment', order: 1, filePath: target.filePath, elementId: target.elementId, selector: target.selector,
      label: target.label, currentText: target.text, htmlHint: target.htmlHint, pagePosition: target.position,
      comment: 'Change title', motion };
    expect(() => assertMotionCommentAttachments([attachment])).toThrow('requires a project image');
    expect(() => normalizeCommentAttachments([attachment])).toThrow('requires a project image');
    const normalized = normalizeCommentAttachments([{ ...attachment, imageAttachments: [image] }]);
    expect(normalized[0]?.motion).toEqual(motion);
    const prompt = renderCommentAttachmentHint(normalized);
    expect(prompt).toContain('motionReferenceTime: 2.4s / 8s');
    expect(prompt).toContain('motionSourceFingerprint: source-123');
    expect(prompt).toContain('motionFeedbackRange: 1s–5s');
    expect(prompt).toContain('not an enforced boundary');
    expect(prompt).toContain('captures/frame.png');
    expect(prompt).toContain('do not restrict the requested change to one frame');
  });
});
