# @nodalcore/desktop

Electron 34 desktop application. Hosts the plugin store UI, manages plugin
installation, runs device-bridge plugins in forked workers, spawns
standalone-tool processes, and renders panel webviews. The renderer
(`@nodalcore/renderer`) reaches the Node side exclusively through the
preload bridge.

## Structure

```
src/
  main/
    index.ts            Wires IPC handlers, BrowserWindow, tray, modal dispatcher
    tray.ts             System tray icon + Open/Quit menu, unread-toast indicator
    window-state.ts     Visibility helpers; close [X] hides to tray
    notifications/
      queue.ts          Queue toasts emitted while the window is hidden
      modal.ts          Native dialog dispatcher (FIFO-serialized) for
                        window.showWarning / window.showModal
    webviews/
      protocol.ts       nodal-plugin:// privileged scheme + per-request handler
      manager.ts        WebContentsView lifecycle (one panel visible at a time)
      routing.ts        Bridges panel ↔ plugin via the broker

  preload/
    index.ts            BrowserWindow contextBridge → window.__nodalcore
    webview.ts          Separate preload for WebContentsViews → window.nodalcore

  renderer/
    index.html          Shell HTML
    src/main.tsx        Mounts <App /> from @nodalcore/renderer
```

## Running

```bash
pnpm dev      # electron-vite dev — hot-reload for main / preload / renderer
pnpm build    # electron-vite build → out/
pnpm preview  # run the built app
```

> The `dev` script explicitly unsets `ELECTRON_RUN_AS_NODE` because Claude
> Code sets it to `1`, which causes Electron to behave like plain Node.js.

## IPC surface

The renderer reaches main through `window.__nodalcore` (BrowserWindow
preload). Panel webviews reach main through a separate `window.nodalcore`
bridge (webview preload).

### Renderer → main (`window.__nodalcore`)

| Channel | Action |
|---|---|
| `plugin:list` | `listInstalledPlugins()` |
| `plugin:install` | `installPlugin({ source })` — clone/copy + validate + register |
| `plugin:uninstall` | `uninstallPlugin(id)` |
| `device:connect` | `loadDevicePlugin(id)` then `plugin.connect(options)`; persists `options` to the connection-options store on success |
| `device:disconnect` | `unloadDevicePlugin(id)` |
| `connection:read` | Read the last-used `ConnectionOptions` for a plugin (used to pre-fill the Connect dialog) |
| `tool:start` | `spawnTool(id)` — returns the tool's port |
| `tool:stop` | `stopTool(id)` |
| `settings:read` | `getConfiguration(id)` from the host configuration store |
| `settings:write` | `setConfiguration(id, values)` — merge into host store |
| `workspace:show-panel` | Create / show a `WebContentsView` for `(pluginId, slotId, htmlPath)` |
| `workspace:hide-panel` | Hide the active panel (view kept around for re-open) |
| `workspace:destroy-panel` | Tear down a panel view |
| `workspace:set-bounds` | Renderer's `ResizeObserver` reports the layout rectangle |
| `host:ready` | Renderer signals it is mounted; main flushes the queued-toast buffer |

### Main → renderer (push)

| Channel | Purpose |
|---|---|
| `host:window:showMessage` | Toast emitted by a plugin (or replayed from the queue on `host:ready`) |
| `webview:msg-from-plugin` | Plugin → panel messages, delivered to the right `WebContents` |

### Webview → main (`window.nodalcore`, panel preload)

| Channel | Purpose |
|---|---|
| `webview:msg-to-plugin` | Panel JS calls `window.nodalcore.postMessage(data)`; main resolves `(pluginId, slotId)` from the sender and routes through the broker to the plugin's `ctx.views.onMessage` handler |

The full panel pipeline (privileged scheme registration, CSP, layout
choreography, message routing) is documented in
[`docs/webviews.md`](../../docs/webviews.md).

## Vite aliases

`electron.vite.config.ts` resolves all `@nodalcore/*` imports to TypeScript
source at dev time — no package rebuilds needed during development. The
preload bundle has two entries (`index` + `webview`) so the panel preload
ships independently of the BrowserWindow preload.
