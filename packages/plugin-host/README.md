# @nodalcore/plugin-host

Installs, loads, and runs NodalCore plugins. Used by the desktop main
process and the CLI. The desktop shell wires its UI into this package's
seams (window-message emitter, modal dispatcher); the CLI uses the same
APIs headlessly with default no-op fallbacks.

## API

### Installer

```ts
import {
  installPlugin,
  uninstallPlugin,
  listInstalledPlugins,
  getInstalledPlugin,
  readAndValidateManifest,
  reconcileRegistry,
  PLUGINS_DIR,
} from '@nodalcore/plugin-host'
```

#### `installPlugin(options)`

Resolves a plugin source (registry id, git URL, or local directory),
validates `nodal.json` (AJV + `sdkVersion` semver gate), and writes an
entry to `~/.nodalcore/registry.json`. Plugins are copied / cloned into
`~/.nodalcore/plugins/<id>/` as-is — the installer does NOT run
`npm install` or hoist `node_modules`. Plugins are expected to ship as
self-contained bundles (see `docs/plugin-packaging.md`).

```ts
const manifest = await installPlugin({ source: 'https://github.com/…/my-plugin' })
const manifest = await installPlugin({ source: './local-plugin-dir' })
```

#### `listInstalledPlugins()` / `getInstalledPlugin(id)`

Read entries from `~/.nodalcore/registry.json`.
`reconcileRegistry()` rebuilds it from disk if it gets out of sync.

### Device-bridge loader

```ts
import { loadDevicePlugin, unloadDevicePlugin, sendToPlugin, listLoadedPlugins }
  from '@nodalcore/plugin-host'

const plugin = await loadDevicePlugin('com.example.my-sensor')
await plugin.connect({
  connectionType: 'serial', port: '/dev/ttyUSB0', baudRate: 115200,
})
await plugin.disconnect()
await unloadDevicePlugin('com.example.my-sensor')
```

`loadDevicePlugin` forks a worker (`worker.js`) that dynamic-imports the
plugin's `manifest.main` module and runs its `activate(ctx)` export. The
returned `LoadedDevicePlugin` exposes only `connect` / `disconnect` —
settings and host notifications travel through the `ctx` the worker
builds for the plugin, not through this proxy.

`sendToPlugin(id, method, args)` lets the host issue requests INTO the
worker (used today for routing webview → plugin messages). A crash in the
plugin worker is contained — it does not take down the host.

### Standalone-tool spawner

```ts
import { spawnTool, stopTool, getRunningTool, listRunningTools }
  from '@nodalcore/plugin-host'

const tool = await spawnTool('com.example.my-tool')   // tool.port → tool's own gRPC service
await stopTool('com.example.my-tool')
```

The spawner first starts the host-side gRPC `HostAPI` server on a random
localhost port, then spawns the executable with
`NODALCORE_HOST_PORT` / `NODALCORE_PLUGIN_ID` / `NODALCORE_PLUGIN_DIR`
in the env. It waits for the child to print `NODALCORE_READY <port>\n`
on stdout (10 s timeout) before resolving.

### Configuration store (host-side, schema-driven)

```ts
import {
  getConfiguration, setConfiguration, clearConfiguration,
  setConfigurationChangeEmitter,
} from '@nodalcore/plugin-host'

const cfg = await getConfiguration('com.example.my-sensor')
await setConfiguration('com.example.my-sensor', { unit: 'celsius' })

// Optional: notify the running plugin (or whoever) when settings change.
// Default is no-op; the desktop app wires this to push the new config to
// the affected plugin worker via sendToPlugin.
setConfigurationChangeEmitter(async (pluginId, newConfig) => { /* ... */ })
```

Backed by `~/.nodalcore/configurations.json`. The schema for each plugin's
values comes from its `manifest.contributes.configuration.properties`.
`setConfiguration` is a **merge**, not a replace.

Plugins read their own configuration via `ctx.workspace.getConfiguration()`
which goes through the broker — the host store is the single source of
truth, there is no plugin-local copy.

### Connection-options store (host-private)

```ts
import {
  getConnectionOptions, setConnectionOptions, clearConnectionOptions,
} from '@nodalcore/plugin-host'
```

Persists the last-used `ConnectionOptions` per plugin so the renderer's
Connect dialog can pre-fill. Writes are gated on a successful
`device:connect` so we never persist a broken value. Plugins themselves
do not read this store.

### Broker + host-API server

```ts
import {
  registerHostHandler, dispatchHostRequest,
  registerHostApiHandlers,
  setWindowMessageEmitter, setModalDispatcher,
  startHostApiGrpcServer,
} from '@nodalcore/plugin-host'
import type {
  HostHandler, WindowMessageEmitter, WindowMessagePayload, ModalDispatcher,
  HostApiGrpcServer,
} from '@nodalcore/plugin-host'
```

`broker.dispatchHostRequest(pluginId, method, args)` is the single
source-of-truth router for every host call from a plugin, regardless of
transport. `registerHostHandler` is how subsystems wire methods in.

`registerHostApiHandlers()` registers the standard set:
`window.showMessage`, `window.showWarning`, `window.showModal`,
`workspace.getConfiguration`, `workspace.setConfiguration`. Two seams
let the embedding shell plug native UI in:

- `setWindowMessageEmitter(fn)` — called every time a plugin emits
  `showMessage`. The desktop shell forwards the payload to the
  renderer's toast component (and queues it while the window is hidden);
  the CLI / headless contexts log it to stderr.
- `setModalDispatcher(d)` — called for `showWarning` / `showModal`. The
  desktop shell wires this to `dialog.showMessageBox` (FIFO-serialized);
  headless contexts get a default no-op that logs and returns the cancel
  button id, so plugins awaiting input don't deadlock.

`startHostApiGrpcServer({ pluginId })` starts a gRPC server on a random
localhost port that translates `HostAPI.Request` calls from a standalone
tool into `dispatchHostRequest(...)` — same broker, different transport.

### Contributions aggregator

```ts
import { listContributions } from '@nodalcore/plugin-host'
import type {
  AggregatedContributions, AggregatedTheme,
  AggregatedSidebarSlot, AggregatedStatusBarSlot, AggregatedPanelWebview,
} from '@nodalcore/plugin-host'

const contrib = await listContributions()
// { themes, sidebar, statusBar, panels }
```

Walks `~/.nodalcore/registry.json` and returns a flat per-surface view:
themes are loaded from disk and inlined as CSS-var maps, panel webviews
carry their resolved `nodal-plugin://<id>/<path>` HTML reference. The
renderer fetches this once on mount and on install/uninstall.

### Artifact helpers

```ts
import {
  describeCurrentPlatform, selectArtifact,
  hashFile, downloadArtifact, verifyIntegrity, unpackArtifact,
  UnsupportedPlatformError, IntegrityError,
} from '@nodalcore/plugin-host'
import type { PlatformDescriptor } from '@nodalcore/plugin-host'
```

For installs that come through the registry's `artifacts` array (rather
than `git clone`): pick a platform-matching artifact, download, hash,
verify against the manifest's `integrity` field, and unpack.
See [`docs/plugin-packaging.md`](../../docs/plugin-packaging.md).

## Local storage layout

| Path | Contents |
|---|---|
| `~/.nodalcore/plugins/<id>/` | Plugin source (clone / copy / unpacked artifact) |
| `~/.nodalcore/registry.json` | Installed plugin metadata + status |
| `~/.nodalcore/configurations.json` | Host-side per-plugin configuration store |
| `~/.nodalcore/connections.json` | Host-private last-used `ConnectionOptions` per plugin |
