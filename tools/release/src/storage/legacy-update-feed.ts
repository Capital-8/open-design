import type { ReleaseChannel } from "@open-design/release";

type Artifact = { url?: string };
type PlatformManifest = { artifacts?: Record<string, Artifact> };

// 0.13-era updaters ignore the launcher version floor and prefer a payload
// whenever one is present. Those installed launchers cannot run newer
// supervised sidecars. Keep stable updater feeds on the installer path until
// those installed launchers have a compatible migration path.
export function legacySafeUpdaterPlatform<T extends PlatformManifest>(
  channel: ReleaseChannel,
  platform: "mac" | "macIntel" | "win" | "linux",
  manifest: T,
): T {
  if (channel !== "stable" || platform === "linux") return manifest;
  const installer = platform === "win" ? "installer" : "dmg";
  if (!manifest.artifacts?.[installer]?.url) {
    throw new Error(`stable ${platform} updater feed requires a ${installer} installer`);
  }
  const { payload: _payload, ...artifacts } = manifest.artifacts;
  return { ...manifest, artifacts };
}
