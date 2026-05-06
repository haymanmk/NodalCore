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

A Node.js plugin artifact should be a `.tgz` archive with a plugin root that
contains:

- `nodal.json`
- compiled service code referenced by `main` (device-bridge) or `executable` (standalone-tool)
- runtime assets the manifest's `contributes` block points at — theme JSON
  files, panel webview HTML / JS / CSS / images
- platform-specific native binaries when needed
- any package files required by the bundled runtime

Plugins MUST bundle their JavaScript dependencies into the compiled runtime
output. The installer does NOT run `npm install` on the plugin directory and
does NOT hoist any host-side `node_modules` into reach of the plugin. A
plugin installed at `~/.nodalcore/plugins/<id>/` is run against an empty
node_modules tree — anything not inlined into the bundle will throw
`ERR_MODULE_NOT_FOUND` at activation time.

### Recommended tsup config

Both reference plugins use this pattern (see
[`examples.md`](./examples.md)):

```ts
// tsup.config.ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },           // or { tool: 'src/tool.js' }
  outDir: 'dist',                             // or 'bin' for standalone-tool
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  noExternal: [/.*/],                         // inline ALL deps
  banner: {
    js: [
      'import { createRequire as __nodalcoreCreateRequire } from "node:module";',
      'const require = __nodalcoreCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  dts: true,
  clean: true,
})
```

Two non-obvious bits:

- **`noExternal: [/.*/]`** is critical. By default tsup externalizes
  every entry in `dependencies`. Without this regex, your bundle will
  have bare `import { … } from '@nodalcore/sdk'` lines that fail at
  runtime.
- **The `createRequire` banner** is needed because `@grpc/grpc-js` (a
  transitive SDK dep, pulled in even when the plugin doesn't directly
  use gRPC) calls dynamic `require()` internally. esbuild can't
  statically resolve those when emitting ESM, so it emits a polyfill
  that throws "Dynamic require of X is not supported." The banner
  defines a real `require` from `import.meta.url` so the polyfill is
  bypassed.

Standalone-tool entries should additionally set
`banner.js` to start with `#!/usr/bin/env node` if the bin file is
executed directly (and remove any shebang from the source — tsup
otherwise duplicates it).

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

Local source-directory installs **copy** the source into a staging directory
under `~/.nodalcore/plugins/_tmp_local_<ts>/` before the atomic swap. This
is a deliberate change from earlier behavior, where the installer would
rename the user's working tree into place — moving their checkout out
from under them. Local installs still don't rebuild; you must run
`pnpm build` (or whatever your bundler invocation is) on the source
before installing.

## Runtime Flow

The standalone tool spawner should continue launching JavaScript tools with the
host Node.js runtime:

```ts
process.execPath
```

When spawning a service, the host sets the working directory to the plugin
install directory and provides these environment variables:

- `NODALCORE_PLUGIN_ID` — the plugin's manifest `id`
- `NODALCORE_PLUGIN_DIR` — absolute path to `~/.nodalcore/plugins/<id>/`
- `NODALCORE_HOST_PORT` — TCP port of the host's gRPC HostAPI service.
  The tool dials `localhost:<port>` to access `host.window.*` /
  `host.workspace.*` etc. See [`host-api.md`](./host-api.md).

The host's gRPC server is started **before** the tool process is spawned,
so the port is dialable as soon as the child boots. The tool must
finish activation (host calls + starting its own service) before
printing `NODALCORE_READY <port>` on stdout — the spawner waits for
that line within a 10-second window.

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
- `packages/plugin-host/src/spawner.ts` — orchestrates standalone-tool
  startup: starts the host-side gRPC HostAPI server first
  (`startHostApiGrpcServer`), spawns the executable with `cwd` set to
  the plugin install directory and `NODALCORE_PLUGIN_ID`,
  `NODALCORE_PLUGIN_DIR`, `NODALCORE_HOST_PORT` exported, then waits
  for `NODALCORE_READY <port>` on stdout. The host gRPC server is
  torn down on `stopTool` and on the child's exit event. JS entry
  points are still launched with `process.execPath`.
- `packages/plugin-host/src/host-api/grpc-server.ts` — implements the
  HostAPI gRPC service. A single `Request(plugin_id, method, args_json)`
  RPC dispatches into the same `dispatchHostRequest` broker the IPC
  loader uses. Host handlers are registered once via
  `registerHostApiHandlers` regardless of which transport delivers the
  call.

### Fallback behavior

| Source                               | Path taken            |
|--------------------------------------|-----------------------|
| Git URL (`http(s)://`, `git@`)       | `git clone`           |
| Existing local directory             | copy into staging, then atomic swap |
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
