import { SidecarFactory, type SidecarClient } from "@open-design/sidecar";
import type { CloudProcess } from "../dist/bootstrap/process.js";
import { createShutdown } from "../dist/bootstrap/shutdown.js";
async function main() {
  let client: SidecarClient<CloudProcess>;
  let endpoint = "";
  let runtime: CloudProcess | undefined;
  client = SidecarFactory.create<CloudProcess>({
    lifecycle: {
      async start(resources) {
        if (client.stamp.app === "cloud") {
          const { mainConfig } = await import("../dist/config/main.js"),
            { launchMain } = await import("../dist/server.js");
          const config = mainConfig({
            ...process.env,
            OD_CLOUD_PORT: String(resources.port),
          });
          endpoint = `http://127.0.0.1:${resources.port}`;
          return (runtime = await launchMain(config));
        }
        if (client.stamp.app === "cloud-renderer") {
          const { rendererConfig } = await import("../dist/config/renderer.js"),
            { launchRenderer } =
              await import("../dist/bootstrap/render-application.js");
          endpoint = `http://127.0.0.1:${resources.port}`;
          return launchRenderer(
            rendererConfig({
              ...process.env,
              OD_CLOUD_RENDERER_PORT: String(resources.port),
            }),
          );
        }
        throw new Error("Unsupported cloud process");
      },
      async status() {
        const response = await fetch(endpoint + "/ready", {
          signal: AbortSignal.timeout(3000),
        });
        return { ready: response.ok, url: endpoint };
      },
      stop: (runtime) => runtime.stop(),
    },
  });
  await client.start();
  const shutdown = createShutdown(() => client.stop());
  void runtime?.failure?.then(() => shutdown(true));
  await client.waitUntilStopped();
}
main().catch(() => {
  process.stderr.write(
    "Cloud sidecar startup failed; verify configuration, schema and resource paths\n",
  );
  process.exitCode = 1;
});
