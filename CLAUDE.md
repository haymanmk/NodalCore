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
      fork() worker → dynamic import of plugin entry
      Node IPC proxy returned to main process

User edits settings → Apply
  → IPC: settings:write
  → main: plugin.writeSettings(settings)  ← forwarded over IPC to worker
```

## Important files

| File | Purpose |
|---|---|
| `packages/sdk/src/types/manifest.ts` | `PluginManifest` — the `nodal.json` schema |
| `packages/sdk/src/types/device-plugin.ts` | `DevicePlugin` abstract class |
| `packages/plugin-host/src/installer.ts` | Install / uninstall, local registry at `~/.nodalcore/registry.json` |
| `packages/plugin-host/src/loader.ts` | Fork + IPC proxy for device-bridge plugins |
| `packages/plugin-host/src/spawner.ts` | Spawn + stdout handshake for standalone tools |
| `packages/registry-client/src/index.ts` | `fetchIndex`, `searchPlugins`, `getPlugin` |
| `packages/renderer/src/mockRegistry.ts` | 8 mock plugins shown when live registry is down |
| `packages/renderer/src/hooks/usePluginBridge.ts` | Abstracts IPC bridge (Electron) vs. stub (web) |
| `apps/desktop/src/main/index.ts` | All IPC handlers |
| `apps/desktop/src/preload/index.ts` | `window.__nodalcore` contextBridge surface |
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
