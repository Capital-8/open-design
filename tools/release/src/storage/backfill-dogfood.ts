// Recover a historical run through its retained GitHub artifacts, never by
// guessing files in an unlistable bucket. Credentials stay in the workflow.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { optional, required } from "./common.ts";

const runId = required("DOGFOOD_RUN_ID");
if (!/^[1-9][0-9]*$/.test(runId)) throw new Error("invalid run ID");
const repo = required("GITHUB_REPOSITORY");
if (repo !== "nexu-io/open-design") throw new Error("backfill is restricted to nexu-io/open-design");
const run = JSON.parse(execFileSync("gh", ["api", `repos/${repo}/actions/runs/${runId}`], { encoding: "utf8" })) as { status: string; run_attempt: number; head_sha: string; head_branch: string; path: string };
if (run.status !== "completed" || run.path !== ".github/workflows/release-beta.yml") throw new Error("expected a completed release-beta run");
const root = required("DOGFOOD_ARTIFACT_DIR");
const targets: string[] = [];
const entries = readdirSync(root, { recursive: true, withFileTypes: true });
for (const [target, artifact] of [["mac_arm64", "open-design-beta-mac-arm64-dmg"], ["mac_x64", "open-design-beta-mac-x64-dmg"], ["win_x64", "open-design-beta-win-x64-installer"]]) {
  const files = entries.filter((e) => e.isFile() && e.parentPath.includes(artifact!) && /\.(dmg|exe|zip)$/i.test(e.name)).map((e) => join(e.parentPath, e.name));
  if (files.length === 0) continue;
  execFileSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./publish-dogfood.ts", import.meta.url))], { stdio: "inherit", env: {
    ...process.env, DOGFOOD_BUILD_ID: `${runId}-${run.run_attempt}`, DOGFOOD_TARGET: target,
    DOGFOOD_BRANCH: run.head_branch, RELEASE_COMMIT: run.head_sha,
    DOGFOOD_ENVIRONMENT: required("DOGFOOD_ENVIRONMENT"),
    DOGFOOD_FILES: files.join("\n"), DOGFOOD_BUILD_JSON_PATH: "", DOGFOOD_BUILD_JSON_KEYS: "",
  } });
  targets.push(target!);
}
if (targets.length === 0) throw new Error("no retained installer artifacts found");
execFileSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./publish-dogfood-manifest.ts", import.meta.url))], { stdio: "inherit", env: {
  ...process.env, DOGFOOD_BUILD_ID: `${runId}-${run.run_attempt}`, DOGFOOD_TARGETS: targets.join(","), GITHUB_STEP_SUMMARY: optional("GITHUB_STEP_SUMMARY"),
} });
