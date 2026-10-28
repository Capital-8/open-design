import { pathToFileURL } from "node:url";
import type { CloudProcess } from "./process.js";
import { createShutdown } from "./shutdown.js";
export function isEntrypoint(url: string) {
  return !!process.argv[1] && url === pathToFileURL(process.argv[1]).href;
}
export async function runEntrypoint(start: () => Promise<CloudProcess>) {
  try {
    const processHandle = await start();
    const shutdown = createShutdown(() => processHandle.stop());
    const stop = () => {
      void shutdown();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    void processHandle.failure?.then(() => shutdown(true));
  } catch {
    process.stderr.write(
      "Cloud startup failed; verify configuration, schema and resources\n",
    );
    process.exitCode = 1;
  }
}
