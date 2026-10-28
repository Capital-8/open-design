import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OutboxRecord } from "@open-design/bridge";
import type { DispatchFacade } from "../src/facades/runs/dispatch.js";
const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  recover: vi.fn(),
  operations: vi.fn(),
}));
vi.mock("@open-design/bridge", () => ({
  db: { transaction: () => mocks.claim() },
}));
vi.mock("@open-design/biz/runs/recovery", () => ({
  recoverIntents: mocks.recover,
  jobContext: vi.fn(),
}));
vi.mock("@open-design/biz/projects", () => ({
  recoverOperations: mocks.operations,
}));
import { RunWorker } from "../src/jobs/runs/worker.js";
let worker: RunWorker | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.claim.mockResolvedValue([]);
});
afterEach(async () => {
  await worker?.stop();
  worker = undefined;
});
function fixture() {
  let lose!: () => void;
  const close = vi.fn(async () => {}),
    fatal = vi.fn(),
    perform = vi.fn().mockResolvedValue(null);
  worker = new RunWorker(
    { perform } as unknown as DispatchFacade,
    async (lost) => {
      lose = lost;
      return { healthy: true, close };
    },
    () => {},
    fatal,
  );
  return { worker, lose: () => lose(), close, fatal, perform };
}
it("notifies once and never dispatches claims returned after ownership was lost", async () => {
  const claims = Promise.withResolvers<OutboxRecord[]>();
  mocks.claim.mockReturnValue(claims.promise);
  const f = fixture();
  await f.worker.start();
  expect(mocks.claim).toHaveBeenCalledTimes(1);
  f.lose();
  f.lose();
  expect(f.worker.healthy).toBe(false);
  expect(f.fatal).toHaveBeenCalledTimes(1);
  claims.resolve([{ id: "pending" } as OutboxRecord]);
  await f.worker.stop();
  expect(f.perform).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledTimes(1);
});
it("reports loss immediately while an existing external action drains", async () => {
  const action = Promise.withResolvers<null>();
  mocks.claim.mockResolvedValue([{ id: "running" }]);
  const f = fixture();
  f.perform.mockReturnValue(action.promise);
  await f.worker.start();
  await vi.waitFor(() => expect(f.perform).toHaveBeenCalledTimes(1));
  f.lose();
  expect(f.fatal).toHaveBeenCalledTimes(1);
  expect(f.close).not.toHaveBeenCalled();
  action.resolve(null);
  await f.worker.stop();
  expect(f.close).toHaveBeenCalledTimes(1);
  expect(mocks.claim).toHaveBeenCalledTimes(1);
});
it("does not report normal shutdown as lock loss", async () => {
  const f = fixture();
  await f.worker.start();
  await f.worker.stop();
  f.lose();
  expect(f.fatal).not.toHaveBeenCalled();
});
it("fails startup if ownership is lost during recovery instead of starting polling", async () => {
  const recovery = Promise.withResolvers<void>();
  mocks.recover.mockReturnValue(recovery.promise);
  const f = fixture(),
    starting = f.worker.start();
  const rejected = expect(starting).rejects.toThrow("worker_ownership_lost");
  await vi.waitFor(() => expect(mocks.recover).toHaveBeenCalled());
  f.lose();
  recovery.resolve();
  await rejected;
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(f.fatal).toHaveBeenCalledTimes(1);
  expect(f.close).toHaveBeenCalledTimes(1);
});
