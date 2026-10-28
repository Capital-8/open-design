import { createHash } from "node:crypto";
import { db } from "@open-design/bridge";
import { defaultBundledCatalog } from "./index.js";

import { z } from "zod";
import { BizError as AppError } from "../errors.js";

export const resourceSelection = z
  .object({
    type: z.enum(["plugin", "skill", "design-system"]),
    id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
  })
  .strict();
export type ResourceSelection = z.infer<typeof resourceSelection>;
export type OfficialResource = ResourceSelection & {
  title: string;
  description: string;
  root: string;
  entry: string;
  files: string[];
  dependencies: ResourceSelection[];
  craft: string[];
  issues: string[];
  runtime: { scope: "system"; owner: string; binding: string };
};
export type OfficialMeta = {
  schemaVersion: 1;
  sourceCommit: string;
  resources: OfficialResource[];
};
export const resourceKey = (r: ResourceSelection) => `${r.type}:${r.id}`;
export const resourceBinding = (r: ResourceSelection) =>
  `od-${createHash("sha256").update(resourceKey(r)).digest("hex").slice(0, 32)}`;
export const normalizeSelections = (items: ResourceSelection[]) => {
  const result = new Map<string, ResourceSelection>();
  for (const item of items) {
    const check = resourceSelection.safeParse(item);
    if (!check.success)
      throw new AppError("invalid_resource_selection", "无效的官方资源标识");
    const parsed = check.data;
    result.set(resourceKey(parsed), parsed);
  }
  return [...result.values()].sort((a, b) =>
    resourceKey(a).localeCompare(resourceKey(b), "en"),
  );
};

export class OfficialCatalog {
  private readonly records: Map<string, OfficialResource>;
  constructor(
    readonly meta: OfficialMeta,
    private readonly readBytes: (path: string) => Promise<Buffer>,
  ) {
    if (meta.schemaVersion !== 1)
      throw new Error("Unsupported official metadata version");
    this.records = new Map();
    for (const record of meta.resources) {
      resourceSelection.parse({ type: record.type, id: record.id });
      if (this.records.has(resourceKey(record)))
        throw new Error("Duplicate official resource identity");
      this.records.set(resourceKey(record), record);
    }
  }
  get(selection: ResourceSelection) {
    const record = this.records.get(resourceKey(selection));
    if (!record)
      throw new AppError(
        "official_resource_unknown",
        `未知官方资源：${resourceKey(selection)}`,
      );
    return record;
  }
  closure(selections: ResourceSelection[]) {
    const found = new Map<string, OfficialResource>();
    const visiting = new Set<string>();
    const visit = (selection: ResourceSelection) => {
      const key = resourceKey(selection);
      if (visiting.has(key))
        throw new AppError("official_resource_invalid", `资源依赖循环：${key}`);
      if (found.has(key)) return;
      const record = this.get(selection);
      if (record.issues.length)
        throw new AppError(
          "official_resource_incomplete",
          `${key}: ${record.issues.join("; ")}`,
        );
      visiting.add(key);
      for (const dependency of record.dependencies) visit(dependency);
      visiting.delete(key);
      found.set(key, record);
    };
    for (const selected of normalizeSelections(
      selections.map(({ type, id }) => ({ type, id })),
    ))
      visit(selected);
    return [...found.values()];
  }
  async bytes(path: string) {
    return this.readBytes(path);
  }
}
export async function officialCatalog() {
  const meta = (await db
    .read()
    .catalog.officialMetadata()) as unknown as OfficialMeta;
  return new OfficialCatalog(meta, async (path) => {
    const resource = meta.resources.find((r) => path.startsWith(r.root + "/"));
    if (!resource) throw new AppError("invalid_resource_path");
    return defaultBundledCatalog().asset(
      resource.type,
      resource.id,
      path.slice(resource.root.length + 1),
    );
  });
}
