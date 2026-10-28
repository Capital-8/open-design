import { z } from "zod";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 12;
export const uploadedFiles = z.object({
  files: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      originalName: z.string(),
      size: z.number().int().nonnegative(),
      mtime: z.number(),
    }),
  ),
});
