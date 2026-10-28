import { readFile, writeFile } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { load, JSON_SCHEMA } from "js-yaml";
import {
  resourceBinding,
  resourceKey,
  type OfficialMeta,
  type OfficialResource,
  type ResourceSelection,
} from "@open-design/biz/catalog/official";

export async function generateMeta(
  root = resolve("resources"),
): Promise<OfficialMeta> {
  const inventory = JSON.parse(
    await readFile(resolve(root, "manifest.json"), "utf8"),
  );
  const files: string[] = inventory.files.map((x: { path: string }) => x.path);
  const fileSet = new Set(files);
  const records: OfficialResource[] = [];
  const pending = new Map<string, any>();
  for (const path of files) {
    let type: ResourceSelection["type"];
    let data: any;
    let id: string;
    if (/^plugins\/_official\/.+\/open-design\.json$/.test(path)) {
      type = "plugin";
      data = JSON.parse(await readFile(resolve(root, path), "utf8"));
      id = data.name;
    } else if (/^(skills|design-templates)\/[^/]+\/SKILL\.md$/.test(path)) {
      type = "skill";
      const text = await readFile(resolve(root, path), "utf8");
      const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
      data = front ? load(front[1]!, { schema: JSON_SCHEMA }) : {};
      id = data.name ?? posix.basename(posix.dirname(path));
    } else if (/^design-systems\/[^/]+\/DESIGN\.md$/.test(path)) {
      type = "design-system";
      id = path.split("/")[1]!;
      data = JSON.parse(
        await readFile(
          resolve(root, posix.dirname(path), "manifest.json"),
          "utf8",
        ),
      );
    } else continue;
    const dir = posix.dirname(path);
    const entry =
      type === "plugin" && fileSet.has(`${dir}/SKILL.md`)
        ? `${dir}/SKILL.md`
        : path;
    const record: OfficialResource = {
      type,
      id,
      title: data.title ?? data.name ?? id,
      description:
        typeof data.description === "string"
          ? data.description
          : `Official ${type}: ${id}`,
      root: dir,
      entry,
      files: files.filter((f) => f.startsWith(dir + "/")),
      dependencies: [],
      craft: [],
      issues: [],
      runtime: {
        scope: "system",
        owner: "open-design-official",
        binding: resourceBinding({ type, id }),
      },
    };
    records.push(record);
    pending.set(resourceKey(record), data);
  }
  const keys = new Set(records.map(resourceKey));
  if (keys.size !== records.length)
    throw new Error("Duplicate type/id across skills and design templates");
  for (const record of records) {
    const data = pending.get(resourceKey(record));
    const od = data.od ?? {};
    const dependency = (type: ResourceSelection["type"], id: string) => {
      if (!keys.has(resourceKey({ type, id })))
        record.issues.push(`Missing ${type}: ${id}`);
      else record.dependencies.push({ type, id });
    };
    const local = (path: string) => {
      const resolved = posix.normalize(posix.join(record.root, path));
      if (
        !resolved.startsWith(record.root + "/") ||
        (!fileSet.has(resolved) &&
          !files.some((f) => f.startsWith(resolved + "/")))
      )
        record.issues.push(`Missing or unsafe file: ${path}`);
    };
    for (const ref of od.context?.skills ?? []) {
      if (ref.ref) dependency("skill", ref.ref);
      if (ref.path) local(ref.path);
    }
    if (od.context?.designSystem?.ref)
      dependency("design-system", od.context.designSystem.ref);
    if (od.context?.designSystem?.path) local(od.context.designSystem.path);
    for (const path of od.context?.assets ?? []) local(path);
    for (const ref of od.useCase?.exampleOutputs ?? []) local(ref.path);
    for (const name of [
      ...(od.context?.craft ?? []),
      ...(od.craft?.requires ?? []),
    ]) {
      const path = `craft/${name}.md`;
      if (!/^[a-z0-9-]+$/.test(name) || !fileSet.has(path))
        record.issues.push(`Missing craft: ${name}`);
      else record.craft.push(path);
    }
    record.craft = [...new Set(record.craft)].sort();
  }
  return {
    schemaVersion: 1,
    sourceCommit: inventory.source.commit,
    resources: records.sort((a, b) =>
      resourceKey(a).localeCompare(resourceKey(b), "en"),
    ),
  };
}
