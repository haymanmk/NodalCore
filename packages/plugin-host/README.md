# @nodalcore/plugin-host

Installs, loads, and spawns NodalCore plugins. Used by the desktop main
process and the CLI.

## API

### Installer

```ts
import {
  installPlugin,
  uninstallPlugin,
  listInstalledPlugins,
  getInstalledPlugin,
  readAndValidateManifest,
  PLUGINS_DIR,
} from '@nodalcore/plugin-host'
```

#### `installPlugin(options)`

Clones a git repository (or copies a local directory), validates `nodal.json`,
and writes an entry to `~/.nodalcore/registry.json`.

```ts
const manifest = await installPlugin({ source: 'https://github.com/…/my-plugin' })
const manifest = await installPlugin({ source: './local-plugin-dir' })
```

#### `listInstalledPlugins()`

Returns all entries from `~/.nodalcore/registry.json`.

```ts
const plugins = await listInstalledPlugins()
// [{ manifest, installedAt, status }]
```

### Device-bridge loader

```ts
import { loadDevicePlugin, unloadDevicePlugin } from '@nodalcore/plugin-host'

const plugin = await loadDevicePlugin('com.example.my-sensor')
await plugin.connect({ type: 'serial', port: '/dev/ttyUSB0', baudRate: 115200 })
const settings = await plugin.readSettings()
await plugin.writeSettings({ unit: 'celsius' })
await unloadDevicePlugin('com.example.my-sensor')
```

`loadDevicePlugin` forks a worker process and returns a transparent IPC proxy.
The plugin's entry module (`manifest.entry`) is dynamically imported inside
the worker; crashes in the plugin do not affect the host.

### Standalone tool spawner

```ts
import { spawnTool, stopTool, getRunningTool } from '@nodalcore/plugin-host'

const tool = await spawnTool('com.example.my-tool')
// tool.port — gRPC/Connect port to connect to

await stopTool('com.example.my-tool')
```

The spawner waits for the process to print `NODALCORE_READY <port>` on stdout
(10 s timeout) before resolving.

## Local storage

| Path | Contents |
|---|---|
| `~/.nodalcore/plugins/<id>/` | Plugin source (git clone or local copy) |
| `~/.nodalcore/registry.json` | Installed plugin metadata + status |
