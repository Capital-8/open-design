import { fileFixture, reference } from "./file-fixture.js";
import { dbFixture } from "./db-fixture.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeBindings, ProcessHandle } from "../src/index.js";

const requirements = { required: ["db", "file", "proc"] } as const;

function adapters() {
  const process: ProcessHandle = {
    stdout: (async function* () {
      yield new Uint8Array([1]);
    })(),
    stderr: (async function* () {})(),
    write: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    wait: vi.fn(async () => ({ code: 0, signal: null })),
    terminate: vi.fn(async () => {}),
  };
  return {
    process,
    bindings: {
      db: dbFixture().adapter,
      file: { ...fileFixture(), read: vi.fn(async () => new Uint8Array([42])) },
      proc: { spawn: vi.fn(async () => process) },
    } satisfies BridgeBindings,
  };
}

describe("startup bridge registration", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("rejects all calls before startup registration", async () => {
    const { db, file, proc } = await import("../src/index.js");
    expect(() => db.read()).toThrow("not registered");
    await expect(file.read(reference)).rejects.toThrow("not registered");
    await expect(
      proc.spawn({ command: "git", args: [], cwd: "workspace" }),
    ).rejects.toThrow("not registered");
  });

  it("forwards the three imported capabilities to the registered adapters", async () => {
    const { register, db, file, proc } = await import("../src/index.js");
    const { bindings, process } = adapters();
    register(bindings, requirements);

    expect(await db.read().projects.get("p1")).toBeNull();
    expect(bindings.db.read().projects.get).toHaveBeenCalledWith("p1");
    expect(await file.read(reference)).toEqual(new Uint8Array([42]));
    expect(bindings.file.read).toHaveBeenCalledWith(reference);
    const request = { command: "git", args: ["status"], cwd: "workspace" };
    expect(await proc.spawn(request)).toBe(process);
    expect(bindings.proc.spawn).toHaveBeenCalledWith(request);
  });

  it("preserves class adapter receivers and captures bindings at startup", async () => {
    const { register, db } = await import("../src/index.js");
    const fixture = dbFixture();
    class Store {
      #reader = fixture.reader;
      read() {
        return this.#reader;
      }
      transaction = fixture.adapter.transaction;
    }
    const adapter = new Store();
    const bindings: BridgeBindings = { ...adapters().bindings, db: adapter };
    register(bindings, requirements);
    bindings.db = dbFixture().adapter;
    adapter.read = () => {
      throw new Error("changed");
    };
    expect(await db.read().projects.get("p1")).toBeNull();
    expect(fixture.get).toHaveBeenCalledWith("p1");
  });

  it("rejects re-registration without replacing the first backend", async () => {
    const { register, db } = await import("../src/index.js");
    const first = adapters();
    const second = adapters();
    register(first.bindings, requirements);
    expect(() => register(second.bindings, requirements)).toThrow(
      "already registered",
    );
    await db.read().projects.get("p1");
    expect(first.bindings.db.read().projects.get).toHaveBeenCalledOnce();
    expect(second.bindings.db.read().projects.get).not.toHaveBeenCalled();
  });

  it("rejects plural files and unapproved capabilities without partially registering", async () => {
    const { register, db } = await import("../src/index.js");
    const { bindings } = adapters();
    expect(() =>
      register(
        { ...bindings, files: bindings.file } as BridgeBindings,
        requirements,
      ),
    ).toThrow("Only db, file, proc, auth, runtime and render");
    expect(() =>
      register({ ...bindings, telemetry: {} } as BridgeBindings, requirements),
    ).toThrow("Only db, file, proc, auth, runtime and render");
    expect(() => db.read()).toThrow("not registered");
    register(bindings, requirements);
    expect(await db.read().projects.get("p1")).toBeNull();
  });

  it("validates required adapters before committing the registration", async () => {
    const { register, file } = await import("../src/index.js");
    const { bindings } = adapters();
    expect(() =>
      register(
        { ...bindings, proc: {} } as unknown as BridgeBindings,
        requirements,
      ),
    ).toThrow("proc.spawn");
    expect(() =>
      register(null as unknown as BridgeBindings, requirements),
    ).toThrow("must be an object");
    await expect(file.read(reference)).rejects.toThrow("not registered");
    register(bindings, requirements);
    expect(await file.read(reference)).toEqual(new Uint8Array([42]));
  });

  it("keeps missing records and adapter failures distinct without retrying", async () => {
    const { register, db, file, proc } = await import("../src/index.js");
    const failure = new Error("backend unavailable");
    const store = dbFixture();
    const read = vi.fn(async () => {
      throw failure;
    });
    const spawn = vi.fn((): Promise<ProcessHandle> => {
      throw failure;
    });
    register(
      { db: store.adapter, file: { ...fileFixture(), read }, proc: { spawn } },
      requirements,
    );

    expect(await db.read().projects.get("missing")).toBeNull();
    await expect(file.read(reference)).rejects.toBe(failure);
    await expect(
      proc.spawn({ command: "git", args: [], cwd: "workspace" }),
    ).rejects.toBe(failure);
    expect(read).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledOnce();
  });
});
