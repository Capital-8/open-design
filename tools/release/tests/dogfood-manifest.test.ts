import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { dogfoodFile, manifestKey, mergeDogfoodManifests, type DogfoodManifest } from "../src/storage/dogfood-manifest.ts";

const exec = promisify(execFile);
const manifest = (target: "mac_arm64" | "mac_x64"): DogfoodManifest => ({ schemaVersion: 1, version: "0.25.1-beta.19", buildId: "40447980505-1", generatedAt: "2026-10-27T04:33:48Z", commit: "abc", environment: "feature-test", files: [dogfoodFile(target, "Open Design.dmg", 3, "a".repeat(64))] });

describe("dogfood mirror manifests", () => {
  it("keeps identical local filenames from different architectures distinct", () => {
    const merged = mergeDogfoodManifests([manifest("mac_arm64"), manifest("mac_x64")]);
    expect(merged.files.map((f) => f.name)).toEqual(["mac_arm64-Open-Design.dmg", "mac_x64-Open-Design.dmg"]);
    expect(merged.files.map((f) => f.arch)).toEqual(["arm64", "x64"]);
    expect(manifestKey(merged.version, merged.buildId)).toBe("dogfood/0.25.1-beta.19/40447980505-1/manifest.json");
  });
  it("rejects mixed builds, backends, duplicate files and unverified files", () => {
    expect(() => mergeDogfoodManifests([manifest("mac_arm64"), { ...manifest("mac_x64"), buildId: "2-1" }])).toThrow(/identity/);
    expect(() => mergeDogfoodManifests([manifest("mac_arm64"), { ...manifest("mac_x64"), environment: "prod" }])).toThrow(/identity/);
    expect(() => mergeDogfoodManifests([manifest("mac_arm64"), manifest("mac_arm64")])).toThrow(/duplicate/);
    expect(() => dogfoodFile("win_x64", "setup.exe", 0, "")).toThrow();
  });
  it("uploads platform files and a parseable manifest without writing a channel", async () => {
    const root = await mkdtemp(join(tmpdir(), "dogfood-manifest-"));
    const received = new Map<string, Buffer>();
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      received.set(req.url!, Buffer.concat(chunks));
      res.writeHead(200); res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address() as { port: number };
      const file = join(root, "Open Design.dmg"); await writeFile(file, "abc");
      await exec(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../src/storage/publish-dogfood.ts", import.meta.url))], {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        env: { ...process.env, DOGFOOD_VERSION: "0.25.1-beta.19", DOGFOOD_BUILD_ID: "40447980505-1", DOGFOOD_TARGET: "mac_arm64", DOGFOOD_FILES: file,
          DOGFOOD_BUILD_JSON_PATH: "", DOGFOOD_ENVIRONMENT: "feature-test", GITHUB_STEP_SUMMARY: "", DOGFOOD_SUMMARY_PATH: "", DOGFOOD_OUTPUTS_PATH: "",
          RELEASE_PUBLIC_ORIGIN: "https://releases.open-design.ai", RELEASE_STORAGE_ENDPOINT: `http://127.0.0.1:${address.port}`, RELEASE_STORAGE_BUCKET: "test", RELEASE_STORAGE_ACCESS_KEY_ID: "test", RELEASE_STORAGE_SECRET_ACCESS_KEY: "test", RELEASE_STORAGE_REGION: "auto" },
      });
      const keys = [...received.keys()];
      expect(keys).toHaveLength(2);
      expect(keys.every((k) => k.startsWith("/test/dogfood/0.25.1-beta.19/40447980505-1/"))).toBe(true);
      const key = keys.find((k) => k.endsWith("manifest-mac_arm64.json"))!;
      const m = JSON.parse(received.get(key)!.toString()) as DogfoodManifest;
      expect(m.schemaVersion).toBe(1);
      expect(m.files[0]).toMatchObject({ name: "mac_arm64-Open-Design.dmg", path: "mac_arm64-Open-Design.dmg", platform: "mac", arch: "arm64", kind: "installer", size: 3, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
