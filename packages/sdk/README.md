# @nodalcore/sdk

Shared types and abstract base classes for NodalCore plugin authors and the
host application.

## Contents

### `PluginManifest`

The shape of every plugin's `nodal.json` file. Validated by
`@nodalcore/plugin-host` at install time.

```ts
import type { PluginManifest } from '@nodalcore/sdk'
```

Key fields: `id`, `name`, `version`, `type`, `connectionType`,
`settingsSchema`, `permissions`. See [`docs/plugin-spec.md`](../../docs/plugin-spec.md)
for the full reference.

### `DevicePlugin`

Abstract base class for **device-bridge** plugins.

```ts
import { DevicePlugin } from '@nodalcore/sdk'
import type { ConnectionOptions, SettingsRecord } from '@nodalcore/sdk'

export default class MySensor extends DevicePlugin {
  readonly connectionType = 'serial'

  async connect(options: ConnectionOptions): Promise<void> { … }
  async disconnect(): Promise<void> { … }
  getSettingsSchema(): JSONSchema7 { … }
  async readSettings(): Promise<SettingsRecord> { … }
  async writeSettings(s: Partial<SettingsRecord>): Promise<void> { … }
}
```

### `StandaloneTool`

Interface for **standalone-tool** plugins (any language/runtime).

```ts
import type { StandaloneTool } from '@nodalcore/sdk'
```

### `ConnectionOptions`

Discriminated union covering all supported transports:

| `connectionType` | Options |
|---|---|
| `serial` | `port`, `baudRate`, `dataBits?`, `stopBits?`, `parity?` |
| `usb` | `vendorId`, `productId` |
| `bluetooth` | `serviceUUID`, `characteristicUUID?` |
| `tcp` | `host`, `port` |
| `mqtt` | `brokerUrl`, `topic`, `username?`, `password?` |

### `SettingsRecord`

```ts
type SettingsRecord = Record<string, unknown>
```

## Build

```bash
pnpm build   # tsup → dist/index.js + dist/index.cjs
```
