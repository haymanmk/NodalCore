# Plan: NodalCore — Plugin Hub for Device & Tool Integration

**TL;DR**: A pnpm monorepo containing an Electron + React desktop app (with an optional web build) that acts as a plugin hub. Two plugin types exist: *device bridges* (connect to hardware, expose a settings schema rendered as adaptive UI) and *standalone tools* (independent processes communicating with the app over the Connect/gRPC protocol). Plugins are Git-repo-based, distributed via a central JSON registry index.

---

## Directory Tree

```
NodalCore/
├── apps/                           ← runnable targets (shipped to users)
│   ├── desktop/                    ← Electron shell
│   │   └── src/
│   │       ├── main/               ← Electron main process + Connect/gRPC server
│   │       └── preload/            ← contextBridge API
│   ├── web/                        ← catalog-browse web app (Vite, no device access)
│   │   └── src/                    ← thin shell; imports packages/renderer
│   └── cli/                        ← nodalcore binary, REPL, MCP stdio server
│       └── src/
│           └── commands/           ← plugin, device, settings subcommands
├── packages/                       ← shared libraries (consumed by apps)
│   ├── sdk/                        ← @nodalcore/sdk (published for plugin devs)
│   │   └── src/
│   │       ├── types/              ← PluginManifest, DevicePlugin, StandaloneTool, ConnectionOptions
│   │       └── proto/              ← nodal_core.proto (NodalSettings + NodalEvents services)
│   ├── plugin-host/                ← installer, in-process loader, out-of-process spawner
│   ├── registry-client/            ← fetches + parses the central registry JSON index
│   └── renderer/                   ← React component library (shared by desktop + web)
│       └── src/
│           ├── components/         ← PluginCard, SettingsPanel, widgets/
│           ├── pages/              ← StorePage, InstalledPage
│           └── hooks/
├── examples/
│   ├── plugin-device-bridge/       ← nodal.json + src/index.ts
│   └── plugin-standalone-tool/     ← nodal.json + src/index.ts + bin/tool
├── pnpm-workspace.yaml
├── tsconfig.json                   ← root with project references
└── package.json

~/.nodalcore/                       ← runtime data (NOT in repo)
└── plugins/{plugin-id}/            ← installed plugin dirs (nodal.json + source/binary)
```

---

## Phase 1 — Monorepo Foundation *(blocking for all phases)*

1. Init pnpm workspace — `apps/` (desktop, web, cli) and `packages/` (sdk, plugin-host, registry-client, renderer); configure `pnpm-workspace.yaml` to include both roots
2. Configure `electron-vite` in `apps/desktop` (main + preload + renderer target)
3. Configure Vite in `apps/web` with `VITE_PLATFORM=web` feature flag
4. Shared ESLint + Prettier config at root; root `tsconfig.json` with project references & path aliases (`@sdk/*`, `@renderer/*`, etc.)

---

## Phase 2 — Plugin SDK (`packages/sdk`) *(parallel with Phase 1)*

5. `PluginManifest` type — defines all fields: `id`, `name`, `version`, `icon`, `type` (`"device-bridge"` | `"standalone-tool"`), `sdkVersion`, `entry`/`executable`, `settingsSchema` (JSON Schema 7), `protoFile`, `connectionType` (see step 6), `permissions`
6. `DevicePlugin` abstract interface: `connect(options: ConnectionOptions)`, `disconnect()`, `getSettingsSchema()`, `readSettings()`, `writeSettings(settings)` — with a `connectionType` discriminated union that drives connection-specific options:
   - `"serial"` → `{ port: string, baudRate: number, dataBits?, stopBits?, parity? }`
   - `"usb"` → `{ vendorId: number, productId: number }`
   - `"bluetooth"` → `{ serviceUUID: string, characteristicUUID?: string }`
   - `"tcp"` → `{ host: string, port: number }` (Modbus TCP, custom protocol)
   - `"mqtt"` → `{ brokerUrl: string, topic: string }`
   - The `connectionType` value in the manifest also determines which entry is added to `permissions` automatically — no manual mapping needed
7. `StandaloneTool` interface: `launch()`, `shutdown()`, `getProtoDefinition()`
8. Core `.proto` file: `NodalSettings` service + `NodalEvents` service (bidirectional streaming for real-time readbacks)
9. SDK is an npm package (`workspace:*` internally), so external plugin devs can `npm install @nodalcore/sdk`

> **Suggestion**: Add a `permissions` field (e.g., `["serial", "usb", "network"]`) in the manifest so users see what hardware a plugin requests, like mobile app permissions. This is important for security.

---

## Phase 3 — Plugin Host (`packages/plugin-host`) *(depends on Phase 2)*

10. **Installer**: `git clone` or download a release zip to `~/.nodalcore/plugins/{plugin-id}/`, then validate `nodal.json` against schema
11. **In-process loader**: `dynamic import()` of JS/TS device-bridge plugins run in a sandboxed Node.js child process (VS Code extension-host model — crash isolation)
12. **Out-of-process spawner**: `child_process.spawn` the plugin executable, then connect as a gRPC client

---

## Phase 4 — Adaptive Settings UI (`packages/renderer`) *(depends on Phase 2)*

13. Integrate `@rjsf/core` v6 + `@rjsf/validator-ajv8` — JSON Schema → rendered form with no manual mapping
14. `SettingsPanel` component: receives schema from a loaded plugin → renders all fields automatically
15. Custom RJSF widgets for device-specific controls: `LiveReadback` (polling), `RangeSlider`, `EnumSelect`
16. Settings cycle: load plugin → read current device values → pre-fill form → user edits → write back

> **Suggestion**: Support `"ui:hints"` in the schema (e.g., `"ui:widget": "slider"`, `"ui:min"`, `"ui:max"`, `"ui:unit": "°C"`) so developers can control how each setting is displayed without writing any UI code.

---

## Phase 5 — Plugin Store / Catalog UI *(depends on Phases 1, 2)*

17. `packages/registry-client`: fetch a central JSON index from GitHub (similar to VS Code marketplace) → typed list of `PluginEntry` objects
18. `PluginCard` component: icon, name, description, type badge, `+` install button (morphs to checkmark when installed)
19. Store page: responsive card grid (Chrome Web Store feel)
20. Installed plugins page: list with live status indicators (connected / idle / error)
21. Install flow UI: progress bar → manifest validation → success/error toast

---

## Phase 6 — IPC: Connect Protocol (`apps/desktop`) *(depends on Phases 2, 3)*

22. `.proto` definitions in `packages/sdk` — NodalCore acts as the **gRPC server**; standalone tools connect as clients (easier service discovery)
23. `@connectrpc/connect-node` server running in `apps/desktop` main process
24. Preload bridge: expose a safe `contextBridge` API so the renderer can invoke device calls without direct Node.js access
25. `@connectrpc/connect-web` for `apps/web` — same code, native browser-compatible fetch transport

> **Suggestion**: Use the Connect protocol (not raw gRPC) because it works over plain HTTP/2 and HTTP/1.1 fetch — meaning your web version gets gRPC-like ergonomics with zero proxy setup, and Electron gets the same client code.

---

## Phase 7 — Web Build (`apps/web`) *(parallel with Phase 6)*

26. `apps/web` is a thin Vite shell that imports `packages/renderer` with `VITE_PLATFORM=web` to gate device/install features
27. Web is catalog-browse only: search plugins, read docs, but no local install

---

## Phase 8 — CLI / REPL / MCP Server (`apps/cli`) *(depends on Phases 2, 3)*

28. **Headless core**: `apps/cli` depends on `packages/plugin-host` and `packages/registry-client` directly — no Electron, no GUI, runs as a plain Node.js process.
29. **CLI binary** (`nodalcore` command, via `bin` in `package.json`, built with `tsup`): implement with `commander.js`:
    - `nodalcore plugin list` — list installed plugins
    - `nodalcore plugin search <query>` — search the registry index
    - `nodalcore plugin install <id-or-git-url>` — install a plugin
    - `nodalcore plugin uninstall <id>` — remove a plugin
    - `nodalcore device connect <plugin-id> [connection flags]` — connect to a device
    - `nodalcore device disconnect <plugin-id>`
    - `nodalcore settings get <plugin-id> [key]` — read current device settings (all or one key)
    - `nodalcore settings set <plugin-id> <key> <value>` — write a single setting
    - `nodalcore repl` — start interactive REPL
    - `nodalcore mcp` — start MCP stdio server
30. **Output format**: JSONL by default for all non-TTY output — `{"type":"result","data":{...}}`, `{"type":"error","code":"...","message":"..."}`, `{"type":"progress","step":"...","pct":50}`. Auto-switches to a human-readable table when stdout is a TTY.
31. **REPL**: `readline`-based interactive loop — same commands without the `nodalcore` prefix. Session object keeps device connections alive between commands so an AI agent can connect once and read/write settings across multiple turns.
32. **MCP Server** (`nodalcore mcp`): JSON-RPC 2.0 over stdio using `@modelcontextprotocol/sdk`. Exposes the following MCP tools to AI assistants (Claude Desktop, Cursor, VS Code Copilot, etc.):
    - `list_plugins` — returns installed plugins with type and status
    - `search_plugins` — queries the registry index
    - `install_plugin` — installs by id or Git URL, streams progress notifications
    - `connect_device` — connects a device-bridge plugin with connection options
    - `read_settings` — returns current device settings as a JSON object
    - `write_settings` — accepts a partial settings object, validates against schema, writes to device
    - `subscribe_events` — streams `NodalEvents` from a device as MCP progress notifications
33. MCP server registers a `resources` endpoint that exposes each plugin's `settingsSchema` (JSON Schema) so AI agents can introspect available settings and valid value ranges before calling `write_settings` — preventing hallucinated setting names or out-of-range values.

---

## Relevant Files

All to be created:

- `packages/sdk/src/types/manifest.ts` — `PluginManifest`
- `packages/sdk/src/types/device-plugin.ts` — `DevicePlugin` interface + `ConnectionOptions` discriminated union + `ConnectionType` enum
- `packages/sdk/src/proto/nodal_core.proto` — gRPC service definitions
- `packages/plugin-host/src/installer.ts` — git clone + manifest validation
- `packages/plugin-host/src/loader.ts` — in-process plugin loader
- `packages/plugin-host/src/spawner.ts` — out-of-process tool launcher
- `packages/renderer/src/components/PluginCard.tsx` — store card
- `packages/renderer/src/components/SettingsPanel.tsx` — adaptive RJSF form
- `packages/registry-client/src/index.ts` — fetch + parse registry index
- `apps/desktop/src/main/index.ts` — Electron main + Connect server
- `apps/desktop/src/preload/index.ts` — contextBridge API
- `apps/web/src/main.tsx` — web app entry point
- `apps/cli/src/index.ts` — `commander.js` CLI entry point + command definitions
- `apps/cli/src/repl.ts` — `readline`-based REPL session manager
- `apps/cli/src/mcp-server.ts` — MCP stdio server, tool + resource registrations
- `apps/cli/src/output.ts` — JSONL / TTY-table output formatter

---

## Verification

1. `pnpm install && pnpm -r build` passes with no errors
2. Electron launches; renderer hot-reloads during development
3. A mock `nodal.json` with `settingsSchema` causes `SettingsPanel` to render the correct fields automatically
4. Install flow: provide a GitHub repo URL → plugin appears in installed list
5. Standalone tool example: spawn process → Connect handshake → tool shows as connected
6. Registry client: fetches mock index → plugin cards populate the store grid
7. `pnpm --filter @nodalcore/web build` produces a static site with the catalog view
8. `nodalcore plugin list` returns valid JSONL with no running Electron instance
9. `nodalcore settings get <mock-plugin-id>` returns the mock device's current settings as JSONL
10. `nodalcore mcp` starts the MCP server; the MCP Inspector (`npx @modelcontextprotocol/inspector`) successfully lists tools and calls `read_settings`

---

## Further Considerations

1. **Registry backend**: The simplest approach is a static JSON file hosted on GitHub Pages (no server needed, curated via PRs). More ambitious: a lightweight REST API with search/ratings. Recommend starting with static JSON.

2. **Plugin signing & trust**: Should installed plugins be verified (e.g., SHA-256 checksum against manifest, optional GPG signing)? This prevents man-in-the-middle attacks during installs. Recommend treating it as a Phase 2 concern but designing the manifest to include an optional `integrity` field now.

3. ~~**Device connection interface**~~ ✅ *Resolved* — `connectionType` discriminated union added to `DevicePlugin` (step 6) covering `serial`, `usb`, `bluetooth`, `tcp`, and `mqtt`. The manifest `connectionType` field drives `permissions` automatically.
