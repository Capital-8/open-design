import { resourceDir } from "./bundle.js";
import { prepareRuntimeBundle } from "./runtime-bundle.js";
const result = await prepareRuntimeBundle({
  source: process.env.OD_CLOUD_RESOURCE_SOURCE ?? "",
  revision: process.env.OD_CLOUD_RESOURCE_REVISION ?? "",
  root: resourceDir(),
});
console.log(JSON.stringify({ ...result, runtimeReady: true, publicationChecked: false }));
