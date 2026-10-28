import { afterEach, expect, it, vi } from "vitest";
import {
  createShutdown,
  SHUTDOWN_TIMEOUT_MS,
} from "../src/bootstrap/shutdown.js";
function host() {
  return {
    exitCode: undefined as string | number | undefined,
    exit: vi.fn(),
    stderr: { write: vi.fn() },
  };
}
afterEach(() => vi.useRealTimers());
it("drains once on signals and upgrades an in-progress shutdown to a fatal exit", async () => {
  const h = host(),
    drain = Promise.withResolvers<void>(),
    stop = vi.fn(() => drain.promise);
  const shutdown = createShutdown(stop, h);
  const first = shutdown();
  expect(shutdown(true)).toBe(first);
  expect(h.exitCode).toBe(1);
  expect(h.exit).not.toHaveBeenCalled();
  drain.resolve();
  await first;
  expect(stop).toHaveBeenCalledTimes(1);
  expect(h.exit).toHaveBeenCalledExactlyOnceWith(1);
});
it("normal completion does not force a failure exit", async () => {
  const h = host();
  await createShutdown(async () => {}, h)();
  expect(h.exitCode).toBeUndefined();
  expect(h.exit).not.toHaveBeenCalled();
});
it("forces nonzero exit at the shutdown bound even if cleanup never resolves", async () => {
  vi.useFakeTimers();
  const h = host();
  void createShutdown(() => new Promise(() => {}), h)(true);
  await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS - 1);
  expect(h.exit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(h.exit).toHaveBeenCalledExactlyOnceWith(1);
});
it("cleanup failure is sanitized and terminates nonzero", async () => {
  const h = host();
  await createShutdown(async () => {
    throw Error("postgres://secret");
  }, h)();
  expect(h.exit).toHaveBeenCalledExactlyOnceWith(1);
  expect(h.stderr.write).toHaveBeenCalledWith("Cloud shutdown failed\n");
});
