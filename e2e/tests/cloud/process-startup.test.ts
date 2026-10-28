import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { T } from "@/timeouts";

const exec = promisify(execFile);
const cloudDirectory = fileURLToPath(
  new URL("../../../apps/cloud/", import.meta.url),
);

// Use built public package entries in fresh Node processes, with no credentials or server mocks.
// These are lifecycle witnesses, not fake implementations shipped in an application.
const fixture = `
import assert from 'node:assert/strict';
import * as bridge from '@open-design/bridge';
const role = process.argv[1];
const { startMain } = await import('@open-design/cloud/server');
const { startRenderer } = await import('@open-design/cloud/renderer-server');
const render = {
  async getCapabilities() { return { available: false, reason: 'fixture-engine' }; },
  async render() { throw new Error('unused'); },
};
const resources = {
  bindings: role === 'main' ? { proc: { async spawn() { throw new Error('fixture-owner-' + process.pid); } } } : { render },
  async checkSupport() {}, async checkReadiness() {}, async close() {},
};
const start = async () => () => {};
const running = role === 'main'
  ? await startMain({ modules: [{ name: 'fixture', required: ['proc'], start }], createResources: async () => resources })
  : await startRenderer({ start, createResources: async () => resources });
if (role === 'main') {
  await assert.rejects(bridge.proc.spawn({command:'fixture',args:[],cwd:'.'}), new RegExp('fixture-owner-' + process.pid));
  await assert.rejects(bridge.render.getCapabilities(), /capability render is not registered/);
} else {
  assert.equal((await bridge.render.getCapabilities()).reason, 'fixture-engine');
  assert.throws(() => bridge.db.read(), /capability db is not registered/);
}
assert.throws(() => bridge.register(resources.bindings, { required: [] }), /already registered/);
await running.stop();
console.log(JSON.stringify({ role, pid: process.pid }));
`;

describe("cloud process registration", () => {
  it("[P1] main and renderer resolve their own bridge while consumers in each process share it", async () => {
    const results = await Promise.all(
      ["main", "renderer"].map(async (role) => {
        const { stdout } = await exec(
          process.execPath,
          ["--input-type=module", "--eval", fixture, role],
          {
            cwd: cloudDirectory,
            env: {},
            timeout: T.medium,
          },
        );
        return JSON.parse(stdout) as { role: string; pid: number };
      }),
    );
    expect(results.map((result) => result.role)).toEqual(["main", "renderer"]);
    expect(new Set(results.map((result) => result.pid)).size).toBe(2);
  });
});
