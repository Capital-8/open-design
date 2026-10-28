/** Temporary external-service boundary for local CI. This is NOT the AMR Viewer UI,
 * Vela Go CLI, or server implementation; only OD Web/daemon run as product code. */
import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { SHARE_FIXTURE_KEY, SHARE_FIXTURE_CERT } from '../../resources/share-mainline.js';

type Resource = { snapshotDir: string; version: number; versions: Map<number, string>; ownerMemberId: string };
type Project = { ownerMemberId: string; metadata: Record<string, unknown> | null };
type Publication = { projectId: string; slug: string; resourceId: string; version: number; versionId: string; entryPath: string; sourceFilePath: string; sourceFileId: string; publishedAt: number; status: 'active' | 'stopped' };
const flag = (args: string[], name: string) => args[args.indexOf(name) + 1] ?? '';
export async function startPublicShareFixture(input: {
  resource: (id: string) => Resource | undefined;
  project: (id: string) => Project | undefined;
}) {
  const publications = new Map<string, Publication>();
  const requests: Array<{ path: string; status: number }> = [];
  const server = createServer({ key: SHARE_FIXTURE_KEY, cert: SHARE_FIXTURE_CERT }, async (req, res) => {
    try {
      const path = new URL(req.url ?? '/', 'https://localhost').pathname;
      const parts = /^\/artifact\/([^/]+)\/([^/]+)\/(.*)$/.exec(path + (path.split('/').length === 4 ? '/' : ''));
      const pub = parts && publications.get(parts[2]!);
      if (!pub || pub.projectId !== parts?.[1]) { requests.push({ path, status: 404 }); res.writeHead(404).end('not found'); return; }
      if (pub.status !== 'active') { requests.push({ path, status: 410 }); res.writeHead(410).end('share stopped'); return; }
      // Redirect to slash so the actual uploaded HTML resolves relative assets.
      if (path === `/artifact/${pub.projectId}/${pub.slug}`) { res.writeHead(302, { location: path + '/' }).end(); return; }
      const resource = input.resource(pub.resourceId);
      const snapshot = resource?.versions.get(Number(pub.versionId.slice(1)));
      if (!snapshot) throw new Error('missing immutable snapshot');
      const relative = decodeURIComponent(parts![3] || pub.entryPath);
      const file = resolve(snapshot, relative);
      if (!file.startsWith(resolve(snapshot) + sep)) { res.writeHead(403).end(); return; }
      const body = await readFile(file);
      const mime: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
      requests.push({ path, status: 200 });
      res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
    } catch { res.writeHead(404).end('not found'); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('no fixture port');
  const origin = `https://127.0.0.1:${address.port}`;
  const command = (args: string[], memberId: string): string | undefined => {
    if (args[0] !== 'share') return;
    const op = args[1];
    const projectId = op === 'project-status' ? args[2]! : flag(args, '--project-id');
    const project = input.project(projectId);
    if (!project && op === 'project-status') return JSON.stringify({ projectId, bindingExists: false, publications: [] });
    if (!project || project.ownerMemberId !== memberId) throw new Error('share_owner_required');
    const list = [...publications.values()].filter(pub => pub.projectId === projectId);
    if (op === 'project-status') return JSON.stringify({ projectId, bindingExists: list.length > 0, publications: list.map(pub => ({ sourceFilePath: pub.sourceFilePath, sourceFileId: pub.sourceFileId, slug: pub.slug, status: pub.status, url: `${origin}/artifact/${projectId}/${pub.slug}` })) });
    const slug = op === 'publish' ? flag(args, '--slug') : args[2]!;
    let pub = publications.get(slug);
    if (op === 'publish') {
      const resourceId = args[2]!; const resource = input.resource(resourceId);
      const sourceFilePath = flag(args, '--source-file-path');
      const state = project.metadata?._commentFiles as { files?: Array<{ sourceFilePath: string; sourceFileId: string }> } | undefined;
      const fact = state?.files?.find(f => f.sourceFilePath === sourceFilePath);
      const versionId = flag(args, '--version-id');
      if (!resource || resource.ownerMemberId !== memberId || !fact || !resource.versions.has(Number(versionId.slice(1)))) throw new Error('unverified_publish');
      pub = { projectId, slug, resourceId, version: (pub?.version ?? 0) + 1, versionId, entryPath: flag(args, '--entry-path'), sourceFilePath, sourceFileId: fact.sourceFileId, publishedAt: Date.now(), status: 'active' };
      publications.set(slug, pub);
      return JSON.stringify({ ...pub, status: 'published', snapshot: { versionId }, receipt: { slug, versionId, entryPath: pub.entryPath, version: pub.version, publishedAt: pub.publishedAt }, url: `${origin}/artifact/${projectId}/${slug}` });
    }
    if (!pub || pub.projectId !== projectId) throw new Error('share_not_found');
    if (op === 'stop') pub.status = 'stopped';
    else if (op === 'resume-existing' || op === 'resume') pub.status = 'active';
    else if (op !== 'status' && op !== 'bind') throw new Error('unsupported share command');
    return JSON.stringify({ ...pub, bindingExists: true, shareStopped: pub.status === 'stopped', url: `${origin}/artifact/${projectId}/${slug}`, verifiedVersion: pub.version, verifiedVersionId: pub.versionId });
  };
  return { origin, command, requests, close: async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); } };
}
