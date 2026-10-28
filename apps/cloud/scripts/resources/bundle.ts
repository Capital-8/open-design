import { readFile, realpath } from "node:fs/promises";
import { resolve, join, sep, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { OfficialCatalog } from "@open-design/biz/catalog/official";
import { packageSource, officialPackage } from "./package.js";
import { generateMeta } from "./official-meta.js";
import { verifyResources } from "./snapshot.js";
export function resourceDir() {
  const root = process.env.OD_CLOUD_RESOURCE_DIR;
  if (!root || !isAbsolute(root))
    throw new Error("OD_CLOUD_RESOURCE_DIR must be absolute");
  return root;
}
export async function loadBundle() {
  const root = resourceDir(),
    resources = join(root, "resources");
  await verifyResources(resources);
  const data = await readFile(join(root, "official-resource-meta.json"));
  const inventory = JSON.parse(
    await readFile(join(resources, "manifest.json"), "utf8"),
  );
  const meta = JSON.parse(data.toString());
  if (meta.sourceCommit !== inventory.source.commit)
    throw new Error("Resource metadata revision mismatch");
  if (
    process.env.OD_CLOUD_RESOURCE_REVISION &&
    process.env.OD_CLOUD_RESOURCE_REVISION !== meta.sourceCommit
  )
    throw new Error("Resource revision mismatch");
  if (JSON.stringify(meta) !== JSON.stringify(await generateMeta(resources)))
    throw new Error("Resource mapping differs from indexed source");
  const base = await realpath(resources),
    entries = new Map<string, { sha256: string }>(
      inventory.files.map((v: { path: string; sha256: string }) => [v.path, v]),
    );
  const bytes = async (path: string) => {
    if (!entries.has(path)) throw new Error("Resource is not indexed");
    const target = await realpath(resolve(base, path));
    if (!target.startsWith(base + sep))
      throw new Error("Resource escapes bundle");
    const data = await readFile(target);
    if (
      createHash("sha256").update(data).digest("hex") !==
      entries.get(path)!.sha256
    )
      throw new Error("Resource digest changed");
    return data;
  };
  const catalog = Object.assign(new OfficialCatalog(meta, bytes), {
    root: resources,
    bytes,
  });
  const source = await packageSource(catalog),
    packs = [];
  for (const record of catalog.meta.resources)
    packs.push(await officialPackage(catalog, record, source));
  return { root, data, catalog, packs };
}
export function publishConfig() {
  const url = process.env.FILESYS_PUBLISH_URL,
    token = process.env.FILESYS_PUBLISH_TOKEN;
  if (!url || !token)
    throw new Error("Explicit Filesys publishing configuration required");
  return { url, token };
}
