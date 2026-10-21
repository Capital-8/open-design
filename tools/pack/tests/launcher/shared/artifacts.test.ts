import { expect, it } from "vitest";
import { validateLauncherApplicationArtifact } from "@open-design/launcher-proto";
import { buildLauncherHostEnvironment, buildLauncherApplicationArtifact } from "@/launcher/artifacts.js";
import { buildMacLauncherPayloadManifest } from "@/mac/payload.js";

it.each(["darwin", "win32", "linux"] as const)("builds a runtime-readable %s artifact without platform layout inference", platform=>{
  const environment=buildLauncherHostEnvironment({platform,arch:"x64",electronVersion:"41.3.0"});
  const artifact=buildLauncherApplicationArtifact({...environment,appRoot:"code",resourcesPath:"assets",entry:"code/start.mjs"});
  expect(validateLauncherApplicationArtifact(JSON.parse(JSON.stringify(artifact)),environment)).toEqual(artifact);
});
it.each([true,false])("describes the exact macOS entry for prebundled=%s while retaining legacy entries",prebundled=>{
  const manifest=buildMacLauncherPayloadManifest({channel:"beta",namespace:"test",version:"1.1.0-beta.1",executableName:"Open Design Beta",publicAppBundleName:"Open Design Beta.app",electronVersion:"41.3.0",arch:"arm64",prebundled});
  const environment=buildLauncherHostEnvironment({platform:"darwin",arch:"arm64",electronVersion:"41.3.0"});
  expect(validateLauncherApplicationArtifact(manifest.host,environment).entry).toBe(prebundled ? "payload/Open Design Beta.app/Contents/Resources/app/prebundled/packaged-main.mjs" : "payload/Open Design Beta.app/Contents/Resources/app/node_modules/@open-design/packaged/dist/index.mjs");
  expect(manifest.entry).toEqual({cwd:"payload/Open Design Beta.app",executable:"payload/Open Design Beta.app/Contents/MacOS/Open Design Beta"});
});
