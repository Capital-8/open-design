import type { Express } from 'express';
import type { MotionStructureRequest } from '@open-design/contracts/api/motionStructure';
import type { AuthorizeProjectRequest } from '../../collab/project-request-authority.js';
import type { HttpDeps, PathDeps } from '../../server-context.js';
import { isProjectFileVersionPath } from '../../project-file-versions.js';
import { validateProjectPath, type readProjectFile, type resolveProjectFilePath } from '../../projects.js';
import { MOTION_STRUCTURE_MAX_SOURCE_BYTES, parseMotionStructure } from '../../services/motion-structure.js';

interface MotionStructureRouteDeps {
  db: unknown;
  http: Pick<HttpDeps, 'sendApiError'>;
  paths: Pick<PathDeps, 'PROJECTS_DIR'>;
  projectStore: { getProject: (db: unknown, id: string) => { id: string; metadata?: unknown } | null };
  projectFiles: { readProjectFile: typeof readProjectFile; resolveProjectFilePath: typeof resolveProjectFilePath };
  authorizeProjectRequest: AuthorizeProjectRequest;
}

/** Read authority and file boundaries are shared with the project-file surface. */
export function registerProjectMotionStructureRoutes(app: Express, ctx: MotionStructureRouteDeps): void {
  const { sendApiError } = ctx.http;
  app.post('/api/projects/:id/motion/structure', async (req, res) => {
    try {
      const project = ctx.projectStore.getProject(ctx.db, req.params.id);
      if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      if (!await ctx.authorizeProjectRequest(req, res, project.id, { mode: 'read' })) return;
      const body = req.body as Partial<MotionStructureRequest> | null;
      if (!body || typeof body.filePath !== 'string' || (body.source !== undefined && typeof body.source !== 'string')) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'filePath and optional source must be strings');
      }
      const filePath = validateProjectPath(body.filePath);
      if (isProjectFileVersionPath(filePath)) return sendApiError(res, 404, 'FILE_NOT_FOUND', 'file not found');
      if (!/\.html?$/iu.test(filePath)) return sendApiError(res, 400, 'BAD_REQUEST', 'Motion inspection requires an HTML file');
      if (body.source !== undefined && Buffer.byteLength(body.source, 'utf8') > MOTION_STRUCTURE_MAX_SOURCE_BYTES) {
        return sendApiError(res, 413, 'BAD_REQUEST', 'Motion source exceeds the 2 MiB inspection limit');
      }
      // Validate containment (including symlinks and imported-project visibility) even
      // when source is supplied. This does not read or replace the on-disk source.
      const target = await ctx.projectFiles.resolveProjectFilePath(ctx.paths.PROJECTS_DIR, project.id, filePath, project.metadata);
      let source = body.source;
      if (source === undefined) {
        if (target.size > MOTION_STRUCTURE_MAX_SOURCE_BYTES) {
          return sendApiError(res, 413, 'BAD_REQUEST', 'Motion source exceeds the 2 MiB inspection limit');
        }
        const file = await ctx.projectFiles.readProjectFile(ctx.paths.PROJECTS_DIR, project.id, filePath, project.metadata);
        if (file.buffer.byteLength > MOTION_STRUCTURE_MAX_SOURCE_BYTES) {
          return sendApiError(res, 413, 'BAD_REQUEST', 'Motion source exceeds the 2 MiB inspection limit');
        }
        source = String(file.buffer.toString('utf8'));
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(parseMotionStructure(source));
    } catch (error) {
      const missing = (error as { code?: string })?.code === 'ENOENT';
      sendApiError(res, missing ? 404 : 400, missing ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        missing ? 'file not found' : 'Motion source could not be inspected');
    }
  });
}
