import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const root = process.cwd();
const web = resolve(root, "apps/web");
const out = resolve(root, ".tmp/type-benchmark");
mkdirSync(out, { recursive: true });
const env = { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096", NEXT_TELEMETRY_DISABLED: "1" };
const generated = spawnSync(process.execPath, [resolve(web, "node_modules/next/dist/bin/next"), "typegen"], { cwd: web, env, encoding: "utf8" });
writeFileSync(resolve(out, "typegen.log"), `${generated.stdout ?? ""}${generated.stderr ?? ""}`);
if (generated.status !== 0) throw new Error("Route generation failed; inspect typegen.log");
const results = [];
// ABBA balances the benefit of OS filesystem caches; no .tsbuildinfo is read or written.
for (const [index, scope] of ["full", "production", "production", "full"].entries()) {
  const config = scope === "full" ? "tsconfig.json" : "tsconfig.build.json";
  const start = performance.now();
  const result = spawnSync(process.execPath, [resolve(root, "node_modules/typescript/lib/tsc.js"), "--project", config, "--incremental", "false", "--extendedDiagnostics"], { cwd: web, env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const wallSeconds = (performance.now() - start) / 1000;
  const log = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(resolve(out, `${index + 1}-${scope}.log`), log);
  const diagnostics = Object.fromEntries(log.split("\n").flatMap((line) => {
    const match = /^([A-Za-z ()]+):\s+([0-9.]+)([Ks]?)\s*$/.exec(line);
    return match ? [[match[1], `${match[2]}${match[3]}`]] : [];
  }));
  const row = { scope, iteration: index + 1, wallSeconds, exitCode: result.status, diagnostics };
  results.push(row);
  console.log(JSON.stringify(row));
}
writeFileSync(resolve(out, "results.json"), JSON.stringify({ commit: process.env.GITHUB_SHA, os: process.platform, arch: process.arch, node: process.version, results }, null, 2));
if (results.some((result) => result.exitCode !== 0)) process.exitCode = 1;
