# Example: standalone-tool plugin

A reference implementation of a **standalone-tool** plugin for NodalCore.
Simulates an out-of-process image-processing service so you can exercise
the spawn + gRPC HostAPI pipeline.

## What it demonstrates

- Correct `nodal.json` structure for a standalone tool (`type:
  "standalone-tool"`, `executable`, no `connectionType`)
- The spawn handshake: dial the host's gRPC `HostAPI` (via the env var
  `NODALCORE_HOST_PORT`) before printing `NODALCORE_READY <port>` on
  stdout
- Building `ctx` from `createGrpcTransport` + `createExtensionContext`
  in `@nodalcore/sdk` — same `ctx.window` / `ctx.workspace` / `ctx.views`
  surface as a device-bridge plugin
- Reading settings via `ctx.workspace.getConfiguration()` (host store)
  and surfacing a toast via `ctx.window.showMessage`
- `contributes.configuration` — schema-driven settings form
- `contributes.views.panel` — a receive-only panel webview (the gRPC
  HostAPI is tool→host only today; webview → tool messages would need a
  reverse channel)

## Files

```
nodal.json         Plugin manifest — id, sdkVersion, contributes
src/tool.js        Node ESM entry — builds ctx, runs activate, prints READY
panel/index.html   Static panel webview
tsup.config.ts     Self-contained bundle config (output: bin/tool.js)
```

## Env vars passed by the host

| Variable | Purpose |
|---|---|
| `NODALCORE_PLUGIN_ID` | This plugin's `id` |
| `NODALCORE_PLUGIN_DIR` | Absolute path to `~/.nodalcore/plugins/<id>/` |
| `NODALCORE_HOST_PORT` | TCP port of the host's gRPC HostAPI server |

## Configuration schema (`contributes.configuration`)

| Field | Type | Default |
|---|---|---|
| `outputFormat` | enum (png / jpeg / webp) | `"png"` |
| `quality` | integer (1–100) | `85` |
| `maxWidth` | integer (≥1) | `1920` |

Values live in the host configuration store at
`~/.nodalcore/configurations.json`.

## Installing locally for testing

```bash
# From the repo root
pnpm --filter @nodalcore/sdk build
pnpm --filter example-image-processor build
node apps/cli/dist/index.js plugin install ./examples/plugin-standalone-tool
```

Then start the desktop app (`pnpm dev`) and use the Start button on the
**Installed** tab. The "Image Processor Info" panel shows up on the
**Workspace** tab. Full walkthrough in
[`docs/examples.md`](../../docs/examples.md).
