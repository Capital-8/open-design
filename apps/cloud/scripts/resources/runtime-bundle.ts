import { mkdir, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { importResources } from "./snapshot.js";
import { generateMeta } from "./official-meta.js";
import { buildBundledCatalog } from "./build-catalog.js";

/** Local runtime inventory preserves incomplete records; publication validates every package separately. */
export async function prepareRuntimeBundle(options: { source: string; revision: string; root: string }) {
  const { source, revision, root } = options;
  if (!isAbsolute(source) || !isAbsolute(root) || !/^[a-f0-9]{40}$/.test(revision))
    throw new Error("Absolute source/destination and full Git revision are required");
  await mkdir(root, { recursive: true });
  if ((await readdir(root)).length) throw new Error("Resource destination must be empty");
  await importResources(source, join(root, "resources"), revision);
  const meta = await generateMeta(join(root, "resources"));
  const incomplete = meta.resources.filter(r => r.issues.length)
    .map(r => ({ type: r.type, id: r.id, issues: r.issues }));
  await writeFile(join(root, "official-resource-meta.json"), JSON.stringify(meta, null, 2) + "\n", { flag: "wx" });
  await writeFile(join(root, "resource-validation.json"), JSON.stringify({ revision, incomplete }, null, 2) + "\n", { flag: "wx" });
  await buildBundledCatalog(join(root, "resources"), join(root, "catalog.sqlite"));
  return { revision, resources: meta.resources.length, incomplete };
}
