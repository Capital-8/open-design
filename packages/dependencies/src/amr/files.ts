import { z } from "zod";
import { DependencyError } from "../error.js";
import {
  createRuntimeHttp,
  parse,
  projectPath,
} from "./internal/runtime-http.js";
import type { AmrAuthorization, AmrRuntimeClientOptions } from "./types.js";
const contentSchema = z.object({
  path: z.literal("index.html"),
  html: z.string(),
  version: z.string(),
  modified: z.string().datetime({ offset: true }).optional(),
});
export function createAmrFileClient(options: AmrRuntimeClientOptions) {
  const { request, response } = createRuntimeHttp(options);
  return {
    async readContent(authorize: AmrAuthorization, project: string) {
      return parse(
        contentSchema,
        await request(authorize, projectPath(project) + "/files/index.html"),
        false,
      );
    },
    async saveContent(
      authorize: AmrAuthorization,
      project: string,
      html: string,
      expected: string,
    ) {
      return parse(
        contentSchema,
        await request(
          authorize,
          projectPath(project) + "/files/index.html",
          "PUT",
          { html, expected },
        ),
        true,
      );
    },
    async directory(
      authorize: AmrAuthorization,
      project: string,
      cursor: string,
    ) {
      return parse(
        z.object({
          cursor: z.string(),
          files: z.array(
            z.object({
              path: z.string().min(1),
              kind: z.string(),
              size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
            }),
          ),
        }),
        await request(
          authorize,
          projectPath(project) +
            "/directory?" +
            new URLSearchParams({ cursor }),
        ),
        false,
      );
    },
    async raw(authorize: AmrAuthorization, project: string, path: string) {
      const result = await response(
        authorize,
        projectPath(project) + "/raw/" + encodeURIComponent(path),
        {},
        AbortSignal.timeout(45000),
      );
      const reader = result.body?.getReader();
      if (!reader) throw new DependencyError("runtime_protocol_error");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > 33554432)
            throw new DependencyError("runtime_file_too_large");
          chunks.push(next.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    },
  };
}
