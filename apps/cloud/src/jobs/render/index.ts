import { render, BridgeError, type RenderRequest } from "@open-design/bridge";
/** Bounded synchronous execution. No durable queue and no automatic replay. */
export function createRenderJob() {
  let current: Promise<Awaited<ReturnType<typeof render.render>>> | undefined,
    stopping = false;
  return {
    async execute(input: RenderRequest) {
      if (stopping) throw new BridgeError("renderer_unavailable");
      if (current) throw new BridgeError("renderer_busy");
      current = render.render(input);
      try {
        return await current;
      } finally {
        current = undefined;
      }
    },
    async stop() {
      stopping = true;
      await current?.catch(() => {});
    },
  };
}
