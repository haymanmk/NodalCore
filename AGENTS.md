# AGENTS.md — NodalCore

Instructions for AI coding agents working in this repository. Read this before making changes.

## What this project is

NodalCore is a **pnpm monorepo** that serves as a hub for in-house hardware-integration tools and plugins. It exposes a plugin model where each plugin is either a **device-bridge** (wraps a physical device over serial/USB/BLE/TCP/MQTT) or a **standalone tool** (an independent process that communicates over gRPC/Connect). Plugins are installed from a central registry and managed through a desktop GUI, a web catalog, or a CLI/REPL/MCP server.

## Monorepo layout

```
apps/
  desktop/   Electron 34 shell — main process, preload, renderer (Vite)
  web/       Read-only Vite catalog browser (no device access)
  cli/       Node.js CLI, interactive REPL, MCP server over stdio

packages/
  sdk/             @nodalcore/sdk — shared types (PluginManifest, DevicePlugin, …)
  plugin-host/     @nodalcore/plugin-host — installer, IPC loader, tool spawner
  registry-client/ @nodalcore/registry-client — fetch/search the remote registry
  renderer/        @nodalcore/renderer — React components shared by desktop + web

examples/
  plugin-device-bridge/    Multimeter over serial (reference implementation)
  plugin-standalone-tool/  Image processor (reference implementation)

docs/           Cross-cutting architecture docs (see docs/architecture.md)
```

## Commands

```bash
pnpm install            # install all workspace deps
pnpm dev                # start desktop app with hot-reload
pnpm build              # build everything (pnpm -r build)
pnpm typecheck          # type-check everything (pnpm -r typecheck)
pnpm lint
pnpm format
```

> **Important:** `ELECTRON_RUN_AS_NODE=1` may be set by the surrounding agent
> environment, which makes Electron behave like plain Node.js. The desktop `dev`
> script routes through `apps/desktop/scripts/dev.mjs`, which `delete`s the env
> var before spawning `electron-vite dev`. Same behavior on POSIX and Windows;
> do not bypass the wrapper.

## Key architectural decisions

| Decision | Reason |
|---|---|
| pnpm workspaces | Single lockfile, fast installs, strict hoisting |
| electron-vite | Hot-reload for all three Electron targets (main/preload/renderer) in one config |
| Source aliases in Vite | `@nodalcore/*` packages resolve to their TS source at dev time — no need to rebuild packages before testing in the app |
| VSCode-style manifest (`contributes` block) | `nodal.json` separates metadata + activation from declarative contribution points (`themes`, `configuration`, sidebar/statusBar slots, panel webviews). Old top-level `entry`/`settingsSchema` are rejected by the installer. `main` is the activation entry for device-bridge plugins. |
| Uniform host API | Plugins call `ctx.window.*` / `ctx.workspace.*` / `ctx.views.*` regardless of plugin type. Device-bridge uses Node IPC over the fork worker; standalone tools use gRPC (`HostAPI.Request` carrying JSON-encoded args). The SDK surface is identical; only the underlying transport differs. |
| Host-side configuration store | Settings live in `~/.nodalcore/configurations.json`, not inside the plugin. Schemas come from `manifest.contributes.configuration`. The host owns reads/writes; plugins read via `ctx.workspace.getConfiguration()`. |
| Panel webviews via `WebContentsView` | Plugin HTML loads in a native `WebContentsView` tiled into the Workspace tab — never an iframe, never overlapping the React shell. The renderer measures the panel rectangle and reports it via `workspace:set-bounds`; main owns layout. One panel visible at a time. |
| `nodal-plugin://` privileged scheme | All panel HTML loads via `nodal-plugin://<pluginId>/<path>`, registered as privileged before `app.whenReady()`. The handler resolves under `~/.nodalcore/plugins/<id>/` with `..`/symlink defenses and applies a locked-down per-plugin-origin CSP. |
| Plugins ship as bundles | The installer just copies; it does NOT run `npm install` or hoist `node_modules`. Both example plugins are bundled with tsup (`noExternal: [/.*/]` + `createRequire` banner) so the installed copy is self-contained. |
| `sdkVersion` enforcement | `installer.ts` rejects manifests whose `sdkVersion` semver range doesn't satisfy the host's `SDK_VERSION` (`packages/sdk/src/version.ts`). Bump that constant alongside `packages/sdk/package.json` on every SDK release. |
| RJSF for settings UI | Settings forms are driven entirely by the plugin's JSON Schema — no hand-coded form fields |
| Child-process isolation for plugins | Device-bridge plugins run in `fork()`-ed workers; a crash or hang does not take down the host |
| Static JSON registry on GitHub Pages | Zero ops — registry updates land via PR; 5-min TTL client-side cache |
| Mock registry fallback | `StorePage` falls back to `MOCK_REGISTRY` in `packages/renderer/src/mockRegistry.ts` when the live registry URL is unreachable (useful in dev) |
| Background mode + native modal API | Closing the window hides to the system tray; the only exit path is the tray's "Quit" item. Plugins get `ctx.window.showWarning` (passive native dialog) and `ctx.window.showModal` (interactive, returns the chosen button id) on top of the existing `showMessage` toast. Modals serialize FIFO across plugins. Toasts emitted while the window is hidden are queued (cap 200, drop-oldest) and flushed on `host:ready`. |

## Plugin lifecycle (desktop)

```
User clicks Install
  → renderer: usePluginBridge.install(id)
  → IPC: plugin:install
  → main: installPlugin({ source: id })   ← plugin-host/installer.ts
      git clone → validate nodal.json → write ~/.nodalcore/registry.json

User clicks Connect
  → IPC: device:connect
  → main: loadDevicePlugin(id)            ← plugin-host/loader.ts
      fork() worker → dynamic import of plugin's `main` module
      worker calls plugin's `activate(ctx)` if exported
      bidirectional IPC envelope { kind: 'request' | 'response', seq, … }
      plugin-side host requests routed through plugin-host/broker.ts
      → host-api/server.ts handlers (window.showMessage / showWarning / showModal, workspace.*)

User edits settings → Apply
  → IPC: settings:write
  → main: setConfiguration(pluginId, settings)  ← plugin-host/configuration.ts
      writes to ~/.nodalcore/configurations.json (host-side store)
      plugins read via ctx.workspace.getConfiguration() — never the plugin proxy

User opens a panel webview (Workspace tab)
  → IPC: workspace:show-panel(pluginId, slotId, htmlPath)
  → main: WebContentsView created, loads nodal-plugin://<pluginId>/<htmlPath>
      preload: apps/desktop/src/preload/webview.ts → window.nodalcore.{postMessage,onMessage}
      renderer ResizeObserver reports area bounds → workspace:set-bounds → view.setBounds(...)

Webview → plugin
  → ipcRenderer.invoke('webview:msg-to-plugin', data)
  → main: lookup (pluginId, slotId) by sender WebContents
  → sendToPlugin(id, 'views.message', { slotId, data }) over the IPC envelope
  → plugin's ctx.views.onMessage(slotId) handler returns a result, propagates back

Plugin → webview
  → ctx.views.postMessage(slotId, data)
  → broker handler 'views.postMessage' → sendToPanel(pluginId, slotId, data)
  → WebContents.send('webview:msg-from-plugin', data) → preload onMessage handler
```

## Important files

| File | Purpose |
|---|---|
| `packages/sdk/src/types/manifest.ts` | `PluginManifest` — the `nodal.json` schema |
| `packages/sdk/src/types/contributes.ts` | `Contributes` block (themes, configuration, sidebar/statusBar, webviews) |
| `packages/sdk/src/types/device-plugin.ts` | `DevicePlugin` abstract class (now just `connectionType` + `connect`/`disconnect`) |
| `packages/sdk/src/host/index.ts` | Host API surface: `Transport`, `ExtensionContext`, `WindowApi`, `WorkspaceApi`, `ViewsApi`, `createIpcTransport`, `createGrpcTransport`, `createExtensionContext`, `coalesceLastWins` |
| `packages/sdk/src/version.ts` | `SDK_VERSION` constant — keep in sync with `packages/sdk/package.json` |
| `packages/plugin-host/src/installer.ts` | Install / uninstall, manifest validation, `sdkVersion` semver check, local registry at `~/.nodalcore/registry.json` |
| `packages/plugin-host/src/configuration.ts` | Host-side settings store at `~/.nodalcore/configurations.json` |
| `packages/plugin-host/src/broker.ts` | Single-source-of-truth router for plugin → host requests |
| `packages/plugin-host/src/host-api/server.ts` | Registers `window.showMessage` / `showWarning` / `showModal`, `workspace.getConfiguration`, `workspace.setConfiguration`; `setWindowMessageEmitter` lets the desktop shell forward toasts; `setModalDispatcher` injects the native-dialog backend (default no-op for headless/CLI) |
| `packages/plugin-host/src/loader.ts` | Fork + bidirectional IPC envelope for device-bridge plugins. Exports `sendToPlugin` so main can issue host → plugin requests (panel routing). |
| `packages/plugin-host/src/spawner.ts` | Spawn + stdout handshake for standalone tools; starts the host gRPC server and passes `NODALCORE_HOST_PORT` to the child |
| `packages/plugin-host/src/contributions.ts` | Aggregates `manifest.contributes` across installed plugins (themes with var maps loaded from disk, sidebar/statusBar slots, panel webviews) |
| `packages/plugin-host/src/host-api/grpc-server.ts` | gRPC `HostAPI.Request` server for standalone tools; routes through the same broker as IPC |
| `packages/registry-client/src/index.ts` | `fetchIndex`, `searchPlugins`, `getPlugin` |
| `packages/renderer/src/mockRegistry.ts` | 8 mock plugins shown when live registry is down |
| `packages/renderer/src/hooks/usePluginBridge.ts` | Abstracts IPC bridge (Electron) vs. stub (web) |
| `apps/desktop/src/main/index.ts` | All IPC handlers; wires `setWindowMessageEmitter`, `setModalDispatcher`, tray, and webview routing |
| `apps/desktop/src/main/tray.ts` | System tray icon + Open/Quit menu; surfaces unread-toast count in tooltip / menu label |
| `apps/desktop/src/main/window-state.ts` | Single source of truth for window visibility (`isWindowVisible`, `showWindow`, `hideWindow`, `beginQuit`); the close [X] handler hides to tray instead of quitting |
| `apps/desktop/src/main/notifications/queue.ts` | In-memory queue (cap 200, drop-oldest) for `showMessage` toasts emitted while the window is hidden; drained on `host:ready` |
| `apps/desktop/src/main/notifications/modal.ts` | Native dialog dispatcher backing `window.showWarning` / `window.showModal`; serializes concurrent calls FIFO via a single promise chain |
| `apps/desktop/src/main/webviews/protocol.ts` | `nodal-plugin://` privileged-scheme registration + per-request handler with `..`/symlink defenses + per-plugin-origin CSP |
| `apps/desktop/src/main/webviews/manager.ts` | `WebContentsView` lifecycle — create per (pluginId, slotId), single visible, bounds from renderer, hot-reload teardown |
| `apps/desktop/src/main/webviews/routing.ts` | Bridges webview ↔ plugin via `webview:msg-to-plugin` / `views.postMessage` broker handler |
| `apps/desktop/src/preload/index.ts` | BrowserWindow contextBridge: `onHostMessage`, `getContributions`, `showPanel`, `setWorkspaceBounds`, … |
| `apps/desktop/src/preload/webview.ts` | Separate preload bundle for `WebContentsView`s — exposes `window.nodalcore.{postMessage,onMessage}` to plugin HTML |
| `apps/desktop/electron.vite.config.ts` | Source aliases + multi-entry preload (`index` + `webview`) |
| `packages/renderer/src/pages/WorkspacePage.tsx` | Third tab — panel launcher rail + ResizeObserver-reporting area; main draws the `WebContentsView` over it |
| `packages/renderer/src/contributions/registry.tsx` | Fetches `__nodalcore.getContributions()`, exposes themes / sidebar / statusBar / panels via React context |

## Coding conventions

- **TypeScript strict** everywhere. No `any` unless behind an eslint-disable comment with a reason.
- **ESM** throughout (`"type": "module"` in every package). CJS interop is handled by tsup's dual `esm`+`cjs` output.
- **No default exports** except where a library forces it (RJSF, validator). Use named exports.
- **No comments** unless the *why* is non-obvious. File names and type names should be self-documenting.
- **CSS** lives in `packages/renderer/src/styles/index.css`. Use CSS custom properties (`--accent`, `--surface`, etc.) — never hardcode colours. All new UI classes go in that file.
- **React**: function components only, no class components. Hooks live in `src/hooks/`.

## Validation before reporting work as done

- Run `pnpm typecheck` and `pnpm lint` for any code change.
- For UI changes, run `pnpm dev` and exercise the affected screen in a browser/Electron window. Type-check passing ≠ feature working.
- For plugin-host changes, exercise both a device-bridge plugin (`examples/plugin-device-bridge`) and a standalone tool (`examples/plugin-standalone-tool`) where relevant.

## What is NOT in this repo

- The live registry index (`https://haymanmk.github.io/NodalCore-Store/registry/index.json`) — hosted separately on GitHub Pages.
- Built plugin packages — plugins are installed from their own git repos at runtime.
- The local plugin store (`~/.nodalcore/`) — user data, not source code.
