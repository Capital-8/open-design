import { resourceDir, loadBundle } from "./bundle.js";
import { prepareRuntimeBundle } from "./runtime-bundle.js";
const result = await prepareRuntimeBundle({
  source: process.env.OD_CLOUD_RESOURCE_SOURCE ?? "",
  revision: process.env.OD_CLOUD_RESOURCE_REVISION ?? "",
  root: resourceDir(),
});
// Release preparation remains fail-closed, including dependency closure and Filesys limits.
const bundle = await loadBundle();
console.log(JSON.stringify({ revision: result.revision, packages: bundle.packs.length, ready: true }));
