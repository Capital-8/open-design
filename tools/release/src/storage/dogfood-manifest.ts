import type { ReleaseTarget } from "./common.ts";
import { dogfoodObjectKey, dogfoodPrefix, sanitizeDogfoodSegment } from "./dogfood.ts";

export type DogfoodFile = {
  name: string;
  path: string;
  platform: "mac" | "win" | "linux";
  arch: "arm64" | "x64";
  kind: "installer" | "archive";
  size: number;
  sha256: string;
};
export type DogfoodManifest = {
  schemaVersion: 1;
  version: string;
  buildId: string;
  generatedAt: string;
  commit?: string;
  branch?: string;
  environment?: string;
  files: DogfoodFile[];
};

export function dogfoodFile(target: ReleaseTarget, fileName: string, size: number, sha256: string): DogfoodFile {
  const platform = target.startsWith("mac_") ? "mac" : target.startsWith("win_") ? "win" : "linux";
  const arch = target.endsWith("arm64") ? "arm64" : "x64";
  const clean = sanitizeDogfoodSegment(fileName);
  // Local builders use identical mac DMG names for arm64 and x64. Prefix the
  // public name so independent platform uploads can never overwrite each other.
  const name = `${target}-${clean}`;
  const kind = /\.zip$/i.test(clean) ? "archive" : "installer";
  if (!Number.isSafeInteger(size) || size <= 0 || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("invalid dogfood size or SHA256");
  return { name, path: name, platform, arch, kind, size, sha256 };
}

export function mergeDogfoodManifests(manifests: DogfoodManifest[]): DogfoodManifest {
  const first = manifests[0];
  if (first == null) throw new Error("no platform manifests to merge");
  const names = new Set<string>();
  const files: DogfoodFile[] = [];
  for (const m of manifests) {
    if (m.schemaVersion !== 1 || m.version !== first.version || m.buildId !== first.buildId || m.commit !== first.commit || m.branch !== first.branch || m.environment !== first.environment || !Number.isFinite(Date.parse(m.generatedAt))) throw new Error("dogfood platform identity mismatch");
    for (const f of m.files) {
      if (names.has(f.name) || f.path !== f.name || sanitizeDogfoodSegment(f.name) !== f.name || f.size <= 0 || !/^[a-f0-9]{64}$/.test(f.sha256)) throw new Error(`invalid or duplicate dogfood file ${f.name}`);
      dogfoodObjectKey({ buildId: m.buildId, version: m.version, fileName: f.name });
      names.add(f.name); files.push(f);
    }
  }
  if (files.length === 0) throw new Error("no dogfood files to publish");
  return { ...first, generatedAt: manifests.map((m) => m.generatedAt).sort().at(-1)!, files: files.sort((a, b) => a.name.localeCompare(b.name)) };
}

export function manifestKey(version: string, buildId: string, target?: ReleaseTarget): string {
  return dogfoodObjectKey({ version, buildId, fileName: target == null ? "manifest.json" : `manifest-${target}.json` });
}

export function manifestBase(version: string, buildId: string): string { return dogfoodPrefix({ version, buildId }); }
