# Plugin Packaging and Runtime Dependencies

## Summary

Registry plugins should install from prebuilt artifacts instead of running
package-manager installs on user machines. For Node.js-backed services, the
default artifact format is a `.tgz` containing everything needed to start the
plugin service with the host Node.js runtime.

This keeps installs reproducible, avoids depending on end-user compiler or npm
configuration, and gives the host a clear place to verify integrity before a
plugin is registered.

## Default Policy

- Registry installs use prebuilt artifacts.
- Adaptive `npm install`, `pnpm install`, or `yarn install` during installation
  is reserved for local development or an explicit dev-only workflow.
- Plugin authors or plugin CI are responsible for building and publishing
  installable artifacts.
- The installed plugin directory must be runnable without contacting the npm
  registry.

## Artifact Shape

A Node.js service artifact should be a `.tgz` archive with a plugin root that
contains:

- `nodal.json`
- compiled service code referenced by `entry` or `executable`
- runtime assets required by the service
- platform-specific native binaries when needed
- any package files required by the bundled runtime

Most plugins should bundle their JavaScript dependencies into compiled runtime
output and avoid shipping a full `node_modules` tree. Shipping selected runtime
package files or `node_modules` is allowed when a dependency cannot be bundled
cleanly, but the artifact must still be complete at install time.

## Registry Metadata

The registry should advertise install artifacts separately from source
repository metadata. A future registry entry should support an `artifacts`
array:

```json
{
  "artifacts": [
    {
      "url": "https://registry.example.com/plugins/com.example.tool/1.0.0/linux-x64.tgz",
      "integrity": "sha256:<hex>",
      "os": "linux",
      "cpu": "x64",
      "libc": "glibc",
      "nodeRange": ">=20",
      "size": 1234567
    }
  ]
}
```

Field meanings:

- `url`: direct download URL for the artifact
- `integrity`: SHA-256 digest in `sha256:<hex>` format
- `os`: target `process.platform`
- `cpu`: target `process.arch`
- `libc`: optional Linux libc selector, such as `glibc` or `musl`
- `nodeRange`: optional compatible Node.js version range
- `size`: optional byte size for display and validation

Existing fields such as `repository` and `manifestUrl` should remain useful for
source visibility and development, but registry installation should prefer a
matching artifact when one is available.

## Install Flow

The plugin host should install registry plugins with this flow:

1. Resolve the plugin id from the registry.
2. Select the best artifact for the current OS, CPU, Linux libc, and Node.js
   version.
3. Download the artifact into a temporary location.
4. Verify the artifact against its `integrity` value.
5. Unpack into a temporary plugin directory.
6. Validate `nodal.json`.
7. Move the validated directory into `~/.nodalcore/plugins/<id>/`.
8. Register the plugin in `~/.nodalcore/registry.json`.

The final move should be atomic where the platform allows it. Failed downloads,
integrity mismatches, unsupported platforms, malformed manifests, and unpack
errors must leave the previous installed version intact.

Local source-directory installs may keep the existing behavior so plugin authors
can iterate without building an artifact for every edit.

## Runtime Flow

The standalone tool spawner should continue launching JavaScript tools with the
host Node.js runtime:

```ts
process.execPath
```

When spawning a service, the host should set the working directory to the plugin
install directory and provide stable environment variables:

- `NODALCORE_PLUGIN_ID`
- `NODALCORE_PLUGIN_DIR`

Additional host IPC or service endpoint variables can be added later without
changing the artifact model.

## Native Modules

Native npm modules should be supported through platform-specific artifacts, not
install-time compilation on the user's machine. A plugin that depends on native
code should publish separate artifacts for each supported OS, CPU, and Linux
libc combination.

If no compatible artifact exists, installation should fail with an unsupported
platform error before downloading or modifying the installed plugin directory.

## Implementation

The artifact install path is implemented in `@nodalcore/plugin-host`. The
relevant modules are:

- `packages/registry-client/src/types.ts` — defines `RegistryArtifact` and the
  optional `artifacts?: RegistryArtifact[]` field on `RegistryPluginEntry`.
- `packages/plugin-host/src/artifact.ts` — pure helpers:
  - `describeCurrentPlatform()` reports `os`, `cpu`, `libc`, and `nodeVersion`.
    libc detection prefers `process.report.getReport().header.glibcVersionRuntime`
    and falls back to parsing `ldd --version`.
  - `selectArtifact(artifacts, platform?)` filters by OS+CPU first, then by
    libc on Linux, then by `nodeRange` via `semver`. It returns `undefined`
    when no OS/CPU match exists and throws `UnsupportedPlatformError` when
    OS/CPU candidates exist but no candidate satisfies the libc / Node
    constraints. Among matches, the most specific entry (libc + nodeRange
    both set) wins.
  - `downloadArtifact(url, destPath)` streams `fetch` to disk via
    `stream/promises.pipeline`.
  - `verifyIntegrity(filePath, expected)` streams a SHA-256 hash and throws
    `IntegrityError` on mismatch.
  - `unpackArtifact(tgzPath, destDir)` extracts the archive with `tar.x`.
- `packages/plugin-host/src/installer.ts` — orchestrates the install flow:
  - `resolveSource()` returns one of `git`, `local`, or `artifact`. A registry
    id whose entry exposes a matching artifact resolves to `artifact`. A
    registry id with `artifacts[]` but no compatible match throws
    `UnsupportedPlatformError`. A registry id without `artifacts[]` falls back
    to cloning `repository`, which lets the registry migrate one plugin at a
    time without breaking installs.
  - `installFromArtifact()` downloads to
    `~/.nodalcore/plugins/_dl_<id>_<ts>.tgz`, verifies, unpacks into
    `~/.nodalcore/plugins/_tmp_<id>_<ts>/`, validates `nodal.json`, asserts
    the manifest id matches the registry id, then atomically swaps the
    staging dir into place. The download file is always cleaned up; the
    staging dir is removed on failure; the previous installed version
    survives any failure before the swap.
  - `atomicReplaceDir(stagingDir, finalDir)` renames an existing `finalDir`
    to `<finalDir>.old`, renames the staging dir into `finalDir`, and removes
    the backup. If the second rename fails it rolls back from `<finalDir>.old`.
    Both paths live under `PLUGINS_DIR` so they share a filesystem and the
    renames are atomic on POSIX.
- `packages/plugin-host/src/spawner.ts` — when launching a standalone tool the
  spawner sets `cwd` to the plugin install directory and exports both
  `NODALCORE_PLUGIN_ID` and `NODALCORE_PLUGIN_DIR`. JS entry points are still
  launched with `process.execPath`.

### Fallback behavior

| Source                               | Path taken            |
|--------------------------------------|-----------------------|
| Git URL (`http(s)://`, `git@`)       | `git clone`           |
| Existing local directory             | use directory in place |
| Registry id, entry has matching artifact   | download + verify + unpack |
| Registry id, entry has artifacts but none match platform | `UnsupportedPlatformError` |
| Registry id, entry has no `artifacts[]`     | clone `repository` (legacy) |

The legacy git-clone fallback is intentional — it allows the live registry
index to gain `artifacts[]` entries plugin-by-plugin without an atomic
flag-day migration.

## Testing Notes

Implementation should cover these cases:

- artifact selection for OS, CPU, libc, and Node.js version
- no compatible artifact available
- artifact download failure
- SHA-256 integrity mismatch
- malformed or missing `nodal.json`
- successful local `.tgz` install into a temporary plugin directory
- successful spawn of a bundled Node.js standalone tool with a runtime
  dependency
- regression coverage for existing local source-directory installs
