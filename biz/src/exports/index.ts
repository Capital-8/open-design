import { z } from "zod";
import { legacyHtmlExport } from "@open-design/contracts/cloud/legacy-files";
import { renderRequest } from "@open-design/contracts/cloud/render";
import type { RenderFormat } from "@open-design/bridge";
import { BizError } from "../errors.js";
import { exportPath } from "./archive.js";
export { zipFiles, exportPath } from "./archive.js";
export const exportInput = legacyHtmlExport
  .extend({
    deck: z.boolean().optional(),
    editable: z.boolean().optional(),
    index: z.number().int().nonnegative().optional(),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
  })
  .strict();
export function requireCurrent(version: unknown) {
  if (version !== undefined) throw new BizError("runtime_history_unavailable");
}
export function readable(path: string) {
  return (
    path === "index.html" ||
    path.startsWith(".attachments/") ||
    !path.includes("/")
  );
}
export function prepareExport(
  format: RenderFormat | "html",
  input: unknown,
  bytes: Uint8Array,
) {
  const parsed = (format === "html" ? legacyHtmlExport : exportInput).safeParse(
    input,
  );
  if (!parsed.success) throw new BizError("invalid_export");
  const value = parsed.data as z.infer<typeof exportInput>;
  requireCurrent(value.versionId);
  exportPath(value.fileName);
  if (!/\.html?$/i.test(value.fileName))
    throw new BizError("unsupported_export_source");
  let html: string;
  try {
    html = new TextDecoder("utf8", { fatal: true }).decode(bytes);
  } catch {
    throw new BizError("unsupported_export_source");
  }
  if (format === "html") return { value, render: null };
  if (!html.trim()) throw new BizError("empty_export_source");
  const request = renderRequest.safeParse({
    html,
    format,
    deck: value.deck ?? format === "pptx",
    editable: value.editable ?? false,
    index: value.index,
    width: value.width,
    height: value.height,
  });
  if (!request.success) throw new BizError("invalid_export");
  return { value, render: request.data };
}
export function archiveSelection(
  inventory: Map<string, number>,
  input: { files?: string[]; root?: string },
) {
  const selected = new Set<string>();
  if (input.files) {
    for (const raw of input.files) {
      const path = exportPath(raw),
        matches = [...inventory.keys()].filter(
          (p) => p === path || p.startsWith(path + "/"),
        );
      if (!matches.length) throw new BizError("resource_unavailable");
      for (const match of matches) selected.add(match);
    }
  } else {
    const root = input.root ? exportPath(input.root) : "";
    for (const path of inventory.keys())
      if (!root || path.startsWith(root + "/")) selected.add(path);
  }
  const paths = [...selected];
  if (paths.some((path) => !readable(path)))
    throw new BizError("runtime_file_read_unavailable");
  if (
    paths.length > 10000 ||
    paths.reduce((n, path) => n + inventory.get(path)!, 0) > 100 * 1024 * 1024
  )
    throw new BizError("export_too_large");
  return paths;
}
