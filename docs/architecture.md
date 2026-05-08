# Architecture

NodalCore is a pnpm monorepo that ships a desktop hub for in-house hardware
plugins. Its design is borrowed wholesale from VSCode's extension model and
adapted to two plugin shapes: **device-bridge** plugins wrap a physical
device, and **standalone-tool** plugins ship an independent process. Both
shapes consume the same uniform **host API** through a `ctx` object handed
to their `activate` function.

This document is the system map. It does not duplicate the per-field
references in [`plugin-spec.md`](./plugin-spec.md), [`host-api.md`](./host-api.md),
or [`webviews.md`](./webviews.md) — start here, drill down there.

## Three pillars

```
                ┌─────────────────────────────────────────────┐
                │                Manifest                     │
                │           (nodal.json, top-level)           │
                │   id · version · type · main / executable   │
                └────────────────────┬────────────────────────┘
                                     │
                ┌────────────────────▼────────────────────────┐
                │              Contributes                    │
                │     (declarative — read by the host)        │
                │  themes · configuration · sidebar / statusBar
                │           / panel webviews                  │
                └────────────────────┬────────────────────────┘
                                     │
                ┌────────────────────▼────────────────────────┐
                │              Host API                       │
                │   (imperative — called by the plugin)       │
                │     ctx.window · ctx.workspace · ctx.views  │
                └─────────────────────────────────────────────┘
```

Manifest answers "what is this plugin?". Contributes answers "what does it
add to the UI?". Host API answers "what can it do at runtime?". The split
mirrors VSCode and keeps each surface independently versionable.

## System topology

```
┌────────────────────────────────────────────────────────────────────────┐
│                           User interfaces                              │
│                                                                        │
│  ┌────────────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ Desktop (Electron) │  │ Web (Vite)   │  │ CLI · REPL · MCP server│  │
│  │   apps/desktop/    │  │  apps/web/   │  │      apps/cli/         │  │
│  └─────────┬──────────┘  └──────┬───────┘  └───────────┬────────────┘  │
│            │ contextBridge IPC   │ fetch (read-only)    │ Node          │
└────────────┼─────────────────────┼──────────────────────┼───────────────┘
             │                     │                      │
┌────────────▼─────────────────────▼──────────────────────▼───────────────┐
│                          Workspace packages                             │
│                                                                         │
│  @nodalcore/sdk           Types · Transport · ExtensionContext          │
│                           createIpcTransport · createGrpcTransport      │
│  @nodalcore/plugin-host   installer · loader · spawner · broker         │
│                           contributions · host-api server · gRPC server │
│  @nodalcore/registry-client  fetchIndex · searchPlugins · getPlugin     │
│  @nodalcore/renderer      React shell + Store/Installed/Workspace pages │
└────────────────────────────────────────────────────────┬────────────────┘
                                                         │
                          ┌──────────────────────────────▼───────────────┐
                          │              Plugin processes                │
                          │                                              │
                          │  ┌──────────────────┐ ┌────────────────────┐ │
                          │  │  device-bridge   │ │  standalone-tool   │ │
                          │  │  fork() worker   │ │  spawn() child     │ │
                          │  │  Node IPC        │ │  gRPC HostAPI      │ │
                          │  │                  │ │   + tool's own gRPC│ │
                          │  └──────────────────┘ └────────────────────┘ │
                          └──────────────────────────────────────────────┘

                          ┌──────────────────────────────────────────────┐
                          │            Panel webviews                    │
                          │                                              │
                          │  WebContentsView per (pluginId, slotId)      │
                          │  HTML served via nodal-plugin://<id>/<path>  │
                          │  preload exposes window.nodalcore.*          │
                          └──────────────────────────────────────────────┘
```

The desktop dev server (`pnpm dev` → `electron-vite dev`) aliases every
`@nodalcore/*` import to its TypeScript source, so workspace packages don't
need to be rebuilt for renderer / main changes during development.

## Plugin lifecycle

```
┌─ Install ────────────────────────────────────────────────────────────┐
│ User: nodalcore plugin install <git-url | local-path | registry-id>  │
│   → installer.ts: clone OR copy OR download+verify+unpack            │
│   → AJV validate nodal.json (type, main/executable, sdkVersion …)    │
│   → atomicReplaceDir into ~/.nodalcore/plugins/<id>/                 │
│   → write ~/.nodalcore/registry.json                                 │
└──────────────────────────────────────────────────────────────────────┘
                                 │
┌─ Load (device-bridge) ──────────┼────────────────────────────────────┐
│ User clicks Connect             ▼                                    │
│   → IPC device:connect          → main.loadDevicePlugin(id)          │
│   → fork(plugin-host worker.js, [pluginPath, id])                    │
│   → Worker dynamic-imports plugin's `main` module                    │
│   → Worker calls plugin.activate(ctx) if exported                    │
│     ─ ctx is built by createExtensionContext(transport, id)          │
│     ─ transport = createIpcTransport() over the fork's Node IPC      │
└──────────────────────────────────────────────────────────────────────┘

┌─ Spawn (standalone-tool) ───────────────────────────────────────────┐
│ User clicks Start                                                   │
│   → IPC tool:start              → main.spawnTool(id)                │
│   → spawner.ts:                                                     │
│       1. start host-side gRPC HostAPI on a random localhost port    │
│       2. spawn(executable, env: { NODALCORE_HOST_PORT, … })         │
│       3. wait for "NODALCORE_READY <port>\n" on stdout (10s)        │
│   → Tool dials the host's gRPC server BEFORE printing READY,        │
│     calls host.window.showMessage / etc. as part of activation.     │
└─────────────────────────────────────────────────────────────────────┘

┌─ Use (host calls) ──────────────────────────────────────────────────┐
│ Plugin invokes ctx.window.showMessage('…')                          │
│   → transport.request('window.showMessage', { message, level })     │
│   → device-bridge: serialised over Node IPC envelope                │
│     standalone-tool: HostAPI.Request(method, args_json) gRPC call   │
│   → broker.dispatchHostRequest(pluginId, method, args)              │
│   → host-api/server.ts handler runs                                 │
│     ─ window.showMessage forwards to setWindowMessageEmitter        │
│       which the desktop main wired to the BrowserWindow's renderer  │
│     ─ workspace.{get,set}Configuration hits configuration.ts        │
└─────────────────────────────────────────────────────────────────────┘

┌─ Use (panel webviews) ──────────────────────────────────────────────┐
│ User opens Workspace tab → clicks a panel                           │
│   → preload.showPanel(pluginId, slotId, htmlPath)                   │
│   → main.webviews.manager creates a WebContentsView                 │
│   → loadURL("nodal-plugin://<id>/<htmlPath>")                       │
│   → renderer ResizeObserver reports area bounds → setBounds(...)    │
│                                                                     │
│ Webview JS calls window.nodalcore.postMessage({...})                │
│   → ipcRenderer.invoke('webview:msg-to-plugin', data)               │
│   → main.webviews.routing finds (pluginId, slotId) by sender        │
│   → sendToPlugin(id, 'views.message', { slotId, data })             │
│   → plugin's ctx.views.onMessage(slotId) handler runs               │
│   ← response propagates back through the same path                  │
│                                                                     │
│ Plugin calls ctx.views.postMessage(slotId, data)                    │
│   → transport.request('views.postMessage', { slotId, data })        │
│   → broker handler → manager.sendToPanel                            │
│   → WebContents.send('webview:msg-from-plugin', data)               │
│   → preload onMessage subscribers receive it                        │
└─────────────────────────────────────────────────────────────────────┘
```

## Host API: one surface, two transports

`@nodalcore/sdk` defines a single `Transport` interface with a `request()`
method (outbound) and an `onRequest()` registrar (inbound). Two adapters
implement it.

| Plugin type | Adapter | Wire format |
|---|---|---|
| device-bridge | `createIpcTransport()` | Node IPC envelope `{ kind, seq, method?, args?, result?, error? }` over `process.send/on` inside the fork |
| standalone-tool | `createGrpcTransport({ hostPort, pluginId })` | `HostAPI.Request(plugin_id, method, args_json)` — proto definition embedded in the SDK as a string and materialized to a temp file once per process |

Both adapters route inbound requests into per-method handlers the plugin
registers via `transport.onRequest`. The SDK's `createExtensionContext`
uses that to back the inbound side of `ctx.views.onMessage` (panel →
plugin), while it issues outbound requests for everything plugins call
themselves (`ctx.window.showMessage`, `ctx.workspace.getConfiguration`,
`ctx.views.postMessage`).

On the host side every inbound call lands in `broker.dispatchHostRequest`,
regardless of which transport delivered it. This is the single
source-of-truth router: `host-api/server.ts` registers
`window.showMessage` / `window.showWarning` / `window.showModal` and
`workspace.{get,set}Configuration`; the webview routing module registers
`views.postMessage`. Each handler is plugin-id-scoped — the broker never
assumes one global state.

```
                 ┌──────────────────────────────┐
                 │  broker.dispatchHostRequest  │
                 │   (pluginId, method, args)   │
                 └──────────┬──────────┬────────┘
                            │          │
   IPC envelope inbound ────┘          └──── HostAPI.Request gRPC inbound
   from a fork worker                       from a standalone tool
                            ▲ ▲
            registerHostHandler('window.showMessage', …)
            registerHostHandler('window.showWarning', …)
            registerHostHandler('window.showModal',   …)
            registerHostHandler('workspace.getConfiguration', …)
            registerHostHandler('workspace.setConfiguration', …)
            registerHostHandler('views.postMessage', …)
```

`host → tool` callbacks are **not** routed through the gRPC HostAPI today
(it's tool → host only). That means a panel webview attached to a
standalone-tool plugin can receive plugin → webview pushes (via the broker
finding the open `WebContentsView`), but webview → tool messages return
`null`. Device-bridge plugins have full bidirectionality through the IPC
envelope.

## Settings — host-side, schema-driven

Settings are not plugin-resident. The manifest's
`contributes.configuration.properties` is a JSON Schema 7 property map; the
host stores values at `~/.nodalcore/configurations.json`, keyed by plugin
id. Plugins read via `ctx.workspace.getConfiguration()`.

```
nodal.json contributes.configuration.properties
   │ JSON Schema 7 property map (no top-level wrapper — host wraps it)
   ▼
InstalledPage wraps into JSONSchema7 object
   │ pre-fills RJSF using "default" on each property
   ▼
User edits → Apply
   │ IPC settings:write
   ▼
configuration.ts.setConfiguration(pluginId, values)
   │ writes ~/.nodalcore/configurations.json
   ▼
Plugin: ctx.workspace.getConfiguration() → Record<string, unknown>
```

This is a hard cutover from the original model (where settings traveled
through the plugin proxy via `readSettings`/`writeSettings`). The host now
owns config; the plugin observes.

## Contributions registry

`plugin-host/src/contributions.ts` walks the local `~/.nodalcore/registry.json`
on demand and emits a flat `AggregatedContributions`:

```ts
{
  themes:    [{ pluginId, themeId, label, type, vars: Record<string,string> }],
  sidebar:   [{ pluginId, slotId, name, type }],
  statusBar: [{ pluginId, slotId, alignment, priority }],
  panels:    [{ pluginId, slotId, name, htmlPath, csp? }],
}
```

Theme JSON files are loaded from disk during aggregation; everything else
is metadata. The renderer fetches this once at startup and re-fetches on
install/uninstall. Themes apply via CSS custom-property overrides on
`document.documentElement`; revert just deletes the keys we own. The
status-bar / sidebar / workspace surfaces use it to decide what chrome to
render.

## Webview pipeline

Panel HTML loads in a native `WebContentsView` (not an iframe). The
renderer cannot lay out where a webview lives — `WebContentsView` is a
native compositor layer above the renderer, and CSS z-index can't cover
it. Instead:

1. The Workspace page mounts a sized `<div>` and reports its
   bounding-rect via `workspace:set-bounds` IPC.
2. Main's `webviews/manager.ts` is the single owner of the view's bounds
   and visibility — one panel visible at a time, hidden views detached
   from the tree on tab switch.
3. `nodal-plugin://<pluginId>/<path>` is registered as a privileged
   scheme **before `app.whenReady()`**. The handler resolves under
   `~/.nodalcore/plugins/<id>/` with `..`/symlink defenses and applies a
   per-plugin-origin CSP to HTML responses.
4. A second preload bundle (`out/preload/webview.js`) exposes
   `window.nodalcore.{postMessage, onMessage}` to the webview JS — no
   Node, no `require`, no direct IPC.

See [`webviews.md`](./webviews.md) for the message-routing protocol and
the bundling caveats for plugin authors.

## Plugins ship as bundles

The installer is intentionally minimal: clone / copy / download + verify
+ unpack. It does **not** run `npm install` or hoist `node_modules`. A
plugin installed at `~/.nodalcore/plugins/<id>/` runs against an empty
node_modules, so the entry must be self-contained.

Both reference plugins use tsup with `noExternal: [/.*/]` and a
`createRequire` banner so any transitive CJS deps (notably
`@grpc/grpc-js`) resolve inside the ESM bundle. Real plugins are expected
to do the same — see [`plugin-packaging.md`](./plugin-packaging.md) for
the artifact-shape rules.

## Layout — what lives where

```
apps/
  desktop/   Electron 34 shell — main · preload · renderer (Vite)
             src/main/webviews/ ← protocol · manager · routing
             src/preload/{index,webview}.ts ← two preload entries
  web/       Read-only Vite catalog browser (no device access)
  cli/       Commander-based CLI; REPL; MCP stdio server

packages/
  sdk/             @nodalcore/sdk — manifest types, Contributes types,
                   ExtensionContext, Transport interface, IPC + gRPC
                   adapters, embedded `host_api.proto`, SDK_VERSION
  plugin-host/     @nodalcore/plugin-host — installer, fork-worker
                   loader (with a separate `worker.js` tsup entry),
                   gRPC HostAPI server, broker, contributions
                   aggregator, host-side configuration store
  registry-client/ @nodalcore/registry-client — fetchIndex / search / get
  renderer/        @nodalcore/renderer — React shell, contributions
                   provider, theme provider, three pages, host-message
                   toast

examples/
  plugin-device-bridge/    Multimeter — exercises both directions of
                           views.{post,on}Message and host.window
  plugin-standalone-tool/  Image processor — gRPC HostAPI smoke + a
                           receive-only panel webview
```

## Where to read next

- [`plugin-spec.md`](./plugin-spec.md) — the `nodal.json` reference.
- [`host-api.md`](./host-api.md) — what `ctx.window` / `ctx.workspace` /
  `ctx.views` actually do.
- [`webviews.md`](./webviews.md) — the panel pipeline in detail.
- [`examples.md`](./examples.md) — a code-walkthrough of the two
  reference plugins.
- [`plugin-packaging.md`](./plugin-packaging.md) — artifact format,
  registry metadata, integrity verification.
- [`contributing.md`](./contributing.md) — workflow for hacking on
  NodalCore itself.
