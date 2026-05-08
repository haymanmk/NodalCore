# @nodalcore/sdk

Shared types and host-API surface for NodalCore plugin authors and the host
application. Everything a plugin imports comes from here.

## Versioning

```ts
import { SDK_VERSION } from '@nodalcore/sdk'
```

The host's `SDK_VERSION` constant is checked at install time against each
plugin's `manifest.sdkVersion` semver range. Bumping
`packages/sdk/package.json` without bumping `SDK_VERSION` (in
`src/version.ts`) silently lets mismatched plugins through — keep them in
lockstep.

## Manifest types

```ts
import type {
  PluginManifest, PluginType, ConnectionType, Permission,
  Contributes,
  ThemeContribution,
  ConfigurationContribution,
  StatusBarContribution,
  WebviewContribution,
  WebviewCsp,
  DeclarativeViewContribution,
  DeclarativeViewSlotType,
} from '@nodalcore/sdk'
```

`PluginManifest` is the shape of every plugin's `nodal.json`. Settings,
themes, and panel webviews live under `manifest.contributes`; the
top-level `entry` and `settingsSchema` fields used in pre-0.2.0 plugins
have been removed and the installer rejects manifests that still use
them. See [`docs/plugin-spec.md`](../../docs/plugin-spec.md).

## Plugin types

### `DevicePlugin` — device-bridge plugins

```ts
import { DevicePlugin } from '@nodalcore/sdk'
import type { ConnectionOptions, ExtensionContext } from '@nodalcore/sdk'

export default class MySensor extends DevicePlugin {
  readonly connectionType = 'serial' as const
  async connect(options: ConnectionOptions): Promise<void> { /* … */ }
  async disconnect(): Promise<void> { /* … */ }
}

export async function activate(ctx: ExtensionContext): Promise<void> {
  const cfg = await ctx.workspace.getConfiguration()
  await ctx.window.showMessage(`MySensor up (mode: ${cfg.mode})`)
}
```

The class only carries the connection lifecycle. Settings, host
notifications, and panel webview routing are all reached through
`ctx` — there are no `getSettingsSchema` / `readSettings` / `writeSettings`
methods anymore.

### `StandaloneTool` — out-of-process plugins

```ts
import type { StandaloneTool } from '@nodalcore/sdk'
```

Standalone tools don't extend a class — they are independent processes
that build their own `ctx` via `createGrpcTransport` +
`createExtensionContext` and dial the host's gRPC HostAPI. See the
"Host API surface" section below.

## `ConnectionOptions`

Discriminated union keyed on `connectionType`. Every variant carries the
discriminator so the union narrows correctly:

| `connectionType` | Required | Optional |
|---|---|---|
| `serial` | `port`, `baudRate` | `dataBits`, `stopBits`, `parity` |
| `usb` | `vendorId`, `productId` | — |
| `bluetooth` | `serviceUUID` | `characteristicUUID` |
| `tcp` | `host`, `port` | — |
| `mqtt` | `brokerUrl`, `topic` | `username`, `password` |

Built-in JSON Schemas matching each variant are exported so the renderer's
"Connect" dialog can be schema-driven without hand-coded forms:

```ts
import { connectionSchemas } from '@nodalcore/sdk/schemas/connection'
//   { serial: JSONSchema7, usb: JSONSchema7, … }
```

## Host API surface

```ts
import {
  createIpcTransport,    // device-bridge worker
  createExtensionContext,
  coalesceLastWins,      // helper for plugin → webview throttling
  HOST_API_PROTO_TEXT,   // embedded host_api.proto for non-JS tools
} from '@nodalcore/sdk'

// Standalone-tool plugins only — gRPC transport lives at a separate subpath
// so device-bridge plugins (which use IPC) don't drag @grpc/grpc-js +
// @grpc/proto-loader into their tsup `noExternal: [/.*\/]` bundle.
import { createGrpcTransport } from '@nodalcore/sdk/grpc'

import type {
  Transport, RequestHandler,
  ExtensionContext,
  WindowApi, WorkspaceApi, ViewsApi,
  ViewMessageHandler,
  ConfigurationChangeHandler,
  ShowModalOptions, ModalButton,
} from '@nodalcore/sdk'
```

`ExtensionContext` exposes three sub-surfaces:

```ts
interface ExtensionContext {
  pluginId: string
  window:    WindowApi      // showMessage / showWarning / showModal
  workspace: WorkspaceApi   // getConfiguration / setConfiguration
  views:     ViewsApi       // postMessage / onMessage to panel webviews
}
```

The same `ctx` shape is built by `createExtensionContext(transport, id)`
regardless of plugin type — only the underlying `Transport` differs:

| Plugin type | Adapter | Wire | Import from |
|---|---|---|---|
| device-bridge | `createIpcTransport()` | Node IPC envelope inside the forked worker | `@nodalcore/sdk` |
| standalone-tool | `createGrpcTransport({ hostPort, pluginId })` | gRPC `HostAPI.Request(plugin_id, method, args_json)` | `@nodalcore/sdk/grpc` |

For tools written in non-JS languages, `HOST_API_PROTO_TEXT` carries the
proto definition as a string so the SDK is bundleable without shipping
a `.proto` file alongside.

Full reference for every method: [`docs/host-api.md`](../../docs/host-api.md).

## Build

```bash
pnpm build   # tsup → dist/{index,grpc,schemas/connection}.{js,cjs} + .d.ts
```

The package exposes:
- `@nodalcore/sdk` — main entry: types, IPC transport, extension context, schemas of common shapes. Bundleable everywhere (no Node-only deps).
- `@nodalcore/sdk/schemas/connection` — connection-options JSON schemas, importable from the renderer without dragging the host module graph.
- `@nodalcore/sdk/grpc` — `createGrpcTransport` only. Pulls `@grpc/grpc-js` + `@grpc/proto-loader`, so it lives at its own subpath and is opt-in. Standalone-tool plugins import it explicitly; device-bridge plugins never need it.

This split exists because plugins are bundled with `tsup`'s
`noExternal: [/.*\/]` (single-source, no `node_modules` after install) — a
top-level static import of `@grpc/*` from the bare entry would force every
device-bridge plugin to ship those modules even though they use IPC. All
three subpaths are real package exports — no deep-import-into-`dist`
required.
