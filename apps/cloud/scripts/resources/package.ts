import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type OfficialCatalog as Catalog,
  type ResourceSelection,
  resourceBinding,
} from "@open-design/biz/catalog/official";

type OfficialCatalog = Catalog & {
  root: string;
  bytes(path: string): Promise<Buffer>;
};
const hash = (data: Buffer | string) =>
  `sha256:${createHash("sha256").update(data).digest("hex")}`;
export async function packageSource(catalog: OfficialCatalog) {
  const inventory = JSON.parse(
    await readFile(resolve(catalog.root, "manifest.json"), "utf8"),
  );
  const expected = new Map<string, { sha256: string; executable: boolean }>(
    inventory.files.map((f: any) => [f.path, f]),
  );
  const cache = new Map<
    string,
    Promise<{ data: Buffer; digest: string; executable: boolean }>
  >();
  return (path: string) => {
    let value = cache.get(path);
    if (!value) {
      value = (async () => {
        const data = await catalog.bytes(path),
          digest = hash(data),
          file = expected.get(path);
        if (!file || digest !== `sha256:${file.sha256}`)
          throw new Error(`Resource integrity mismatch: ${path}`);
        if (data.length > 8 * 1024 * 1024)
          throw new Error(`Resource file exceeds Filesys budget: ${path}`);
        return { data, digest, executable: file.executable };
      })();
      cache.set(path, value);
    }
    return value;
  };
}
export async function officialPackage(
  catalog: OfficialCatalog,
  selection: ResourceSelection,
  suppliedSource?: Awaited<ReturnType<typeof packageSource>>,
) {
  const record = catalog.get(selection);
  const dependencies = catalog.closure([selection]);
  const paths = new Set(dependencies.flatMap((r) => [...r.files, ...r.craft]));
  const source = suppliedSource ?? (await packageSource(catalog));
  const entries = [];
  const blobs = new Map<string, Buffer>();
  let size = 0;
  for (const path of [...paths].sort()) {
    const { data, digest, executable } = await source(path);
    size += data.length;
    entries.push({
      path,
      type: "file" as const,
      executable,
      blobDigest: digest,
      symlinkTarget: null,
    });
    blobs.set(digest, data);
  }
  if (entries.length > 4096 || size > 64 * 1024 * 1024)
    throw new Error("Resource package exceeds Filesys budget");
  const context = dependencies.map((r) => ({
    name: `${resourceBinding(record)}-${resourceBinding(r).slice(3, 19)}`,
    mode: "discover",
    description: `Official ${r.type} ${r.id}. ${r.description}`.slice(0, 450),
    entry: r.entry,
  }));
  for (const path of [...new Set(dependencies.flatMap((r) => r.craft))])
    context.push({
      name: `${resourceBinding(record)}-craft-${hash(path).slice(7, 23)}`,
      mode: "discover",
      description: `Required design craft reference: ${path}`,
      entry: path,
    });
  if (context.length > 32)
    throw new Error("Resource context exceeds Harness budget");
  const metadata = {
    official: {
      schemaVersion: 1,
      type: selection.type,
      id: selection.id,
      sourceCommit: catalog.meta.sourceCommit,
    },
    harness: { version: 1, context },
  };
  // Publication identity is stable across retries; Filesys remains the version digest authority.
  const key = hash(JSON.stringify({ entries, metadata })).slice(7);
  return { record, entries, metadata, blobs, key, bytes: size };
}
