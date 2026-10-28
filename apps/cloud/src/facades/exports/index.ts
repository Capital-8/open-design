import { render, type RenderFormat } from "@open-design/bridge";
import {
  prepareExport,
  archiveSelection,
  exportInput,
  requireCurrent,
  readable,
  zipFiles,
  exportPath,
} from "@open-design/biz/exports";
import { classification } from "@open-design/biz/files/metadata";
import { BizError } from "@open-design/biz/errors";
import type { FileFacade } from "../files/index.js";
import type { ProjectAccess } from "../projects/index.js";
export function createExportFacade(files: FileFacade) {
  async function read(a: ProjectAccess, path: string) {
    exportPath(path);
    if (path === "index.html") return Buffer.from((await files.read(a)).html);
    if (path.startsWith(".attachments/"))
      return (await files.attachment(a, path)).content;
    if (!path.includes("/")) return files.raw(a, path);
    throw new BizError("runtime_file_read_unavailable");
  }
  async function inventory(a: ProjectAccess) {
    const result = new Map<string, number>(),
      cursors = new Set<string>();
    let cursor = "";
    for (let page = 0; page < 100; page++) {
      if (cursors.has(cursor)) throw new BizError("runtime_protocol_error");
      cursors.add(cursor);
      const next = await files.directory(a, cursor);
      for (const value of next.files) {
        exportPath(value.path);
        if (value.kind !== "file") continue;
        if (result.has(value.path))
          throw new BizError("runtime_protocol_error");
        result.set(value.path, Number(value.size));
      }
      if (result.size > 10000) throw new BizError("export_too_large");
      if (!next.cursor) {
        for (const item of await files.attachments(a)) {
          if (result.has(item.path))
            throw new BizError("runtime_protocol_error");
          result.set(item.path, item.size);
        }
        return result;
      }
      cursor = next.cursor;
    }
    throw new BizError("runtime_protocol_error");
  }
  return {
    read,
    inventory,
    async export(
      a: ProjectAccess,
      format: RenderFormat | "html",
      input: unknown,
    ) {
      const parsed = exportInput.safeParse(input);
      if (!parsed.success) throw new BizError("invalid_export");
      requireCurrent(parsed.data.versionId);
      const bytes = await read(a, parsed.data.fileName),
        prepared = prepareExport(format, input, bytes);
      const result = prepared.render
        ? await render.render(prepared.render)
        : { bytes, mimeType: "text/html; charset=utf-8" };
      return {
        ...result,
        title: prepared.value.title ?? a.p.name,
        extension:
          format === "image" ? "png" : format === "pdf-image" ? "pdf" : format,
      };
    },
    async archive(
      a: ProjectAccess,
      input: { files?: string[]; root?: string; version?: unknown },
    ) {
      requireCurrent(input.version);
      const entries = await inventory(a),
        paths = archiveSelection(entries, input),
        values = [];
      let total = 0;
      for (const path of paths) {
        const bytes = await read(a, path);
        total += bytes.length;
        if (total > 100 * 1024 * 1024) throw new BizError("export_too_large");
        values.push({ path, bytes });
      }
      return zipFiles(values);
    },
    async manifest(a: ProjectAccess, version?: unknown) {
      requireCurrent(version);
      const entries = await inventory(a);
      return {
        schema: "open-design.project-export-manifest.v1",
        projectId: a.p.id,
        projectName: a.p.name,
        generatedAt: new Date().toISOString(),
        entryFile: entries.has("index.html") ? "index.html" : null,
        artifacts: [],
        artifactMetadataAvailable: false,
        files: [...entries].map(([path, size]) => ({
          name: path,
          path,
          size,
          type: "file",
          mtime: Date.parse(a.p.created_at),
          ...classification(path),
          included: readable(path),
          readable: readable(path),
          role: path === "index.html" ? "entry" : "other",
          reasons: [
            readable(path)
              ? "cloud-readable-file"
              : "runtime-file-read-unavailable",
          ],
        })),
        complete: [...entries.keys()].every(readable),
      };
    },
  };
}
export type ExportFacade = ReturnType<typeof createExportFacade>;
