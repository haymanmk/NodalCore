# Plugin specification

A NodalCore plugin is a directory with three things at its root:

1. `nodal.json` — the manifest (this document).
2. An entry artifact pointed at by `main` (device-bridge) or `executable`
   (standalone-tool).
3. Any assets the manifest's `contributes` block references — theme JSON,
   panel HTML, etc.

The manifest is validated by `@nodalcore/plugin-host` at install time using
AJV. Mismatched fields are rejected with explicit errors that point at the
new field name when applicable.

## Top-level shape

```jsonc
{
  // Required
  "id":          "com.example.my-sensor",   // reverse-domain, globally unique
  "name":        "My Sensor",
  "version":     "1.0.0",                   // semver
  "sdkVersion":  ">=0.2.0",                 // semver range of @nodalcore/sdk (see "SDK version compatibility")
  "type":        "device-bridge",           // or "standalone-tool"
  "permissions": ["serial"],                // see Permissions below

  // Required for device-bridge
  "main": "dist/index.js",                  // ESM module that exports activate(ctx)

  // Required for standalone-tool
  "executable": "./bin/tool.js",            // path to the spawned binary
  "protoFile":  "proto/tool.proto",         // optional — the tool's own service

  // Type-specific (device-bridge only)
  "connectionType": "serial",               // serial | usb | bluetooth | tcp | mqtt

  // Declarative contributions consumed by the host
  "contributes": { /* see "Contributes block" below */ },

  // Optional metadata
  "icon":        "icon.png",
  "description": "…",
  "author":      { "name": "…", "email": "…", "url": "…" },
  "repository":  "https://github.com/…",
  "homepage":    "https://…",
  "tags":        ["serial", "sensor"],
  "integrity":   "sha256:<hex>"             // checksum of the plugin archive
}
```

### Field rules

| Field | Rule |
|---|---|
| `id` | Lowercase, reverse-domain. Unique within the registry. Must match `^[a-zA-Z0-9._-]+$` (also enforced by the `nodal-plugin://` handler). |
| `version` | Semver. |
| `sdkVersion` | **Semver range.** The installer checks `semver.satisfies(SDK_VERSION, manifest.sdkVersion, { includePrerelease: true })` and rejects mismatches. |
| `type` | Exactly `"device-bridge"` or `"standalone-tool"`. |
| `main` | Required if `type === "device-bridge"`. Resolved relative to the plugin root. The module must export an `activate(ctx)` function (and optionally `deactivate()`). |
| `executable` | Required if `type === "standalone-tool"`. Must print `NODALCORE_READY <port>` to stdout within 10 s of spawn. |
| `permissions` | Must cover the `connectionType` (see below). Extra permissions are allowed. |
| `connectionType` | Required for device-bridge. Drives the auto-granted permission. |

### Removed / rejected fields

These were valid in pre-0.2.0 manifests. The installer now rejects them with
an error that points at the new field name:

| Old field | Now |
|---|---|
| `entry` | rename to `main` |
| `settingsSchema` | move to `contributes.configuration.properties` |

## Permissions

| `connectionType` | Auto-granted permission |
|---|---|
| `serial` | `serial` |
| `usb` | `usb` |
| `bluetooth` | `bluetooth` |
| `tcp` | `network` |
| `mqtt` | `network` |

Permissions are surface for a future install-time consent dialog (mobile-app
style); they are NOT enforced at runtime today. Extra permissions like
`filesystem` or `network` can be declared on top of the auto-granted set.

## Plugin types

### device-bridge

Runs in a forked Node child process managed by the plugin host. The entry
module is dynamically imported by a worker that owns the IPC envelope.

```ts
// src/index.ts
import type { ConnectionOptions, ExtensionContext } from '@nodalcore/sdk'
import { DevicePlugin } from '@nodalcore/sdk'

export default class MySensor extends DevicePlugin {
  readonly connectionType = 'serial' as const

  async connect(options: ConnectionOptions): Promise<void> { /* … */ }
  async disconnect(): Promise<void> { /* … */ }
}

export async function activate(ctx: ExtensionContext): Promise<void> {
  const cfg = await ctx.workspace.getConfiguration()
  await ctx.window.showMessage(`MySensor activated (mode: ${cfg.mode})`)
  ctx.views.onMessage('readout', async (data) => {
    // panel asks for a reading; return one
    return { value: 42, unit: 'V', timestamp: Date.now() }
  })
}

export async function deactivate(): Promise<void> { /* clean up */ }
```

`DevicePlugin` is now a thin abstract class with just `connectionType`,
`connect`, and `disconnect`. Settings, host calls, and webview routing all
flow through `ctx` — the plugin proxy is no longer the surface.

### standalone-tool

An independent process (any language). The host spawns it with these env
vars:

| Variable | Purpose |
|---|---|
| `NODALCORE_PLUGIN_ID` | The plugin's `id`. |
| `NODALCORE_PLUGIN_DIR` | Absolute path to `~/.nodalcore/plugins/<id>/`. |
| `NODALCORE_HOST_PORT` | TCP port of the host's gRPC HostAPI service (random localhost port). |

Activation sequence the tool must follow:

1. Dial `localhost:NODALCORE_HOST_PORT` and build a gRPC HostAPI client.
2. (Optional) call `host.window.showMessage` / `host.workspace.getConfiguration`
   etc. as part of activation.
3. Start the tool's own service.
4. Print **exactly** `NODALCORE_READY <port>\n` on stdout — `<port>` is the
   port the tool's service listens on.

Within 10 seconds. If the line doesn't appear or the child exits early, the
spawner throws.

For TypeScript / JS standalone tools the SDK provides
`createGrpcTransport({ hostPort, pluginId })` to construct a `Transport`,
plus `createExtensionContext(transport, pluginId)` to get a `ctx`. See
[`host-api.md`](./host-api.md).

For tools written in other languages, use `host_api.proto`
(shipped at `packages/sdk/src/proto/host_api.proto`) to generate a HostAPI
client. There's a single `Request(plugin_id, method, args_json)` rpc — every
host call goes through it; method names match the IPC ones.

## Contributes block

Declarative contributions consumed by the host. Every field is optional;
`type`-specific shape is documented inline.

```jsonc
{
  "contributes": {
    "configuration": {
      "title": "Sensor Settings",          // section header in the form
      "properties": {                      // JSON Schema 7 property map
        "mode": {
          "type": "string",
          "title": "Operating mode",
          "enum": ["voltmeter", "ammeter", "ohmmeter"],
          "default": "voltmeter"
        }
      }
    },
    "themes": [
      {
        "id":    "sensor-blue",
        "label": "Sensor — Blue",
        "type":  "dark",                   // "dark" | "light"
        "path":  "themes/sensor-blue.json" // CSS-var override map (relative)
      }
    ],
    "views": {
      "sidebar": [
        // Declarative slot reserved in the sidebar; content rendering is
        // not yet wired (5b lands panels first; sidebar in a future cut).
        { "id": "history", "name": "History", "type": "list" }
      ],
      "statusBar": [
        { "id": "current-reading", "alignment": "right", "priority": 10 }
      ],
      "panel": [
        {
          "id":   "readout",
          "name": "Live Readout",
          "html": "panel/index.html",      // served via nodal-plugin://
          "csp":  {                        // optional CSP additions
            "connect-src": ["https://api.example.com"]
          }
        }
      ]
    }
  }
}
```

### `configuration`

Property map only — the host wraps it into a JSONSchema7 object internally.
Use `"default"` on each property; `InstalledPage` reads them to pre-fill the
form, and the same defaults flow through `ctx.workspace.getConfiguration()`
when no value is stored.

Settings live at `~/.nodalcore/configurations.json`, keyed by plugin id.
Plugins read via `ctx.workspace.getConfiguration()` and write via
`ctx.workspace.setConfiguration()`.

### `themes`

Each theme contribution points at a JSON file containing CSS custom-property
overrides:

```jsonc
// themes/sensor-blue.json
{
  "--bg":             "#0a1626",
  "--surface":        "#102236",
  "--accent":         "#38bdf8",
  "--text-primary":   "#e2f1ff"
  /* … any of the variables in packages/renderer/src/styles/index.css … */
}
```

The contributions aggregator loads the JSON at install/registry-walk time;
the renderer's `ThemeProvider` applies the active theme's vars to
`document.documentElement` and persists the choice in localStorage.

### `views.sidebar`

Declarative slots, no rendering yet. Reserved for a future cut.

### `views.statusBar`

The renderer's status bar shows a row of empty pills labeled
`<pluginId>:<slotId>`. `alignment` (`left` / `right`) and `priority`
(higher first within an alignment) drive ordering. Slot content rendering
is pending future work — the chrome alone is enough to confirm the
contribution surface exists.

### `views.panel`

Plugin-supplied HTML loaded in a native `WebContentsView` inside the
Workspace tab. Each entry needs `id`, `name`, and `html` (path to the HTML
entry, relative to the plugin root). The optional `csp` field merges
additions into the default per-plugin-origin CSP — useful when a panel
needs `connect-src` for a known external API.

See [`webviews.md`](./webviews.md) for the panel runtime and the
`window.nodalcore.{postMessage,onMessage}` surface available to panel JS.

## SDK version compatibility

Every release of `@nodalcore/sdk` ships an `SDK_VERSION` constant
(`packages/sdk/src/version.ts`). The installer rejects manifests whose
declared `sdkVersion` range doesn't satisfy the host's `SDK_VERSION`. Bump
that constant alongside `packages/sdk/package.json` on every SDK release —
forgetting will silently let mismatched plugins install.

### Recommended `sdkVersion` shape: `>=X.Y.Z`, not `^X.Y.Z`

While the SDK is still on a `0.x` line, **prefer open-ended ranges
(`">=0.2.0"`) over caret ranges (`"^0.2.0"`) in your manifest.** npm/semver
treats the caret specially on `0.x` versions: `^0.2.0` expands to
`>=0.2.0 <0.3.0`, so a host with `SDK_VERSION = '0.3.0'` will reject a
plugin pinned to `^0.2.0` even though no breaking change occurred — every
additive minor SDK release would otherwise force every plugin author to
re-cut a manifest. With `>=0.2.0` your plugin rides forward through
additive minors and is only rejected when the host's `SDK_VERSION` is
actually older than what you need.

Pin upward when you start using a feature that landed in a specific
release. For example, a plugin that calls `ctx.window.showModal` (added
in `0.3.0`) should declare `">=0.3.0"`. The reference plugins under
`examples/` only use the `0.2.0` surface and therefore stay at
`">=0.2.0"`.

Once the SDK reaches `1.0.0`, the standard caret semantics become
useful again: at that point `^1.2.0` (i.e. `>=1.2.0 <2.0.0`) is the
right shape — the major axis becomes the only place breaking changes
happen.

## Registry index entry

When a plugin is submitted to the central registry, a `RegistryPluginEntry`
record is added to `index.json`. The shape is:

```jsonc
{
  "id":             "com.example.my-sensor",
  "name":           "My Sensor",
  "version":        "1.0.0",
  "description":    "…",
  "icon":           "https://…/icon.png",
  "type":           "device-bridge",
  "connectionType": "serial",
  "permissions":    ["serial"],
  "tags":           ["serial", "sensor"],
  "author":         { "name": "…", "url": "…" },
  "repository":     "https://github.com/…",
  "manifestUrl":    "https://raw.githubusercontent.com/…/nodal.json",
  "artifacts":      [ /* see plugin-packaging.md */ ],
  "installs":       0,
  "updatedAt":      "2026-01-01T00:00:00.000Z"
}
```

For installation rules (artifact preference, fallback to git clone, integrity
verification), see [`plugin-packaging.md`](./plugin-packaging.md).
