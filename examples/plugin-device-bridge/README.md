# Example: device-bridge plugin

A reference implementation of a **device-bridge** plugin for NodalCore.
Simulates a serial multimeter so you can exercise the full pipeline
without real hardware.

## What it demonstrates

- Correct `nodal.json` structure for a serial device
- Extending `DevicePlugin` from `@nodalcore/sdk` (just `connectionType` /
  `connect` / `disconnect` — settings have moved out of the plugin)
- An `activate(ctx)` entry point that:
  - reads settings via `ctx.workspace.getConfiguration()` (host-side
    store, not in-plugin)
  - emits a toast via `ctx.window.showMessage`
  - registers a panel handler with `ctx.views.onMessage` (webview →
    plugin, with a return value)
  - pushes live readings to the panel via `ctx.views.postMessage`
- `contributes.configuration` — schema-driven settings form
- `contributes.themes` — a teal/cyan CSS-var override
- `contributes.views.statusBar` — a right-aligned slot
- `contributes.views.panel` — a `WebContentsView` panel webview
- Bundling with tsup `noExternal: [/.*/]` + `createRequire` banner so the
  installed copy is self-contained (no `npm install` at install time)

## Files

```
nodal.json            Plugin manifest — id, sdkVersion, contributes
src/index.ts          MultimeterPlugin class + activate(ctx)
panel/index.html      Panel webview (loaded via nodal-plugin://)
panel/panel.js        Panel JS — talks to the plugin via window.nodalcore
themes/multimeter-blue.json   CSS-var override map
tsup.config.ts        Self-contained bundle config
```

## Configuration schema (`contributes.configuration`)

| Field | Type | Default |
|---|---|---|
| `unit` | enum (V / mV / A / mA / Ω / kΩ) | `"V"` |
| `autoRange` | boolean | `true` |
| `sampleRate` | number (1–1000 Hz) | `10` |

Values live in the host configuration store at
`~/.nodalcore/configurations.json`. The plugin reads them via
`ctx.workspace.getConfiguration()`; the renderer's settings form writes
through the same store.

## Installing locally for testing

```bash
# From the repo root
pnpm --filter @nodalcore/sdk build
pnpm --filter example-multimeter build
node apps/cli/dist/index.js plugin install ./examples/plugin-device-bridge
```

Then start the desktop app (`pnpm dev`) and use the Connect button on
the **Installed** tab. The "Live Readout" panel shows up on the
**Workspace** tab — see [`docs/examples.md`](../../docs/examples.md) for
a full walkthrough.
