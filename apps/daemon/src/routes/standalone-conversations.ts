import type { Express, Request, RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { CHAT_RUN_STATUSES, type ChatRunStatus, type CreateStandaloneConversationRequest, type StandaloneConversation } from '@open-design/contracts';
import { deleteConversation, listMessages, updateConversation } from '../db.js';
import { listWorkspaceFiles } from '../projects.js';
import { StandaloneConversationService } from '../storage/standalone-conversations.js';
import { cancelRunsOwnedBy } from './project/cancel-owned-runs.js';

export interface RegisterStandaloneConversationRoutesDeps {
  db: Database.Database;
  standaloneConversations: StandaloneConversationService;
  design: { runs: Parameters<typeof cancelRunsOwnedBy>[0] };
  /** Live trusted web/daemon origins supplied by the server composition root. */
  previewOrigins?: () => readonly string[];
}
function validInput(value: unknown): value is CreateStandaloneConversationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).every((key) => key === 'title' || key === 'sessionMode')
    && (input.title === undefined || input.title === null || (typeof input.title === 'string' && input.title.length <= 500))
    && (input.sessionMode === undefined || (typeof input.sessionMode === 'string' && ['chat', 'design', 'plan'].includes(input.sessionMode)));
}
export function registerStandaloneConversationRoutes(app: Express, ctx: RegisterStandaloneConversationRoutesDeps): void {
  const service = ctx.standaloneConversations;
  const withRunStatus = (conversation: StandaloneConversation): StandaloneConversation => {
    const latest = ctx.design.runs.list({ conversationId: conversation.id })
      .filter((run): run is { status: ChatRunStatus; createdAt: number } => {
        if (!run || typeof run !== 'object') return false;
        const value = run as Record<string, unknown>;
        return typeof value.createdAt === 'number'
          && CHAT_RUN_STATUSES.includes(value.status as ChatRunStatus);
      }).sort((a, b) => b.createdAt - a.createdAt)[0];
    return latest ? { ...conversation, runStatus: latest.status } : conversation;
  };
  const authorize = (write: boolean): RequestHandler => async (req, res, next) => {
    if (await service.authorize(req, res, String(req.params.id), write)) next();
  };
  app.get('/api/conversations', async (req, res) => {
    const result = await service.requestScope(req, res, false);
    if (result.ok) res.json({ conversations: service.list(result.scope).map(withRunStatus) });
  });
  app.post('/api/conversations', async (req, res) => {
    if (!validInput(req.body)) { res.status(400).json({ error: 'invalid conversation input' }); return; }
    const result = await service.requestScope(req, res, true);
    if (result.ok) res.status(201).json({ conversation: service.create(result.scope, req.body) });
  });
  app.get('/api/conversations/:id', authorize(false), (req, res) => res.json({ conversation: withRunStatus(service.get(String(req.params.id))!) }));
  app.patch('/api/conversations/:id', authorize(true), (req, res) => {
    if (!validInput(req.body)) { res.status(400).json({ error: 'invalid conversation input' }); return; }
    updateConversation(ctx.db, String(req.params.id), req.body);
    res.json({ conversation: withRunStatus(service.get(String(req.params.id))!) });
  });
  app.delete('/api/conversations/:id', authorize(true), async (req, res) => {
    await cancelRunsOwnedBy(ctx.design.runs, { conversationId: String(req.params.id) });
    // Retain generated files on deletion, matching recoverable user-data handling.
    deleteConversation(ctx.db, String(req.params.id));
    res.json({ ok: true });
  });
  app.get('/api/conversations/:id/messages', authorize(false), (req, res) => res.json({ messages: listMessages(ctx.db, String(req.params.id)) }));
  app.get('/api/conversations/:id/files', authorize(false), async (req, res) => {
    res.json({ files: await listWorkspaceFiles(await service.ensureWorkspace(String(req.params.id))) });
  });
  app.get('/api/conversations/:id/files/raw', authorize(false), async (req, res) => {
    try {
      const file = await service.resolveFile(String(req.params.id), typeof req.query.path === 'string' ? req.query.path : '');
      // Generated HTML has no daemon-origin privileges when opened directly.
      res.setHeader('Content-Security-Policy', "sandbox allow-scripts; default-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline' https:; connect-src https:; form-action 'none'; base-uri 'none'; object-src 'none'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      // Ignore hidden ancestors of the configured data root, while denying
      // dotfiles inside the workspace through resolveFile and sendFile.
      res.sendFile(path.basename(file), { root: path.dirname(file), dotfiles: 'deny' });
    } catch { res.status(404).json({ error: 'file not found' }); }
  });
  // Opaque-origin HTML modules and fetches need CORS. Grant it only behind
  // an unguessable, expiring scope obtained by an authorized application read.
  const previewScopes = new Map<string, { id: string; workspaceId: string | null; workspaceMemberId: string | null; expiresAt: number }>();
  app.get('/api/conversations/:id/files/preview-scope', authorize(false), (req, res) => {
    const now = Date.now();
    for (const [token, scope] of previewScopes) if (scope.expiresAt <= now) previewScopes.delete(token);
    const id = String(req.params.id);
    const persisted = service.scope(id)!;
    let entry = [...previewScopes].find(([, scope]) => scope.id === id && scope.workspaceId === persisted.workspaceId && scope.workspaceMemberId === persisted.workspaceMemberId);
    if (!entry) {
      const token = randomUUID();
      const scope = { id, ...persisted, expiresAt: now + 30 * 60_000 };
      previewScopes.set(token, scope); entry = [token, scope];
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ baseUrl: `/api/conversations/${encodeURIComponent(id)}/files/preview/${entry[0]}/`, expiresAt: entry[1].expiresAt });
  });
  const preview: RequestHandler = async (req, res) => {
    try {
      const parts = req.params.filePath;
      const name = Array.isArray(parts) ? parts.join('/') : String(parts ?? '');
      const file = await service.resolveFile(String(req.params.id), name);
      res.setHeader('Content-Security-Policy', `sandbox allow-scripts; default-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline' https:; connect-src https: ${res.locals.standalonePreviewConnect ?? ""}; form-action 'none'; base-uri 'none'; object-src 'none'`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      // Ignore hidden ancestors of the configured data root, while denying
      // dotfiles inside the workspace through resolveFile and sendFile.
      res.sendFile(path.basename(file), { root: path.dirname(file), dotfiles: 'deny' });
    } catch { res.status(404).json({ error: 'file not found' }); }
  };
  app.get('/api/conversations/:id/files/preview/:previewScope/*filePath', async (req, res, next) => {
    const token = String(req.params.previewScope);
    const scope = previewScopes.get(token);
    if (!scope || scope.id !== req.params.id || scope.expiresAt <= Date.now()) {
      res.status(404).json({ error: 'preview scope not found' }); return;
    }
    const scopedRequest = Object.create(req) as Request;
    Object.defineProperty(scopedRequest, 'query', { value: scope.workspaceId ? {
      ...req.query, workspaceId: scope.workspaceId, workspaceMemberId: scope.workspaceMemberId,
    } : req.query });
    if (!await service.authorize(scopedRequest, res, scope.id, false)) return;
    if (req.headers.origin === 'null') res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // The token path also fences fetch()/module data to this artifact tree.
    const previewPath = `/api/conversations/${encodeURIComponent(scope.id)}/files/preview/${token}/`;
    const origins = new Set([`${req.protocol}://${req.get('host')}`, ...(ctx.previewOrigins?.() ?? [])]);
    res.locals.standalonePreviewConnect = [...origins].map((origin) => `${origin}${previewPath}`).join(' ');
    return preview(req, res, next);
  });
  app.get('/api/conversations/:id/files/content/local/*filePath', authorize(false), preview);
  app.get('/api/conversations/:id/files/content/workspace/:viewWorkspaceId/:viewMemberId/*filePath', authorize(false), preview);
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, done) => { void service.ensureWorkspace(String(req.params.id)).then((dir) => { done(null, dir); }, (error: unknown) => { done(error instanceof Error ? error : new Error(String(error)), ''); }); },
      filename: (_req, file, done) => done(null, `${randomUUID()}-${path.basename(file.originalname).replace(/[^\p{L}\p{N}._-]/gu, '_').slice(-160) || 'attachment'}`),
    }),
    limits: { fileSize: 200 * 1024 * 1024, files: 12 },
  }).array('files', 12);
  app.post('/api/conversations/:id/upload', authorize(true), (req, res) => {
    upload(req, res, (error) => {
      const incoming = Array.isArray(req.files) ? req.files : [];
      if (error) {
        void Promise.all(incoming.map((file) => unlink(file.path).catch(() => {})));
        res.status(400).json({ error: 'upload failed' }); return;
      }
      updateConversation(ctx.db, String(req.params.id), {});
      res.json({ files: incoming.map((file) => ({ name: file.filename, path: file.filename, size: file.size, originalName: file.originalname })) });
    });
  });
}
