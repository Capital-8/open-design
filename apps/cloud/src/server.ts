export { startMain } from "./bootstrap/main.js";
import type { MainConfig } from "./config/main.js";
export async function launchMain(config: MainConfig) {
  return (await import("./bootstrap/application.js")).launchMain(config);
}
export type {
  CloudModule,
  CloudProcess,
  CloudResources,
  ProcessOptions,
} from "./bootstrap/process.js";
import { isEntrypoint, runEntrypoint } from "./bootstrap/entry.js";
if (isEntrypoint(import.meta.url))
  await runEntrypoint(async () => {
    const { mainConfig } = await import("./config/main.js");
    const { launchMain } = await import("./bootstrap/application.js");
    return launchMain(mainConfig());
  });
