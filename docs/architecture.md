# Architecture

## System overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        User interfaces                           │
│                                                                  │
│  ┌────────────────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │  Desktop (Electron)│  │  Web (Vite)  │  │  CLI / REPL / MCP │ │
│  │  apps/desktop/     │  │  apps/web/   │  │  apps/cli/        │ │
│  └────────┬───────────┘  └──────┬───────┘  └────────┬──────────┘ │
│           │ IPC (contextBridge) │ fetch (read-only) │ Node.js    │
└───────────┼─────────────────────┼───────────────────┼────────────┘
            │                     │                   │
┌───────────▼─────────────────────▼───────────────────▼────────────┐
│                      Shared packages                             │
│                                                                  │
│  @nodalcore/renderer      React components + CSS theme           │
│  @nodalcore/registry-client  fetchIndex / searchPlugins          │
│  @nodalcore/plugin-host   install · load · spawn                 │
│  @nodalcore/sdk           Types: PluginManifest, DevicePlugin …  │
└───────────────────────────────────────────────────────────────┬──┘
                                                                │
                    ┌───────────────────────────────────────────▼──┐
                    │           Plugin processes                   │
                    │                                              │
                    │  ┌───────────────────┐  ┌──────────────────┐ │
                    │  │  device-bridge    │  │ standalone-tool  │ │
                    │  │  fork() + IPC     │  │ spawn() + stdout │ │
                    │  │  e.g. multimeter  │  │ e.g. FFT tool    │ │
                    │  └───────────────────┘  └──────────────────┘ │
                    └──────────────────────────────────────────────┘
```

## Data flow — settings round-trip

```
Plugin manifest (nodal.json)
  └── settingsSchema: JSONSchema7
        │
        ▼
  SettingsPanel receives schema prop
        │  RJSF reads "default" values → pre-fills form
        │
        ▼
  User edits → clicks Apply
        │
        ▼
  onSubmit callback → usePluginBridge.writeSettings(id, data)
        │
        ├── Electron:  IPC "settings:write" → main → plugin worker
        └── Web:       throws (read-only mode)
```

## IPC bridge

The renderer never calls Node.js directly. The preload script
(`apps/desktop/src/preload/index.ts`) exposes a single safe object via
`contextBridge`:

```
window.__nodalcore = {
  listInstalled, install, uninstall,
  connect, disconnect,
  readSettings, writeSettings,
  startTool, stopTool,
}
```

`usePluginBridge` (`packages/renderer/src/hooks/usePluginBridge.ts`) wraps
this object. In the web app it returns stubs that throw for write operations.

## Plugin host internals

### device-bridge plugins

```
loadDevicePlugin(pluginId)
  1. Read manifest from ~/.nodalcore/plugins/{id}/nodal.json
  2. fork() packages/plugin-host/src/worker.ts
  3. Send { seq, method: "init", args } over Node IPC
  4. Worker: dynamic import(manifest.entry) → call init()
  5. Return an IPC proxy object to the caller
     – every method call is serialised over the IPC channel
```

The forked worker is a thin dispatcher. Crashes in the plugin do not affect
the host process.

### standalone tools

```
spawnTool(pluginId)
  1. Read manifest from ~/.nodalcore/plugins/{id}/nodal.json
  2. spawn(manifest.executable, { stdio: ['pipe','pipe','pipe'] })
  3. Wait for "NODALCORE_READY <port>\n" on stdout (10 s timeout)
  4. Store { process, port } in memory
  5. Caller connects to the tool's gRPC/Connect server on <port>
```

## Registry architecture

```
GitHub Pages (static)
  https://nodalcore.github.io/registry/index.json
        │
        ▼
  registry-client.fetchIndex()       5-min TTL in-memory cache
        │
        ├── StorePage — remote plugins available to install
        └── CLI: plugin search <query>

Local filesystem
  ~/.nodalcore/registry.json         written by plugin-host/installer.ts
        │
        ▼
  listInstalledPlugins()
        │
        ├── InstalledPage — plugins with connect/disconnect UI
        └── CLI: plugin list
```

During development the remote registry URL returns 404, so `StorePage` falls
back to the mock data in `packages/renderer/src/mockRegistry.ts`.

## Interfaces between packages

| Consumer | Package | Entry point |
|---|---|---|
| Desktop main process | `@nodalcore/plugin-host` | `packages/plugin-host/src/index.ts` |
| Desktop main process | `@nodalcore/sdk` | `packages/sdk/src/index.ts` |
| Renderer (all UIs) | `@nodalcore/renderer` | `packages/renderer/src/index.ts` |
| Renderer (all UIs) | `@nodalcore/registry-client` | `packages/registry-client/src/index.ts` |
| CLI | `@nodalcore/plugin-host` + `@nodalcore/registry-client` | — |
| Plugin authors | `@nodalcore/sdk` | Published npm package |

In the desktop dev server (`electron-vite dev`) all `@nodalcore/*` imports
resolve to their TypeScript source via Vite aliases, so workspace packages
do not need to be built before running the app.
