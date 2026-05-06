# Host API

Every plugin receives an `ExtensionContext` (`ctx`) the first time the host
activates it. The same surface is available regardless of plugin type — the
underlying transport differs (Node IPC for device-bridge, gRPC for
standalone-tool), but the SDK hides that.

```ts
interface ExtensionContext {
  pluginId: string
  window:    WindowApi
  workspace: WorkspaceApi
  views:     ViewsApi
}
```

`ctx` is built by `createExtensionContext(transport, pluginId)`. For
device-bridge plugins the worker constructs it before calling `activate(ctx)`.
For standalone-tool plugins, the tool process constructs it itself once
`NODALCORE_HOST_PORT` resolves.

## `ctx.window`

```ts
interface WindowApi {
  showMessage(
    message: string,
    level?: 'info' | 'warning' | 'error',
  ): Promise<void>
}
```

`showMessage` raises a toast in the desktop renderer (bottom-right). In
headless contexts (CLI, MCP) it currently logs to stderr.

```ts
await ctx.window.showMessage('Connection lost', 'warning')
```

Routing: plugin → broker `window.showMessage` handler →
`setWindowMessageEmitter` callback (the desktop main wires this to
`mainWindow.webContents.send('host:window:showMessage', ...)`) → renderer's
`HostMessageToast` component subscribes via `__nodalcore.onHostMessage`.

## `ctx.workspace`

```ts
interface WorkspaceApi {
  getConfiguration(): Promise<Record<string, unknown>>
  setConfiguration(values: Record<string, unknown>): Promise<void>
}
```

Both methods read/write the host's per-plugin configuration record at
`~/.nodalcore/configurations.json`. The schema for these values comes from
`manifest.contributes.configuration.properties`. `setConfiguration` is a
**merge**, not a replace — it keeps unrelated keys intact.

```ts
const cfg = await ctx.workspace.getConfiguration()
const baudRate = (cfg.baudRate as number | undefined) ?? 115200
await ctx.workspace.setConfiguration({ lastConnected: Date.now() })
```

The renderer's settings form (RJSF, in `InstalledPage`) writes through the
same store — there is no separate "live" plugin settings copy. Writes from
the form land in `~/.nodalcore/configurations.json`; the next
`getConfiguration` call from the plugin sees them.

## `ctx.views`

```ts
type ViewMessageHandler = (data: unknown) => unknown | Promise<unknown>

interface ViewsApi {
  postMessage(slotId: string, data: unknown): Promise<unknown>
  onMessage(slotId: string, handler: ViewMessageHandler): void
}
```

Bidirectional channel between a plugin and one of its panel webviews.
`slotId` matches a `contributes.views.panel[].id` entry in the manifest.

### Plugin → webview

```ts
ctx.views.postMessage('readout', { value: 42, unit: 'V', ts: Date.now() })
```

Routing: plugin → broker `views.postMessage` handler → `manager.sendToPanel`
finds the open `WebContentsView` for `(pluginId, slotId)` → `WebContents.send('webview:msg-from-plugin', data)` → preload `window.nodalcore.onMessage`
subscribers fire.

If no view is currently open for that slot, the host returns false and the
push is dropped silently. Plugins should re-send when the view becomes
visible if they care — there is no automatic replay yet (`coalesceLastWins`
in the SDK is a plugin-side helper, not yet wired to the lifecycle).

### Webview → plugin

```ts
ctx.views.onMessage('readout', async (data) => {
  if ((data as { type?: string } | null)?.type === 'measure') {
    return takeReading()  // returned value is delivered back to the webview
  }
  return null
})
```

Routing: webview JS calls `window.nodalcore.postMessage(data)` →
`webview:msg-to-plugin` IPC → main looks up `(pluginId, slotId)` from the
sending `WebContents` → `sendToPlugin(id, 'views.message', { slotId, data })`
→ the plugin's `views.onMessage(slotId)` handler runs → return value
propagates back as the resolved value of `window.nodalcore.postMessage`.

`onMessage` registers per-slot — registering again replaces the previous
handler. There is no broadcast.

### Standalone-tool limitation

`createGrpcTransport`'s `onRequest` throws — the gRPC HostAPI is one-way
(tool → host). That means **panel → standalone-tool messages aren't
routed**: `window.nodalcore.postMessage` from a panel attached to a
standalone-tool plugin returns `null`. Plugin → panel pushes do work
(broker → manager → `WebContents.send`).

This is a known limitation; lifting it requires a reverse gRPC channel
(either bidirectional streams or a second service hosted by the tool).

## Transports

The transport is a low-level escape hatch. You almost never need it
directly — `createExtensionContext` wraps it. But understanding the wire
format helps when debugging.

```ts
interface Transport {
  request(method: string, args: unknown): Promise<unknown>
  onRequest(method: string, handler: RequestHandler): void
}
```

### `createIpcTransport()` — device-bridge

Inside the forked worker, the SDK reads `process.send` / `process.on('message')`
through a `globalThis` cast (no `@types/node` dep) and wraps the Node IPC
channel with a unified envelope:

```ts
{ kind: 'request' | 'response', seq: number, method?: string, args?: unknown,
  result?: unknown, error?: string }
```

Separate sequence spaces in each direction so concurrent in/out requests
can't collide.

### `createGrpcTransport({ hostPort, pluginId, hostAddress?, deadlineMs? })` — standalone-tool

Dials `localhost:hostPort` (or the override) and exposes a one-shot RPC per
request:

```proto
service HostAPI {
  rpc Request(HostRequest) returns (HostResponse);
}

message HostRequest  { string plugin_id = 1; string method = 2; string args_json = 3; }
message HostResponse { string result_json = 1; string error = 2; }
```

`args` and the resolved value are JSON-serialized strings — adding a new
host method doesn't require regenerating proto stubs in any plugin
language. Deadlines default to 30 s; pass `deadlineMs` to tighten.

The proto file ships in two places: `packages/sdk/src/proto/host_api.proto`
(for non-JS consumers) and embedded as a string constant
`HOST_API_PROTO_TEXT` (so the SDK is bundleable — the JS adapter
materializes it to a temp file once per process).

## Activation contracts

### device-bridge

The forked worker imports the plugin's `main` module, then:

1. If the module exports `activate(ctx)`, call it once with a freshly
   built `ExtensionContext`.
2. If the module exports `deactivate()`, store it and call it on shutdown.

Concurrency: `activate` runs on the worker's event loop. Long-running
work (intervals, subscriptions) belongs there. The host calls
`connect`/`disconnect`/`shutdown` separately — those are `DevicePlugin`
class methods, not part of `ctx`.

### standalone-tool

There is no `activate(ctx)` injection — the tool **is** its own process.
Idiomatic activation:

```ts
import { createGrpcTransport, createExtensionContext } from '@nodalcore/sdk'

const HOST_PORT = parseInt(process.env.NODALCORE_HOST_PORT!, 10)
const PLUGIN_ID = process.env.NODALCORE_PLUGIN_ID!

async function main() {
  const transport = createGrpcTransport({ hostPort: HOST_PORT, pluginId: PLUGIN_ID })
  const ctx = createExtensionContext(transport, PLUGIN_ID)
  // … host calls during activation …
  startToolService()
  process.stdout.write(`NODALCORE_READY ${toolPort}\n`)
}
main().catch((err) => { console.error(err); process.exit(1) })
```

The host doesn't care about anything except `NODALCORE_READY <port>` on
stdout; everything else is the tool's choice.

## Error semantics

- Outbound (`request`) errors propagate as a rejected Promise. The wire
  format carries `error: string`; it surfaces as `new Error(error)`.
- Inbound handler exceptions (`onRequest`) are caught at the transport
  layer and serialized into the error field — the host sees a rejected
  Promise rather than a worker crash.
- A plugin worker that throws synchronously during module-load (e.g.
  bad import) reaches the loader as a rejected `init` request, and
  `loadDevicePlugin` rejects the IPC handler — the renderer surfaces
  the error.
- A standalone tool that exits before `NODALCORE_READY` rejects
  `spawnTool`. The host's gRPC server is torn down on the tool's exit
  event.

## See also

- [`plugin-spec.md`](./plugin-spec.md) — manifest fields and contributes
  shape.
- [`webviews.md`](./webviews.md) — the panel pipeline and the
  `window.nodalcore` surface.
- [`examples.md`](./examples.md) — both halves of the bidirectional
  `views` API exercised end-to-end.
