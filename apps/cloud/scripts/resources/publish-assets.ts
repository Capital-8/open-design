import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { publishOfficialPackages } from "@open-design/dependencies/filesys";
import { loadBundle, publishConfig } from "./bundle.js";
const bundle = await loadBundle(),
  result = await publishOfficialPackages(bundle.packs, publishConfig());
await writeFile(
  join(bundle.root, "assets-receipt.json"),
  JSON.stringify(
    {
      revision: bundle.catalog.meta.sourceCommit,
      metadataSha256: createHash("sha256").update(bundle.data).digest("hex"),
      ...result,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({ packages: result.receipts.length, stats: result.stats }),
);
