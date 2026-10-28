import { open, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  launchSidecar,
  getSidecarStatus,
  stopSidecar,
  normalizeSidecarStamp,
  type SidecarStamp,
} from "@open-design/sidecar";
import { readLogTail } from "@open-design/platform";
import type { ToolDevConfig, ToolDevOptions } from "./config.js";
export function cloudStamp(
  namespace: string,
  app: "cloud" | "cloud-renderer",
): SidecarStamp {
  return normalizeSidecarStamp({
    channel: "dev",
    source: "tools-dev",
    mode: "dev",
    namespace,
    app,
  });
}
export async function cloudLifecycle(
  action: string,
  config: ToolDevConfig,
  options: ToolDevOptions,
) {
  const targets = ["cloud-renderer", "cloud"] as const,
    stamp = (app: (typeof targets)[number]) =>
      cloudStamp(config.namespace, app),
    log = (app: string) =>
      join(config.namespaceRoot, app, "logs", "latest.log");
  const status = async (app: (typeof targets)[number]) =>
    getSidecarStatus<{ ready: boolean; url: string }>(stamp(app), {
      timeoutMs: 3500,
    }).catch(() => null);
  const stop = async () => {
    for (const app of [...targets].reverse())
      await stopSidecar(stamp(app), { termGraceMs: 65000 });
  };
  if (action === "status")
    return Object.fromEntries(
      await Promise.all(targets.map(async (app) => [app, await status(app)])),
    );
  if (action === "logs")
    return Object.fromEntries(
      await Promise.all(
        targets.map(async (app) => [
          app,
          await readLogTail(log(app)).catch(() => null),
        ]),
      ),
    );
  if (action === "stop") {
    await stop();
    return { stopped: true };
  }
  if (!["start", "restart", "run"].includes(action))
    throw new Error(
      "cloud action must be start, run, status, stop, restart or logs",
    );
  if (action === "restart") await stop();
  const mainPort = Number(
      options.daemonPort ?? process.env.OD_CLOUD_PORT ?? 19000,
    ),
    rendererPort = Number(process.env.OD_CLOUD_RENDERER_PORT ?? 19001);
  if (
    [mainPort, rendererPort].some(
      (p) => !Number.isInteger(p) || p < 1 || p > 65535,
    ) ||
    mainPort === rendererPort
  )
    throw new Error("Cloud ports must be distinct valid ports");
  const launched: (typeof targets)[number][] = [];
  try {
    for (const app of targets) {
      const existing = await status(app);
      if (existing) {
        if (!existing.ready) throw new Error(app + " is running but not ready");
        continue;
      }
      const port = app === "cloud" ? mainPort : rendererPort,
        env: NodeJS.ProcessEnv =
          app === "cloud"
            ? {
                ...process.env,
                OD_CLOUD_PORT: String(mainPort),
                OD_CLOUD_RENDERER_URL: `http://127.0.0.1:${rendererPort}`,
              }
            : {
                PATH: process.env.PATH,
                HOME: process.env.HOME,
                TMPDIR: process.env.TMPDIR,
                OD_CLOUD_RENDERER_PORT: String(rendererPort),
                OD_CLOUD_RENDERER_HOST: "127.0.0.1",
                OD_CLOUD_CHROMIUM_PATH: process.env.OD_CLOUD_CHROMIUM_PATH,
                OD_CLOUD_FFMPEG_PATH: process.env.OD_CLOUD_FFMPEG_PATH,
              };
      await mkdir(join(config.namespaceRoot, app, "logs"), { recursive: true });
      const handle = await open(log(app), "a");
      try {
        await launchSidecar({
          command: process.execPath,
          args: [join(config.workspaceRoot, "apps/cloud/sidecar/index.ts")],
          cwd: config.workspaceRoot,
          env,
          logFd: handle.fd,
          stamp: stamp(app),
          resources: {
            port,
            runtimeRoot: config.namespaceRoot,
            dataRoot: null,
            ownerPid: action === "run" ? process.pid : null,
          },
        });
        launched.push(app);
      } finally {
        await handle.close();
      }
      let ready = false;
      for (let attempt = 0; attempt < 120; attempt++) {
        if ((await status(app))?.ready) {
          ready = true;
          break;
        }
        await delay(250);
      }
      if (!ready)
        throw new Error(
          app + " did not become ready; inspect tools-dev cloud logs",
        );
    }
  } catch (error) {
    for (const app of launched.reverse())
      await stopSidecar(stamp(app), { termGraceMs: 65000 });
    throw error;
  }
  if (action === "run")
    await new Promise<void>((resolve) => {
      let stopping = false;
      const handler = () => {
        if (stopping) return;
        stopping = true;
        void stop().finally(() => {
          process.off("SIGINT", handler);
          process.off("SIGTERM", handler);
          resolve();
        });
      };
      process.on("SIGINT", handler);
      process.on("SIGTERM", handler);
    });
  return { namespace: config.namespace, mainPort, rendererPort };
}
