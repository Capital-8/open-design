import type { Express, Request, Response } from 'express';
import type { MotionEditorSaveRequest, MotionEditorPreviewRequest, ProjectMetadata } from '@open-design/contracts';
import type { AuthorizeProjectRequest } from '../../collab/project-request-authority.js';
import type { HttpDeps, PathDeps } from '../../server-context.js';
import { isProjectFileVersionPath } from '../../project-file-versions.js';
import { validateProjectPath, type readProjectFile, type resolveProjectFilePath } from '../../projects.js';
import { inspectMotionEditorSource, saveMotionEditorDocument, previewMotionEditorDocument, verifyMotionEditorRuntime, MotionEditorError, MOTION_EDITOR_MAX_BYTES } from '../../services/motion-editor.js';

import { publicFileMutationHandler } from '../public-file-mutation-handler.js';
import type { PublicFileMutations } from '../../collab/public-file-mutations.js';

interface Deps {
  publicFileMutations?: PublicFileMutations;
  db: unknown;
  http: Pick<HttpDeps, 'sendApiError'>;
  paths: Pick<PathDeps, 'PROJECTS_DIR'>;
  projectStore: { getProject: (db: unknown, id: string) => { id: string; metadata?: ProjectMetadata } | null };
  projectFiles: { readProjectFile: typeof readProjectFile; resolveProjectFilePath: typeof resolveProjectFilePath };
  authorizeProjectRequest: AuthorizeProjectRequest;
  isProjectEditingBusy?: (projectId: string) => boolean;
}

export function registerProjectMotionEditorRoutes(app: Express, ctx: Deps): void {
  for (const operation of ['read', 'preview', 'save'] as const) {
    const handler = async (req: Request, res: Response) => {
      const { sendApiError } = ctx.http;
      try {
        const project = ctx.projectStore.getProject(ctx.db, typeof req.params.id === 'string' ? req.params.id : '');
        if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
        if (!await ctx.authorizeProjectRequest(req, res, project.id, operation !== 'save' ? { mode: 'read' } : { mode: 'write', capability: 'writeFiles' })) return;
        if (project.metadata?.kind !== 'video' || project.metadata.intent !== 'motion-design') {
          return operation === 'read' ? res.json({ supported: false, reason: 'Direct motion editing is available only for Motion tasks.' })
            : sendApiError(res, 400, 'MOTION_TASK_REQUIRED', 'Direct motion editing requires a Motion task.');
        }
        if (!req.body || typeof req.body.filePath !== 'string'
          || (req.body.label !== undefined && typeof req.body.label !== 'string')) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'filePath and optional label must be strings');
        }
        const filePath = validateProjectPath(req.body.filePath);
        if (isProjectFileVersionPath(filePath)) return sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
        if (!/\.html?$/iu.test(filePath)) return sendApiError(res, 400, 'BAD_REQUEST', 'Motion editing requires an HTML file');
        const target = await ctx.projectFiles.resolveProjectFilePath(ctx.paths.PROJECTS_DIR, project.id, filePath, project.metadata);
        if (target.size > MOTION_EDITOR_MAX_BYTES) return sendApiError(res, 413, 'BAD_REQUEST', 'Motion source exceeds the editing limit');
        res.setHeader('Cache-Control', 'no-store');
        if (operation === 'read') {
          const file = await ctx.projectFiles.readProjectFile(ctx.paths.PROJECTS_DIR, project.id, filePath, project.metadata);
          const result = inspectMotionEditorSource(file.buffer.toString('utf8'));
          if (result.supported && !await verifyMotionEditorRuntime(ctx.paths.PROJECTS_DIR, project.id, filePath, project.metadata)) return res.json({ supported: false, reason: 'The composition requires the supported local GSAP runtime.' });
          return res.json(result);
        }
        if (operation === 'preview') return res.json(await previewMotionEditorDocument(ctx.paths.PROJECTS_DIR, project.id, filePath,
          req.body as MotionEditorPreviewRequest, project.metadata));
        return res.json(await saveMotionEditorDocument(ctx.paths.PROJECTS_DIR, project.id, filePath,
          req.body as MotionEditorSaveRequest, project.metadata, () => ctx.isProjectEditingBusy?.(project.id) ?? true));
      } catch (error) {
        if (error instanceof MotionEditorError) return sendApiError(res, error.status, error.code, error.message);
        const missing = (error as { code?: string })?.code === 'ENOENT';
        return sendApiError(res, missing ? 404 : 400, missing ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
          missing ? 'file not found' : 'The motion operation could not be completed. Reload before retrying.');
      }
    };
    app.post(`/api/projects/:id/motion/editor/${operation}`, operation === 'save' ? publicFileMutationHandler(ctx.publicFileMutations, handler) : handler);
  }
}
