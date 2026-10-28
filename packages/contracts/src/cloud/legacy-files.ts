import { z } from "zod";

// Original client ProjectFilesResponse (packages/contracts/src/api/files.ts).
// Runtime directory metadata has no filesystem mtime; the compatibility layer
// supplies the project's last persisted activity time as a refresh witness.
export const legacyFile = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  type: z.enum(["file", "dir"]),
  size: z.number().int().nonnegative().safe(),
  mtime: z.number().finite().nonnegative(),
  kind: z.enum([
    "html",
    "image",
    "video",
    "audio",
    "text",
    "code",
    "pdf",
    "binary",
  ]),
  mime: z.string(),
});
export const legacyFiles = z.object({ files: z.array(legacyFile) });

// Original exportProjectAsHtml request. Historical snapshots are rejected until
// the Runtime supplies versioned content; never export current content as history.
export const legacyHtmlExport = z
  .object({
    fileName: z.string().min(1).max(4096),
    title: z.string().max(512).optional(),
    versionId: z.string().min(1).max(256).optional(),
  })
  .strict();
