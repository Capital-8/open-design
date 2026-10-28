import { db, file } from "@open-design/bridge";
import { fileReference, prepareSave, finishSave } from "@open-design/biz/files";
import { Attachments } from "@open-design/biz/files/attachments";
import { BizError } from "@open-design/biz/errors";
import type { ProjectAccess } from "../projects/index.js";
import { externalFailure } from "../projects/index.js";
export function createFileFacade() {
  const attachments = new Attachments();
  return {
    activity: async (a: ProjectAccess) =>
      Date.parse((await db.read().projects.activity(a.p.id)) ?? a.p.created_at),
    read: (a: ProjectAccess) => file.readContent(fileReference(a.p, a.scope)),
    raw: async (a: ProjectAccess, path: string) =>
      Buffer.from(await file.read(fileReference(a.p, a.scope, path))),
    directory: (a: ProjectAccess, cursor: string) =>
      file.directory(fileReference(a.p, a.scope), cursor),
    upload: (a: ProjectAccess, batch: { name: string; bytes: Buffer }[]) =>
      attachments.save(a.user, a.p.id, batch),
    attachment: (a: ProjectAccess, path: string) =>
      attachments.read(a.user, a.p.id, path),
    attachments: (a: ProjectAccess) => attachments.list(a.user, a.p.id),
    async save(a: ProjectAccess, html: string, expected: string) {
      const intent = await prepareSave(
        a.user.id,
        a.p.id,
        a.scope.workspaceId,
        html,
        expected,
      );
      let result;
      try {
        result = await file.saveContent(
          fileReference(intent.project, a.scope),
          { html, expected },
        );
      } catch (error) {
        const failure = externalFailure(error);
        await finishSave(
          a.p.id,
          intent.token,
          failure.uncertain ? "unknown" : "rejected",
        );
        if (failure.uncertain) throw new BizError("write_unconfirmed");
        throw error;
      }
      // A local commit failure after a successful write is not a remote write failure.
      await finishSave(a.p.id, intent.token, "confirmed");
      return result;
    },
  };
}
export type FileFacade = ReturnType<typeof createFileFacade>;
