import JSZip from "jszip";
import { BizError as AppError } from "../errors.js";

export function exportPath(value: string) {
  if (
    !value ||
    value.length > 4096 ||
    /[:\\\u0000-\u001f\u007f]/.test(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new AppError("invalid_export_path", "导出文件路径无效");
  return value;
}
export async function zipFiles(files: Array<{ path: string; bytes: Buffer }>) {
  if (!files.length) throw new AppError("export_empty", "没有可导出的文件");
  if (
    files.length > 10000 ||
    files.reduce((sum, file) => sum + file.bytes.length, 0) > 100 * 1024 * 1024
  )
    throw new AppError("export_too_large", "导出资源超过 100 MiB 或文件数限制");
  const zip = new JSZip(),
    seen = new Set<string>();
  for (const file of files) {
    exportPath(file.path);
    if (seen.has(file.path))
      throw new AppError("duplicate_export_path", "文件目录存在重复路径");
    seen.add(file.path);
    zip.file(file.path, file.bytes, {
      date: new Date("2026-01-01T00:00:00Z"),
      createFolders: false,
    });
  }
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
