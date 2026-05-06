# Example plugins

The two reference plugins under `examples/` exist as the canonical
"how to write a NodalCore plugin" answers. This doc walks through what
each one does and which surfaces of the architecture it exercises.

## `examples/plugin-device-bridge` — "Multimeter Bridge"

A device-bridge plugin that pretends to be a serial multimeter. It
exercises:

- `connect` / `disconnect` lifecycle
- `activate(ctx)` running in a forked Node worker
- `host.window.showMessage` (toast)
- `host.workspace.getConfiguration` (read settings)
- `host.views.onMessage` (webview → plugin, with response)
- `host.views.postMessage` (plugin → webview, periodic push)
- `contributes.themes` (a teal/cyan theme override)
- `contributes.views.statusBar` (one right-aligned slot)
- `contributes.views.panel` (live readout HTML)

### Layout

```
examples/plugin-device-bridge/
├── nodal.json                 # manifest
├── package.json               # tsup, build scripts
├── tsup.config.ts             # bundles src/index.ts → dist/index.js (self-contained)
├── src/
│   └── index.ts               # MultimeterPlugin + activate(ctx)
├── panel/
│   └── index.html             # webview shown in the Workspace tab
├── themes/
│   └── multimeter-blue.json   # CSS-var overrides
└── dist/                      # tsup output (gitignored)
```

### Manifest highlights

```jsonc
{
  "id":         "example-multimeter",
  "type":       "device-bridge",
  "main":       "dist/index.js",
  "connectionType": "serial",
  "permissions": ["serial"],
  "contributes": {
    "configuration": {
      "title": "Multimeter",
      "properties": {
        "unit":       { "type": "string", "enum": ["V","mV","A","mA","Ω","kΩ"], "default": "V" },
        "autoRange":  { "type": "boolean", "default": true },
        "sampleRate": { "type": "number", "minimum": 1, "maximum": 1000, "default": 10 }
      }
    },
    "themes": [
      { "id": "multimeter-blue", "label": "Multimeter Blue",
        "type": "dark", "path": "themes/multimeter-blue.json" }
    ],
    "views": {
      "statusBar": [ { "id": "current-reading", "alignment": "right", "priority": 10 } ],
      "panel":     [ { "id": "readout", "name": "Live Readout", "html": "panel/index.html" } ]
    }
  }
}
```

### activate(ctx) — both halves of `views`

```ts
export async function activate(ctx: ExtensionContext): Promise<void> {
  const config = await ctx.workspace.getConfiguration()
  const unit = (config.unit as string | undefined) ?? 'V'
  await ctx.window.showMessage(`Multimeter activated (unit: ${unit})`)

  // Webview → plugin: panel can request a reading on demand.
  ctx.views.onMessage('readout', async (data) => {
    const cfg = await ctx.workspace.getConfiguration()
    const u = (cfg.unit as string | undefined) ?? 'V'
    if ((data as { type?: string } | null)?.type === 'measure') {
      return fakeReading(u)
    }
    return { ok: true }
  })

  // Plugin → webview: emit a fresh reading every second.
  setInterval(() => {
    void ctx.views.postMessage('readout', fakeReading(unit)).catch(() => {})
  }, 1000)
}
```

Three things to note:

1. The plugin re-reads `getConfiguration()` inside the `onMessage`
   handler so a settings change picked up by the form is reflected
   immediately — `activate` runs once, but the handler runs per request.
2. The `setInterval` push tolerates the panel being closed —
   `postMessage` resolves with `false` and we ignore it. The plugin
   keeps producing values; the panel picks up live data when reopened.
3. There is no synthesis between the on-demand "Measure now" path and
   the live-tick path; both produce a reading, the panel renders the
   most recent one.

### Panel HTML

`panel/index.html` is plain HTML that pulls in `panel/panel.js` via a
`<script src="panel.js">` tag — both files are served from the same
`nodal-plugin://example-multimeter/` origin. Inline scripts are
**blocked** by the default CSP (`script-src 'self' nodal-plugin://<pluginId>`),
so plugin authors must always split JS into a separate file.

Highlights from `panel.js`:

```js
const valueEl = document.getElementById('value')
const tsEl    = document.getElementById('ts')

function render(reading) {
  if (!reading || typeof reading !== 'object') return
  valueEl.textContent = String(reading.value)
  tsEl.textContent    = new Date(reading.timestamp).toLocaleTimeString()
}

// Plugin → panel: live ticks pushed every second
window.nodalcore?.onMessage(render)

// Panel → plugin: explicit measurement
document.getElementById('measure').addEventListener('click', async () => {
  const r = await window.nodalcore?.postMessage({ type: 'measure' })
  render(r)
})
```

### Building / installing locally

```bash
# 1. Build the SDK first (the example's tsup pulls SDK source via workspace)
pnpm --filter @nodalcore/sdk build

# 2. Build the example (bundles all deps)
pnpm --filter example-multimeter build

# 3. Install it via the CLI
node apps/cli/dist/index.js plugin install ./examples/plugin-device-bridge
```

After `pnpm dev`:
- Open the **Installed** tab — the multimeter shows up. Click Connect.
- Watch for a toast `Multimeter activated (unit: V)`.
- Switch to the **Workspace** tab — the "Live Readout" panel appears in
  the left rail.
- Click it — the panel renders, ticks update once per second, the
  "Measure now" button returns an explicit reading.
- Top-right **Theme** dropdown — pick "Multimeter Blue" — the entire
  chrome retints.
- Bottom **status bar** — a `example-multimeter:current-reading` pill on
  the right.

## `examples/plugin-standalone-tool` — "Image Processor"

A standalone-tool plugin that fakes an image-processing service. It
exercises:

- Spawn handshake (`NODALCORE_READY <port>`)
- `createGrpcTransport` for the host API
- `host.window.showMessage` from a non-Node-IPC transport
- `contributes.configuration` with several types
- `contributes.views.panel` (receive-only — the gRPC HostAPI is one-way)

### Layout

```
examples/plugin-standalone-tool/
├── nodal.json
├── package.json
├── tsup.config.ts             # bundles src/tool.js → bin/tool.js (self-contained)
├── src/
│   └── tool.js                # Node ESM entry
├── panel/
│   └── index.html             # static info panel
└── bin/                       # tsup output (gitignored)
```

### Activation

```js
import { createGrpcTransport, createExtensionContext } from '@nodalcore/sdk'

const PLUGIN_ID = process.env.NODALCORE_PLUGIN_ID
const HOST_PORT = parseInt(process.env.NODALCORE_HOST_PORT, 10)

async function activate() {
  const transport = createGrpcTransport({ hostPort: HOST_PORT, pluginId: PLUGIN_ID })
  const ctx       = createExtensionContext(transport, PLUGIN_ID)

  const cfg    = await ctx.workspace.getConfiguration()
  const format = typeof cfg.outputFormat === 'string' ? cfg.outputFormat : 'png'
  await ctx.window.showMessage(`Image processor activated (format: ${format})`)
}

await activate().catch((err) => console.error('[tool] activation failed:', err))

server.listen(0, () => {
  process.stdout.write(`NODALCORE_READY ${server.address().port}\n`)
})
```

The order matters: activation runs **before** `NODALCORE_READY` is
printed. The host's gRPC server is already listening (the spawner started
it before forking); the tool dials in, calls `host.window.showMessage`,
then advertises its own port.

### Limitation: receive-only panel

The standalone-tool's panel ships a static HTML page that:

```html
<script>
  // Subscribe to plugin pushes — works.
  window.nodalcore?.onMessage((data) => console.log('[panel] received', data))

  // Sending to the plugin — does NOT work today.
  // window.nodalcore.postMessage(...)  resolves with `null`.
</script>
```

Why: the gRPC HostAPI defines a single `Request(plugin_id, method, args)`
RPC tool→host. There is no reverse channel. To make a panel call into a
standalone tool we'd need a bidirectional gRPC stream or a second service
exposed by the tool. That's deferred — the device-bridge example
demonstrates the bidirectional pattern.

### Building / installing locally

```bash
pnpm --filter @nodalcore/sdk build
pnpm --filter example-image-processor build
node apps/cli/dist/index.js plugin install ./examples/plugin-standalone-tool
```

After `pnpm dev`:
- Open the **Installed** tab — image processor shows up. Click Start.
- Toast: `Image processor activated (format: png)`.
- Switch to **Workspace** — "Image Processor Info" appears.
- Click it — static panel renders. The browser console shows the
  `[panel] received` line if the plugin pushes any messages (none in
  this example).

## Smoke recipe (full walkthrough)

```bash
# Build everything once
pnpm install
pnpm -r build

# Install both examples
node apps/cli/dist/index.js plugin install ./examples/plugin-device-bridge
node apps/cli/dist/index.js plugin install ./examples/plugin-standalone-tool

# Verify the local registry knows about both
node apps/cli/dist/index.js plugin list

# Start the desktop app
pnpm dev
```

Expected behaviour after a fresh install:
- **Store** tab: empty (mock registry is unreachable in dev — see
  `packages/renderer/src/mockRegistry.ts` for the fallback set).
- **Installed** tab: both plugins. Connect / Start each.
- **Workspace** tab: two panel entries; clicking either loads its HTML.
- Live multimeter ticks once per second; click "Measure now" for an
  explicit reading.
- Theme dropdown switches between default dark and "Multimeter Blue".
- Status bar shows the multimeter's right-aligned slot pill.
- `~/.nodalcore/configurations.json` accumulates settings as you edit
  them in the **Installed** tab's RJSF form.

## Starting your own plugin

The fastest path is to copy one of the examples:

```bash
cp -r examples/plugin-device-bridge plugins/my-sensor
cd plugins/my-sensor

# Edit nodal.json: id, name, connectionType, configuration properties,
# theme(s), and any panel webviews you want.
# Edit src/index.ts: implement connect/disconnect, then activate(ctx).
# Build & install:
pnpm install
pnpm build
node ../../apps/cli/dist/index.js plugin install .
```

For deeper guidance: [`plugin-spec.md`](./plugin-spec.md),
[`host-api.md`](./host-api.md), [`webviews.md`](./webviews.md).
