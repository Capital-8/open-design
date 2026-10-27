import { describe, expect, it } from "vitest";
import { SIDECAR_SOURCES } from "@open-design/sidecar-proto";
import { resolveDesktopUpdaterConfig } from "../../../src/main/updater/config.js";
import { remoteRequiresReinstall, selectUpdateCandidateWithFallback } from "../../../src/main/updater/feed.js";

const config = (platform: string, arch: string) => resolveDesktopUpdaterConfig({
  source: SIDECAR_SOURCES.PACKAGED, platform, arch, currentVersion: "0.27.0", env: {},
});
const feed = {
  channel: "stable", releaseVersion: "0.28.0",
  platforms: {
    mac: { enabled: true, artifacts: { dmg: { url: "https://example.test/mac.dmg" } } },
    macIntel: { enabled: true, artifacts: { dmg: { url: "https://example.test/intel.dmg" } } },
    win: { enabled: true, artifacts: { installer: { url: "https://example.test/win.exe" } } },
  },
  releaseTargets: {
    mac_arm64: { status: "published", artifacts: { payload: { url: "https://example.test/mac.zip" } } },
    mac_x64: { status: "published", artifacts: { payload: { url: "https://example.test/intel.zip" } } },
    win_x64: { status: "published", artifacts: { payload: { url: "https://example.test/win.7z" } } },
  },
};

describe("stable updater compatibility", () => {
  it.each([
    ["darwin", "arm64", "https://example.test/mac.zip"],
    ["darwin", "x64", "https://example.test/intel.zip"],
    ["win32", "x64", "https://example.test/win.7z"],
  ])("offers a payload to a compatible %s %s installation", (platform, arch, url) => {
    const candidate = selectUpdateCandidateWithFallback(feed, config(platform, arch), true);
    expect(candidate.ok && candidate.candidate.artifact).toMatchObject({ type: "payload", url });
  });

  it("keeps the installer for an incompatible or unreadable outer version", () => {
    expect(remoteRequiresReinstall(feed, config("darwin", "arm64"), "0.13.0")).toMatchObject({ reason: "outer-below-min" });
    expect(remoteRequiresReinstall(feed, config("darwin", "arm64"), null)).toMatchObject({ reason: "outer-version-unreadable" });
    expect(remoteRequiresReinstall(feed, config("darwin", "arm64"), "0.22.0")).toBeNull();
  });

  it("preserves installer fallback when the target is not published", () => {
    const metadata = { ...feed, releaseTargets: { mac_arm64: { status: "failed", artifacts: { payload: { url: "https://example.test/payload" } } } } };
    const candidate = selectUpdateCandidateWithFallback(metadata, config("darwin", "arm64"), true);
    expect(candidate.ok && candidate.candidate.artifact.type).toBe("dmg");
  });

  it("honors a newer declared floor and selects an installer when payload use is disabled", () => {
    const metadata = { ...feed, control: { launcher: { version: { min: "0.26.0" } } } };
    expect(remoteRequiresReinstall(metadata, config("win32", "x64"), "0.25.0")).toMatchObject({ minVersion: "0.26.0" });
    const candidate = selectUpdateCandidateWithFallback(metadata, config("win32", "x64"), false);
    expect(candidate.ok && candidate.candidate.artifact.type).toBe("installer");
  });
});
