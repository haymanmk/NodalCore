# @nodalcore/desktop

Electron 34 desktop application. Hosts the plugin store UI, manages plugin
installation, and bridges the renderer to the Node.js plugin host.

## Structure

```
src/
  main/index.ts       Main process — IPC handlers, BrowserWindow setup
  preload/index.ts    contextBridge — exposes window.__nodalcore to renderer
  renderer/
    index.html        Shell HTML
    src/main.tsx      React entry — mounts <App /> from @nodalcore/renderer
```

## Running

```bash
pnpm dev      # electron-vite dev — hot-reload for all three targets
pnpm build    # electron-vite build → out/
pnpm preview  # run the built app
```

> The `dev` script explicitly unsets `ELECTRON_RUN_AS_NODE` because Claude
> Code sets it to `1`, which causes Electron to behave like plain Node.js.

## IPC surface

All communication between the renderer and the main process goes through the
`window.__nodalcore` object injected by the preload script.

| Channel | Handler | Action |
|---|---|---|
| `plugin:list` | `listInstalledPlugins()` | List installed plugins |
| `plugin:install` | `installPlugin({ source })` | Clone + validate + register |
| `plugin:uninstall` | `uninstallPlugin(id)` | Remove plugin + registry entry |
| `device:connect` | `loadDevicePlugin(id)` | Fork worker, IPC proxy |
| `device:disconnect` | `unloadDevicePlugin(id)` | Kill worker |
| `settings:read` | `plugin.readSettings()` | Read from plugin worker |
| `settings:write` | `plugin.writeSettings(s)` | Write to plugin worker |
| `tool:start` | `spawnTool(id)` | Spawn executable, return port |
| `tool:stop` | `stopTool(id)` | Kill tool process |

## Vite aliases

`electron.vite.config.ts` resolves all `@nodalcore/*` imports to TypeScript
source at dev time — no package rebuilds needed during development.
