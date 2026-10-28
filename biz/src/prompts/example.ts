import { createHash } from "node:crypto";
import { z } from "zod";
import { defaultBundledCatalog } from "../catalog/index.js";
import { exampleReference } from "@open-design/contracts/cloud/legacy-chat";
import { BizError as AppError } from "../errors.js";

const hash = (text: string | Buffer) =>
  createHash("sha256").update(text).digest("hex");
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const bindingSchema = z
  .object({
    schemaVersion: z.literal(1),
    pluginId: z.string(),
    pluginSource: z.string(),
    manifestSourceDigest: digest,
    boundAt: z.number(),
  })
  .strict();
const contentSchema = z
  .object({
    title: z.string(),
    briefs: z.record(z.string()),
    files: z
      .array(
        z
          .object({
            path: z.string(),
            content: z.string(),
            sha256: digest,
          })
          .strict(),
      )
      .max(32),
    unavailableAssets: z.array(z.string()).max(128),
  })
  .strict();
const snapshotSchema = z
  .object({
    content: contentSchema,
    sha256: digest,
  })
  .strict();
const invalid = (message: string) =>
  new AppError("invalid_example_reference", message);

// PostgreSQL JSONB reorders object keys. All other fields have schema-fixed
// order; normalize the dynamic locale map before hashing a new snapshot.
function snapshotDigest(content: z.infer<typeof contentSchema>) {
  return hash(
    JSON.stringify({
      ...content,
      briefs: Object.fromEntries(
        Object.entries(content.briefs).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      ),
    }),
  );
}

export function readExample(metadata: Record<string, unknown>) {
  if (!("exampleBinding" in metadata) && !("exampleContent" in metadata))
    return undefined;
  const binding = bindingSchema.safeParse(metadata.exampleBinding);
  const snapshot = snapshotSchema.safeParse(metadata.exampleContent);
  if (
    !binding.success ||
    !snapshot.success ||
    (snapshotDigest(snapshot.data.content) !== snapshot.data.sha256 &&
      // Continue accepting snapshots written before locale normalization.
      hash(JSON.stringify(snapshot.data.content)) !== snapshot.data.sha256) ||
    snapshot.data.content.files.some((f) => hash(f.content) !== f.sha256)
  )
    throw new AppError(
      "example_binding_invalid",
      "项目示例记录无效，请重新创建项目",
    );
  return { binding: binding.data, snapshot: snapshot.data };
}

// Identity is the only client input. Never read source as a filesystem path or
// fetch it as a URL. Freeze verified bundled text so restarts/resource upgrades
// cannot silently change the example used by an existing project.
export async function bindExample(
  reference: z.infer<typeof exampleReference> | undefined,
  previous?: Record<string, unknown>,
) {
  if (!reference) return {};
  const old = previous ? readExample(previous) : undefined;
  if (old) {
    if (
      old.binding.pluginId !== reference.pluginId ||
      old.binding.pluginSource !== reference.source
    )
      throw new AppError("conflict", "项目已绑定其他示例");
    return { exampleBinding: old.binding, exampleContent: old.snapshot };
  }
  const catalog = defaultBundledCatalog();
  const plugin = await catalog.plugin(reference.pluginId);
  if (
    plugin.source !== reference.source ||
    plugin.sourceKind !== "bundled" ||
    plugin.trust !== "bundled" ||
    !plugin.id.startsWith("example-")
  )
    throw invalid("示例必须与内置官方目录的 ID 和来源一致");
  const manifestBytes = await catalog.asset(
    "plugin",
    plugin.id,
    "open-design.json",
  );
  if (hash(manifestBytes) !== plugin.sourceDigest)
    throw new AppError("bundled_resource_changed", "示例清单校验失败");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const od = manifest.od ?? {};
  const pathValue = (value: unknown) => {
    if (typeof value !== "string" || !value) throw invalid("示例资源声明无效");
    return value.replace(/^\.\//, "");
  };
  const skillPaths: string[] = [];
  const unavailableAssets: string[] = [];
  for (const skill of od.context?.skills ?? []) {
    if (skill.path !== undefined) skillPaths.push(pathValue(skill.path));
    else if (typeof skill.ref === "string" && skill.ref.trim()) {
      // A shared skill reference is not a plugin-local path. This text-only
      // adapter does not stage its dependency tree; disclose it explicitly.
      unavailableAssets.push(`skill:${skill.ref}`);
    } else throw invalid("示例技能声明无效");
  }
  const paths = new Set<string>([
    ...skillPaths,
    ...(od.context?.assets ?? []).map(pathValue),
    ...(od.useCase?.exampleOutputs ?? []).map((s: { path: unknown }) =>
      pathValue(s.path),
    ),
  ]);
  if (!paths.size) throw invalid("示例未声明可交付的参考内容");
  if (paths.size > 32) throw invalid("示例资源数量超过 32 个");
  const files = [];
  const inventory = await catalog.files("plugin", plugin.id);
  for (const path of paths) {
    const entry = inventory.find((f) => f.path === path);
    if (!entry) throw invalid(`示例资源未收录：${path}`);
    if (!/\.(md|txt|html?|css|js|json|svg)$/i.test(path)) {
      unavailableAssets.push(path);
      continue;
    }
    if (entry.size > 96 * 1024) throw invalid("示例文本超过 96 KiB");
    const bytes = await catalog.asset("plugin", plugin.id, path);
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw invalid(`示例资源不是 UTF-8 文本：${path}`);
    }
    files.push({ path, content, sha256: hash(content) });
  }
  if (!files.length) throw invalid("示例没有可供模型读取的文本");
  const defaults = new Map<string, string>();
  for (const field of od.inputs ?? []) {
    if (
      typeof field.name === "string" &&
      ["string", "number", "boolean"].includes(typeof field.default)
    )
      defaults.set(field.name, String(field.default));
  }
  const query = od.useCase?.query ?? {};
  const briefs: Record<string, string> = {};
  for (const [locale, text] of Object.entries(
    typeof query === "string" ? { en: query } : query,
  )) {
    if (typeof text === "string")
      briefs[locale] = text.replace(
        /\{\{\s*([^{}]+?)\s*\}\}/g,
        (match, name: string) => defaults.get(name) ?? match,
      );
  }
  const content = { title: plugin.title, briefs, files, unavailableAssets };
  // Budget the JSON representation actually sent to the model, not just bytes
  // on disk. Oversized examples fail explicitly rather than losing their tail.
  // New multilingual Motion examples reach 99,384 bytes. Keep individual
  // files capped at 96 KiB and the complete run capped at 256 KiB.
  if (Buffer.byteLength(JSON.stringify(content)) > 128 * 1024)
    throw invalid("示例参考内容超过 128 KiB");
  return {
    exampleBinding: {
      schemaVersion: 1,
      pluginId: plugin.id,
      pluginSource: plugin.source,
      manifestSourceDigest: plugin.sourceDigest,
      boundAt: Date.now(),
    },
    exampleContent: { content, sha256: snapshotDigest(content) },
  };
}
