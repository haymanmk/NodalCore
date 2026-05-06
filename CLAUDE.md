# CLAUDE.md — NodalCore

AI assistant context for this repository. Read this before making changes.

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
# Install all workspace deps
pnpm install

# Start desktop app (hot-reload)
pnpm dev                          # or: pnpm --filter @nodalcore/desktop dev

# Build everything
pnpm build                        # pnpm -r build

# Type-check everything
pnpm typecheck                    # pnpm -r typecheck

# Lint / format
pnpm lint
pnpm format
```

> **Important:** `ELECTRON_RUN_AS_NODE=1` is set by Claude Code's environment and
> makes Electron behave like plain Node.js. The desktop dev script unsets it:
> `ELECTRON_RUN_AS_NODE= electron-vite dev`. Do not remove this prefix.

## Key architectural decisions

| Decision | Reason |
|---|---|
| pnpm workspaces | Single lockfile, fast installs, strict hoisting |
| electron-vite | Hot-reload for all three Electron targets (main/preload/renderer) in one config |
| Source aliases in Vite | `@nodalcore/*` packages resolve to their TS source at dev time — no need to rebuild packages before testing in the app |
| VSCode-style manifest (`contributes` block) | `nodal.json` separates metadata + activation from declarative contribution points (`themes`, `configuration`, sidebar/statusBar slots, panel webviews). Old top-level `entry`/`settingsSchema` are rejected by the installer. `main` is the activation entry for device-bridge plugins. |
| Uniform host API | Plugins call `ctx.window.*` / `ctx.workspace.*` regardless of plugin type. Device-bridge uses Node IPC over the fork worker; standalone tools will use gRPC (commit 4). The SDK surface is identical; only the underlying transport differs. |
| Host-side configuration store | Settings live in `~/.nodalcore/configurations.json`, not inside the plugin. Schemas come from `manifest.contributes.configuration`. The host owns reads/writes; plugins read via `ctx.workspace.getConfiguration()`. |
| `sdkVersion` enforcement | `installer.ts` rejects manifests whose `sdkVersion` semver range doesn't satisfy the host's `SDK_VERSION` (`packages/sdk/src/version.ts`). Bump that constant alongside `packages/sdk/package.json` on every SDK release. |
| RJSF for settings UI | Settings forms are driven entirely by the plugin's JSON Schema — no hand-coded form fields |
| Child-process isolation for plugins | Device-bridge plugins run in `fork()`-ed workers; a crash or hang does not take down the host |
| Static JSON registry on GitHub Pages | Zero ops — registry updates land via PR; 5-min TTL client-side cache |
| Mock registry fallback | `StorePage` falls back to `MOCK_REGISTRY` in `packages/renderer/src/mockRegistry.ts` when the live registry URL is unreachable (useful in dev) |

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
      → host-api/server.ts handlers (window.showMessage, workspace.*)

User edits settings → Apply
  → IPC: settings:write
  → main: setConfiguration(pluginId, settings)  ← plugin-host/configuration.ts
      writes to ~/.nodalcore/configurations.json (host-side store)
      plugins read via ctx.workspace.getConfiguration() — never the plugin proxy
```

## Important files

| File | Purpose |
|---|---|
| `packages/sdk/src/types/manifest.ts` | `PluginManifest` — the `nodal.json` schema |
| `packages/sdk/src/types/contributes.ts` | `Contributes` block (themes, configuration, sidebar/statusBar, webviews) |
| `packages/sdk/src/types/device-plugin.ts` | `DevicePlugin` abstract class (now just `connectionType` + `connect`/`disconnect`) |
| `packages/sdk/src/host/index.ts` | Host API surface: `Transport`, `ExtensionContext`, `WindowApi`, `WorkspaceApi`, `createIpcTransport`, `createExtensionContext`, `coalesceLastWins` |
| `packages/sdk/src/version.ts` | `SDK_VERSION` constant — keep in sync with `packages/sdk/package.json` |
| `packages/plugin-host/src/installer.ts` | Install / uninstall, manifest validation, `sdkVersion` semver check, local registry at `~/.nodalcore/registry.json` |
| `packages/plugin-host/src/configuration.ts` | Host-side settings store at `~/.nodalcore/configurations.json` |
| `packages/plugin-host/src/broker.ts` | Single-source-of-truth router for plugin → host requests |
| `packages/plugin-host/src/host-api/server.ts` | Registers `window.showMessage`, `workspace.getConfiguration`, `workspace.setConfiguration`; `setWindowMessageEmitter` lets the desktop shell forward toasts |
| `packages/plugin-host/src/loader.ts` | Fork + bidirectional IPC envelope for device-bridge plugins |
| `packages/plugin-host/src/spawner.ts` | Spawn + stdout handshake for standalone tools |
| `packages/registry-client/src/index.ts` | `fetchIndex`, `searchPlugins`, `getPlugin` |
| `packages/renderer/src/mockRegistry.ts` | 8 mock plugins shown when live registry is down |
| `packages/renderer/src/hooks/usePluginBridge.ts` | Abstracts IPC bridge (Electron) vs. stub (web) |
| `apps/desktop/src/main/index.ts` | All IPC handlers; wires `setWindowMessageEmitter` to the renderer |
| `apps/desktop/src/preload/index.ts` | `window.__nodalcore` contextBridge surface, including `onHostMessage` |
| `apps/desktop/electron.vite.config.ts` | Source aliases for all workspace packages |

## Coding conventions

- **TypeScript strict** everywhere. No `any` unless behind an eslint-disable comment with a reason.
- **ESM** throughout (`"type": "module"` in every package). CJS interop is handled by tsup's dual `esm`+`cjs` output.
- **No default exports** except where a library forces it (RJSF, validator). Use named exports.
- **No comments** unless the *why* is non-obvious. File names and type names should be self-documenting.
- **CSS** lives in `packages/renderer/src/styles/index.css`. Use CSS custom properties (`--accent`, `--surface`, etc.) — never hardcode colours. All new UI classes go in that file.
- **React**: function components only, no class components. Hooks live in `src/hooks/`.

## What is NOT in this repo

- The live registry index (`https://nodalcore.github.io/registry/index.json`) — hosted separately on GitHub Pages.
- Built plugin packages — plugins are installed from their own git repos at runtime.
- The local plugin store (`~/.nodalcore/`) — user data, not source code.
