import type Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import type { StandaloneConversation, CreateStandaloneConversationRequest } from '@open-design/contracts';
import { getConversation, insertConversation } from '../db.js';
import { requestWithWorkspaceNavigationScope, workspaceResourceContextFromRequest, type VerifyWorkspaceRequestAuthority } from '../collab/workspace-resource-mutation.js';
import type { RunWorkspaceScope } from '../runtimes/project-amr-trace-env.js';

type Scope = { workspaceId: string | null; workspaceMemberId: string | null };
type Result = { ok: true; scope: Scope } | { ok: false };
export interface StandaloneConversationServiceDeps {
  db: Database.Database;
  runtimeDataDir: string;
  verifyRead: VerifyWorkspaceRequestAuthority;
  verifyWrite: VerifyWorkspaceRequestAuthority;
}
export class StandaloneConversationService {
  constructor(private readonly deps: StandaloneConversationServiceDeps) {}
  get(id: string): StandaloneConversation | null {
    const conversation = getConversation(this.deps.db, id);
    if (!conversation || conversation.projectId !== null || !this.scope(id)) return null;
    return conversation as StandaloneConversation;
  }
  scope(id: string): Scope | null {
    return (this.deps.db.prepare(`SELECT workspace_id AS workspaceId, workspace_member_id AS workspaceMemberId
      FROM standalone_conversation_scopes WHERE conversation_id = ?`).get(id) as Scope | undefined) ?? null;
  }
  async requestScope(req: Request, res: Response, write: boolean): Promise<Result> {
    let request = req;
    if (typeof req.params.viewWorkspaceId === 'string' && typeof req.params.viewMemberId === 'string') {
      const workspaceId = req.params.viewWorkspaceId;
      const workspaceMemberId = req.params.viewMemberId;
      if ((req.query.workspaceId && req.query.workspaceId !== workspaceId)
        || (req.query.workspaceMemberId && req.query.workspaceMemberId !== workspaceMemberId)) {
        res.status(400).json({ error: { code: 'WORKSPACE_CONTEXT_CONFLICT', message: 'workspace path and query must match' } });
        return { ok: false };
      }
      // Scope in the URL prefix survives every relative HTML/CSS asset request.
      request = Object.create(req) as Request;
      Object.defineProperty(request, 'query', { value: { ...req.query, workspaceId, workspaceMemberId } });
    }
    const scoped = requestWithWorkspaceNavigationScope(request);
    const fail = (status: number, code: string, message: string): Result => {
      res.status(status).json({ error: { code, message } }); return { ok: false };
    };
    if (scoped === 'conflict') return fail(400, 'WORKSPACE_CONTEXT_CONFLICT', 'workspace scope conflicts');
    const claim = workspaceResourceContextFromRequest(scoped);
    if (claim === null) return { ok: true, scope: { workspaceId: null, workspaceMemberId: null } };
    if (claim === 'missing') return fail(400, 'WORKSPACE_CONTEXT_REQUIRED', 'workspace and member are required');
    const result = await (write ? this.deps.verifyWrite : this.deps.verifyRead)(scoped);
    if (!result.ok) return fail(result.status, result.code, result.message);
    const context = result.context;
    if (context.memberStatus !== 'active' || (write && context.lifecycleState !== 'active' && context.lifecycleState !== 'billing_past_due')) {
      return fail(403, 'WORKSPACE_ACCESS_DENIED', 'workspace is not writable');
    }
    return { ok: true, scope: { workspaceId: context.workspaceId, workspaceMemberId: context.workspaceMemberId } };
  }
  async authorize(req: Request, res: Response, id: string, write: boolean): Promise<boolean> {
    const result = await this.requestScope(req, res, write);
    if (!result.ok) return false;
    const scope = this.scope(id);
    if (!this.get(id) || !scope || scope.workspaceId !== result.scope.workspaceId || scope.workspaceMemberId !== result.scope.workspaceMemberId) {
      res.status(404).json({ error: { code: 'CONVERSATION_NOT_FOUND', message: 'conversation not found' } });
      return false;
    }
    return true;
  }
  list(scope: Scope): StandaloneConversation[] {
    const rows = this.deps.db.prepare(`SELECT c.id FROM conversations c JOIN standalone_conversation_scopes s ON s.conversation_id = c.id
      WHERE c.project_id IS NULL AND s.workspace_id IS ? AND s.workspace_member_id IS ? ORDER BY c.updated_at DESC, c.id`).all(scope.workspaceId, scope.workspaceMemberId) as Array<{id: string}>;
    return rows.map(({id}) => this.get(id)).filter((value): value is StandaloneConversation => value !== null);
  }
  create(scope: Scope, input: CreateStandaloneConversationRequest): StandaloneConversation {
    const id = randomUUID();
    const now = Date.now();
    this.deps.db.transaction(() => {
      insertConversation(this.deps.db, { id, projectId: null, title: input.title ?? null, sessionMode: input.sessionMode ?? 'design', createdAt: now, updatedAt: now });
      this.deps.db.prepare('INSERT INTO standalone_conversation_scopes (conversation_id, workspace_id, workspace_member_id) VALUES (?, ?, ?)').run(id, scope.workspaceId, scope.workspaceMemberId);
    })();
    return this.get(id)!;
  }
  pinRunScope(id: string): RunWorkspaceScope {
    const scope = this.scope(id);
    if (!scope || !this.get(id)) throw new Error('Standalone conversation not found');
    return Object.freeze({ schemaVersion: 1, projectId: null, conversationId: id, ...scope, source: 'persisted_standalone_binding' });
  }
  async ensureWorkspace(id: string): Promise<string> {
    if (!this.get(id) || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Standalone conversation not found');
    const root = path.resolve(this.deps.runtimeDataDir);
    const parent = path.join(root, 'conversations');
    await mkdir(parent, { recursive: true });
    if ((await lstat(parent)).isSymbolicLink()) throw new Error('Unsafe conversation workspace');
    const workspace = path.join(parent, id);
    await mkdir(workspace, { recursive: true });
    const realRoot = await realpath(root);
    const realWorkspace = await realpath(workspace);
    if (!(realWorkspace.startsWith(realRoot + path.sep)) || (await lstat(path.dirname(workspace))).isSymbolicLink() || (await lstat(workspace)).isSymbolicLink()) throw new Error('Unsafe conversation workspace');
    return realWorkspace;
  }
  async resolveFile(id: string, name: string): Promise<string> {
    if (!name || name.includes('\\') || name.split('/').some((part) => !part || part.startsWith('.')) || path.isAbsolute(name)) throw new Error('Invalid file path');
    const root = await this.ensureWorkspace(id);
    const file = await realpath(path.resolve(root, name));
    if (!file.startsWith(root + path.sep)) throw new Error('File escapes conversation workspace');
    if (path.relative(root, file).split(path.sep).some((part) => part.startsWith('.'))) throw new Error('Hidden file is not available');
    return file;
  }
}
