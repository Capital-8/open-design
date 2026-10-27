# Dogfood mirror import contract

A `publish=false` beta run distributes an explicitly selected test build. It
writes only under `dogfood/<version>/<run>-<attempt>/`; it never publishes a
release channel or an updater feed.

`tools-release publish-dogfood` requires `DOGFOOD_TARGET` (mac_arm64, mac_x64,
win_x64, linux_x64), in addition to the existing version/build/files/storage
inputs. Public artifact names are prefixed with that target, so local builders
may use the same DMG basename without clobbering another architecture. Each
publisher writes `manifest-<target>.json` after all its files have uploaded.

After all enabled builds succeed, `tools-release publish-dogfood-manifest`
reads the targets in `DOGFOOD_TARGETS`, checks their shared build identity and
combines them into `manifest.json`. The Actions summary prints the adaptor and
base URL for the office mirror's “从 URL 同步” dialog.

The manifest is JSON:

```json
{
  "schemaVersion": 1,
  "version": "0.25.1-beta.19",
  "buildId": "40447980505-1",
  "generatedAt": "2026-10-27T04:33:48Z",
  "commit": "<built commit>",
  "branch": "<built branch or ref>",
  "environment": "feature-test",
  "files": [{
    "name": "mac_arm64-Open-Design-release-beta.dmg",
    "path": "mac_arm64-Open-Design-release-beta.dmg",
    "platform": "mac",
    "arch": "arm64",
    "kind": "installer",
    "size": 410010959,
    "sha256": "<64 lowercase hex digits>"
  }]
}
```

Commit, branch and environment are optional display/search labels. Never put
endpoint bindings, tokens or other credentials in them. Paths are relative to
the build directory; files include size and SHA256 so importers can verify the
snapshot before publishing a local download. Installers use kind `installer`;
portable ZIPs use `archive`.

## Historical builds

Dispatch `.github/workflows/dogfood-import-manifest.yml` with the original
release-beta run ID, its exact built version and target environment label. It
downloads the retained GitHub installer artifacts, republishes platform-safe
filenames in the original build directory, writes the manifests and prints the
same import URL. Expired or missing artifacts fail explicitly. It does not
rebuild the app or change any existing unprefixed download URL.

A normal future feature build must include this publishing implementation in
the built ref. Old branches keep their original workflow behavior until the
change is integrated into them.
