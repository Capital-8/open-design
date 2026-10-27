import { describe, expect, it } from "vitest";
import { legacySafeUpdaterPlatform } from "../src/storage/legacy-update-feed.ts";

describe("stable update feed for historical launchers", () => {
  it.each([
    ["mac", "dmg"],
    ["macIntel", "dmg"],
    ["win", "installer"],
  ] as const)("offers the %s installer without a payload", (platform, installer) => {
    const manifest = { artifacts: { [installer]: { url: "https://example.test/installer" }, payload: { url: "https://example.test/payload" } } };
    const feed = legacySafeUpdaterPlatform("stable", platform, manifest);
    expect(feed.artifacts[installer]?.url).toBe("https://example.test/installer");
    expect(feed.artifacts.payload).toBeUndefined();
    expect(manifest.artifacts.payload.url).toBe("https://example.test/payload");
  });

  it("refuses to remove a payload without a usable installer", () => {
    expect(() => legacySafeUpdaterPlatform("stable", "mac", { artifacts: { payload: { url: "https://example.test/payload" } } })).toThrow(/requires a dmg installer/);
  });

  it("keeps payloads available on other channels", () => {
    const manifest = { artifacts: { payload: { url: "https://example.test/payload" } } };
    expect(legacySafeUpdaterPlatform("beta", "mac", manifest)).toBe(manifest);
  });
});
