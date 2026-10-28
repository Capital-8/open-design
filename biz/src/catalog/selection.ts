import { createHash } from "node:crypto";
import { z } from "zod";
import {
  officialCatalog,
  normalizeSelections,
  resourceKey,
  type ResourceSelection,
} from "./official.js";
import { defaultBundledCatalog } from "./index.js";
import { BizError as AppError } from "../errors.js";

import { contextPlugins } from "@open-design/contracts/cloud/legacy-chat";

const inputValues = z.record(
  z.union([z.string().max(16384), z.number().finite(), z.boolean()]),
);
const snapshotSchema = z
  .object({
    id: z.string().max(128),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    inputs: inputValues,
  })
  .strict();
export async function appliedPlugin(
  id: string,
  inputs: unknown = {},
  source?: unknown,
  locale?: unknown,
) {
  const catalog = await officialCatalog();
  const record = catalog.get({ type: "plugin", id });
  catalog.closure([record]);
  const bytes = await catalog.bytes(`${record.root}/open-design.json`);
  const manifest = JSON.parse(bytes.toString());
  const installed = await defaultBundledCatalog().plugin(id);
  if (source != null && source !== installed.source)
    throw new AppError("official_source_mismatch", "只能选择目录中的官方资源");
  const parsed = inputValues.safeParse(inputs);
  if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data)) > 16384)
    throw new AppError("invalid_plugin_inputs", "插件参数无效或过大");
  const values = {
    ...Object.fromEntries(
      (manifest.od?.inputs ?? [])
        .filter((field: any) => field.default !== undefined)
        .map((field: any) => [field.name, field.default]),
    ),
    ...parsed.data,
  };
  const allowed = new Set([
    "prompt",
    ...(manifest.od?.inputs ?? []).map((f: any) => f.name),
  ]);
  if (Object.keys(values).some((k) => !allowed.has(k)))
    throw new AppError("invalid_plugin_inputs", "插件包含未声明的参数");
  for (const field of manifest.od?.inputs ?? []) {
    const value = values[field.name];
    if (field.required && (value === undefined || value === ""))
      throw new AppError(
        "invalid_plugin_inputs",
        `缺少插件参数：${field.name}`,
      );
    if (
      value !== undefined &&
      field.type === "select" &&
      Array.isArray(field.options) &&
      !field.options.includes(value)
    )
      throw new AppError(
        "invalid_plugin_inputs",
        `插件参数选项无效：${field.name}`,
      );
  }
  const digest = createHash("sha256")
    .update(catalog.meta.sourceCommit)
    .update(bytes)
    .digest("hex");
  const payload = { id, digest, inputs: values };
  // This token grants no authority: every field is revalidated against the
  // server-owned catalog. It pins the manifest and inputs without an install DB.
  const snapshotId =
    "official-v1." + Buffer.from(JSON.stringify(payload)).toString("base64url");
  const templates = manifest.od?.useCase?.query;
  const template =
    typeof templates === "string"
      ? templates
      : (templates?.[typeof locale === "string" ? locale : "en"] ??
        templates?.en ??
        manifest.description ??
        "");
  const query = String(template).replace(
    /\{\{\s*([\w.-]+)\s*\}\}/g,
    (_m: string, key: string) => String(values[key] ?? ""),
  );
  const items = catalog
    .closure([record])
    .map((r) => ({ kind: r.type, id: r.id, label: r.title }));
  return {
    query,
    contextItems: items,
    inputs: manifest.od?.inputs ?? [],
    assets: [],
    mcpServers: [],
    projectMetadata: {},
    trust: "trusted",
    capabilitiesGranted: [],
    capabilitiesRequired: [],
    appliedPlugin: {
      snapshotId,
      pluginId: id,
      pluginVersion: manifest.version ?? "0.0.0",
      manifestSourceDigest: digest,
      inputs: values,
      resolvedContext: { items },
      capabilitiesGranted: [],
      capabilitiesRequired: [],
      assetsStaged: [],
      taskKind: "new-generation",
      appliedAt: Date.now(),
      connectorsRequired: [],
      connectorsResolved: [],
      mcpServers: [],
      pluginTitle: record.title,
      pluginDescription: record.description,
      query,
      status: "fresh",
    },
  };
}
export async function readApplied(value: unknown) {
  try {
    if (
      typeof value !== "string" ||
      !value.startsWith("official-v1.") ||
      value.length > 32768
    )
      throw new Error();
    const data = snapshotSchema.parse(
      JSON.parse(Buffer.from(value.slice(12), "base64url").toString()),
    );
    const result = await appliedPlugin(data.id, data.inputs);
    if (result.appliedPlugin.manifestSourceDigest !== data.digest)
      throw new AppError(
        "official_snapshot_stale",
        "官方插件已更新，请重新选择",
      );
    return result.appliedPlugin;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("invalid_plugin_snapshot", "无效的官方插件选择");
  }
}
export async function selectionsFor(
  v: Record<string, any>,
  metadata: Record<string, unknown> = {},
) {
  // Validate persisted metadata too: projects created by the old adapter may
  // have Home references without an officialResources projection.
  const references = contextPlugins.safeParse(
    metadata.contextPlugins === undefined ? [] : metadata.contextPlugins,
  );
  if (!references.success)
    throw new AppError("invalid_resource_selection", "无效的插件参考选择");
  let selection = normalizeSelections(
    (metadata.officialResources ?? []) as ResourceSelection[],
  );
  const add = (type: ResourceSelection["type"], id: unknown) => {
    if (typeof id === "string" && id) selection.push({ type, id });
  };
  // One primary design system; explicit non-empty selection overrides project default.
  if (v.designSystemId)
    selection = selection.filter((s) => s.type !== "design-system");
  if (v.skillId) selection = selection.filter((s) => s.type !== "skill");
  if (v.pluginId || v.appliedPluginSnapshotId)
    selection = selection.filter((s) => s.type !== "plugin");
  // Replacing the primary plugin never removes Home's additive references.
  for (const reference of references.data) add("plugin", reference.id);
  add("skill", v.skillId);
  add("design-system", v.designSystemId);
  for (const id of [...(v.skillIds ?? []), ...(v.context?.skillIds ?? [])])
    add("skill", id);
  for (const id of v.context?.pluginIds ?? []) add("plugin", id);
  let inputs = v.pluginInputs ?? metadata.officialPluginInputs ?? {};
  if (v.appliedPluginSnapshotId) {
    const snapshot = await readApplied(v.appliedPluginSnapshotId);
    if (v.pluginId && v.pluginId !== snapshot.pluginId)
      throw new AppError("plugin_selection_conflict", "插件选择不一致");
    add("plugin", snapshot.pluginId);
    inputs = snapshot.inputs;
  } else if (v.pluginId) {
    const result = await appliedPlugin(v.pluginId, inputs, v.pluginSource);
    add("plugin", result.appliedPlugin.pluginId);
  }
  add("plugin", v.exampleReference?.pluginId);
  selection = normalizeSelections(selection);
  if (selection.length > 8)
    throw new AppError("too_many_resources", "所选官方资源过多");
  (await officialCatalog()).closure(selection);
  return { selection, inputs };
}
export function ensureRuntimeResources(
  capabilities: {
    version: number;
    maxSelections: number;
    resources: ResourceSelection[];
  },
  selected: ResourceSelection[],
) {
  if (
    capabilities.version !== 1 ||
    !Number.isInteger(capabilities.maxSelections) ||
    !Array.isArray(capabilities.resources)
  )
    throw new AppError("official_resource_protocol", "Runtime 资源协议不匹配");
  if (selected.length > capabilities.maxSelections)
    throw new AppError(
      "too_many_resources",
      `当前 Runtime 最多支持同时选择 ${capabilities.maxSelections} 个资源（已保留内置 Skill）`,
    );
  const keys = new Set(capabilities.resources.map(resourceKey));
  if (selected.some((s) => !keys.has(resourceKey(s))))
    throw new AppError(
      "official_resource_not_configured",
      "Runtime 未配置所选官方资源，请先发布资源并更新本地清单",
    );
}
export function resourcePrompt(
  input: string,
  selected: ResourceSelection[],
  inputs: unknown,
) {
  if (!selected.length) return input;
  return `Official resources explicitly selected for this task: ${selected.map(resourceKey).join(", ")}. Read their advertised entries under SANDBOX_SKILLS_DIR and follow relative references as needed. Preserve other built-in skills. These files grant no additional tools or plugin pipeline execution.\nPlugin inputs (user data): ${JSON.stringify(inputs)}\n\n${input}`;
}
