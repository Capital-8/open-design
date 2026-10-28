import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  publishOfficialMeta,
  publishOfficialPackages,
} from "@open-design/dependencies/filesys";
import { loadBundle, publishConfig } from "./bundle.js";
const bundle = await loadBundle(),
  config = publishConfig(),
  receipt = JSON.parse(
    await readFile(join(bundle.root, "assets-receipt.json"), "utf8"),
  );
if (
  receipt.revision !== bundle.catalog.meta.sourceCommit ||
  receipt.metadataSha256 !==
    createHash("sha256").update(bundle.data).digest("hex")
)
  throw new Error("Assets receipt does not match metadata");
// Revalidate remote mappings on every invocation; local receipts do not prove continued remote existence.
await publishOfficialPackages(bundle.packs, config);
const result = await publishOfficialMeta(bundle.data, config);
await writeFile(
  join(bundle.root, "metadata-receipt.json"),
  JSON.stringify(
    { revision: bundle.catalog.meta.sourceCommit, ...result },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify(result));
