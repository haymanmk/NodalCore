# Plan: NodalCore — Plugin Hub for Device & Tool Integration

**TL;DR**: A pnpm monorepo containing an Electron + React desktop app (with an optional web build) that acts as a plugin hub. Two plugin types exist: *device bridges* (connect to hardware, expose a settings schema rendered as adaptive UI) and *standalone tools* (independent processes communicating with the app over the Connect/gRPC protocol). Plugins are Git-repo-based, distributed via a central JSON registry index.

---

## Phase 1 — Monorepo Foundation *(blocking for all phases)*

1. Init pnpm workspace with packages: `app`, `renderer`, `sdk`, `plugin-host`, `registry-client`
2. Configure `electron-vite` in `packages/app` (main + preload + renderer target)
3. Root `tsconfig.json` with project references & path aliases (`@sdk/*`, `@renderer/*`, etc.)
4. Shared ESLint + Prettier config at root

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

## Phase 6 — IPC: Connect Protocol *(depends on Phases 2, 3)*

22. `.proto` definitions in `packages/sdk` — NodalCore acts as the **gRPC server**; standalone tools connect as clients (easier service discovery)
23. `@connectrpc/connect-node` server running in Electron main process
24. Preload bridge: expose a safe `contextBridge` API so the renderer can invoke device calls without direct Node.js access
25. `@connectrpc/connect-web` for the web build — same code, native browser-compatible fetch transport

> **Suggestion**: Use the Connect protocol (not raw gRPC) because it works over plain HTTP/2 and HTTP/1.1 fetch — meaning your web version gets gRPC-like ergonomics with zero proxy setup, and Electron gets the same client code.

---

## Phase 7 — Web Build *(parallel with Phase 6)*

26. Vite web build target of `packages/renderer` with a feature flag (`VITE_PLATFORM=web`) to gate device/install features
27. Web is catalog-browse only: search plugins, read docs, but no local install

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
- `packages/app/src/main/index.ts` — Electron main + Connect server
- `packages/app/src/preload/index.ts` — contextBridge API

---

## Verification

1. `pnpm install && pnpm -r build` passes with no errors
2. Electron launches; renderer hot-reloads during development
3. A mock `nodal.json` with `settingsSchema` causes `SettingsPanel` to render the correct fields automatically
4. Install flow: provide a GitHub repo URL → plugin appears in installed list
5. Standalone tool example: spawn process → Connect handshake → tool shows as connected
6. Registry client: fetches mock index → plugin cards populate the store grid
7. `pnpm --filter renderer build:web` produces a static site with the catalog view

---

## Further Considerations

1. **Registry backend**: The simplest approach is a static JSON file hosted on GitHub Pages (no server needed, curated via PRs). More ambitious: a lightweight REST API with search/ratings. Recommend starting with static JSON.

2. **Plugin signing & trust**: Should installed plugins be verified (e.g., SHA-256 checksum against manifest, optional GPG signing)? This prevents man-in-the-middle attacks during installs. Recommend treating it as a Phase 2 concern but designing the manifest to include an optional `integrity` field now.

3. ~~**Device connection interface**~~ ✅ *Resolved* — `connectionType` discriminated union added to `DevicePlugin` (step 6) covering `serial`, `usb`, `bluetooth`, `tcp`, and `mqtt`. The manifest `connectionType` field drives `permissions` automatically.
