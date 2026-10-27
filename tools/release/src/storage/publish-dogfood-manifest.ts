import { appendFileSync } from "node:fs";
import { optional, required, publicUrl, storageConfigFromEnv, type ReleaseTarget } from "./common.ts";
import { manifestBase, manifestKey, mergeDogfoodManifests, type DogfoodManifest } from "./dogfood-manifest.ts";
import { putStorageObject } from "./s3-upload.ts";

const version = required("DOGFOOD_VERSION");
const buildId = required("DOGFOOD_BUILD_ID");
const origin = required("RELEASE_PUBLIC_ORIGIN").replace(/\/+$/, "");
const targets = required("DOGFOOD_TARGETS").split(",").filter(Boolean);
const allowed = new Set(["mac_arm64", "mac_x64", "win_x64", "linux_x64"]);
if (targets.length === 0 || targets.some((t) => !allowed.has(t)) || new Set(targets).size !== targets.length) throw new Error("invalid DOGFOOD_TARGETS");
const manifests: DogfoodManifest[] = [];
for (const target of targets) {
  const url = `${origin}/${manifestKey(version, buildId, target as ReleaseTarget)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`platform manifest ${target}: HTTP ${response.status}`);
  const manifest = await response.json() as DogfoodManifest;
  if (manifest.version !== version || manifest.buildId !== buildId) throw new Error("platform manifest does not match requested build");
  manifests.push(manifest);
}
const manifest = mergeDogfoodManifests(manifests);
await putStorageObject({ ...storageConfigFromEnv(), body: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
  cacheControl: "public, max-age=60, must-revalidate", contentType: "application/json; charset=utf-8", objectKey: manifestKey(version, buildId) });
const baseUrl = publicUrl(origin, manifestBase(version, buildId), "");
const summary = `## Mirror import\n\nAdaptor: \`od-dogfood\`\n\nBase URL: ${baseUrl}\n`;
console.log(summary);
const summaryPath = optional("GITHUB_STEP_SUMMARY");
if (summaryPath) appendFileSync(summaryPath, summary);
