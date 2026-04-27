# Plugin specification

## nodal.json — the plugin manifest

Every plugin must have a `nodal.json` file at its root. It is validated by
`@nodalcore/plugin-host` at install time using AJV.

```jsonc
{
  // Required fields
  "id":          "com.example.my-sensor",   // reverse-domain, globally unique
  "name":        "My Sensor",
  "version":     "1.0.0",                  // semver
  "sdkVersion":  "^0.1.0",                 // semver range of @nodalcore/sdk
  "type":        "device-bridge",          // or "standalone-tool"
  "settingsSchema": { /* JSON Schema 7 */ },
  "permissions": ["serial"],               // see Permissions below

  // device-bridge only
  "connectionType": "serial",              // serial | usb | bluetooth | tcp | mqtt
  "entry": "dist/index.js",               // path to JS entry, relative to plugin root

  // standalone-tool only
  "executable": "./bin/tool.js",          // path to executable
  "protoFile":  "proto/tool.proto",       // optional: path to .proto file

  // Optional metadata
  "icon":        "icon.png",              // URL or relative path (min 64×64)
  "description": "…",
  "author":      { "name": "…", "email": "…", "url": "…" },
  "repository":  "https://github.com/…",
  "homepage":    "https://…",
  "tags":        ["serial", "sensor"],
  "integrity":   "sha256:<hex>"           // checksum of the plugin archive
}
```

### Field rules

| Field | Rule |
|---|---|
| `id` | Lowercase, reverse-domain style. Must be unique in the registry. |
| `sdkVersion` | Semver range. The host checks compatibility before loading. |
| `settingsSchema` | Valid JSON Schema 7. `"default"` on each property pre-fills the UI. |
| `permissions` | Must match `connectionType` (see below) or be extended for special cases. |
| `entry` | Resolved relative to the plugin directory. Must export a class extending `DevicePlugin`. |
| `executable` | Must print `NODALCORE_READY <port>` to stdout before the 10 s timeout. |

---

## Plugin types

### device-bridge

Wraps a physical device. The plugin entry module must export a default class
that extends `DevicePlugin` from `@nodalcore/sdk`:

```ts
import { DevicePlugin, ConnectionOptions, SettingsRecord } from '@nodalcore/sdk'

export default class MySensor extends DevicePlugin {
  readonly connectionType = 'serial'

  async connect(options: ConnectionOptions): Promise<void> { … }
  async disconnect(): Promise<void> { … }

  getSettingsSchema(): JSONSchema7 { return schema }
  async readSettings(): Promise<SettingsRecord> { … }
  async writeSettings(s: Partial<SettingsRecord>): Promise<void> { … }
}
```

The plugin runs in a forked child process. Communication with the host is
over Node IPC; the host exposes a transparent proxy object.

### standalone-tool

An independent process (any language/runtime). The host `spawn()`s the
executable and waits for it to print:

```
NODALCORE_READY <port>
```

After that the host connects to the tool's gRPC/Connect server on `<port>`.
An optional `.proto` file can be declared in `nodal.json` for schema discovery.

---

## Connection types & permissions

| `connectionType` | Auto-granted `permissions` |
|---|---|
| `serial` | `["serial"]` |
| `usb` | `["usb"]` |
| `bluetooth` | `["bluetooth"]` |
| `tcp` | `["network"]` |
| `mqtt` | `["network"]` |

Permissions are shown to the user at install time (similar to a mobile app).
Extra permissions (e.g. `["serial", "filesystem"]`) can be declared explicitly.

---

## Settings schema conventions

```jsonc
{
  "type": "object",
  "title": "Sensor Settings",          // displayed as the form title
  "properties": {
    "baudRate": {
      "type": "number",
      "title": "Baud rate",
      "enum": [9600, 19200, 38400, 115200],
      "default": 115200
    },
    "autoRange": {
      "type": "boolean",
      "title": "Auto-range",
      "default": true
    }
  },
  "required": ["baudRate"]
}
```

- Use `"default"` on every property — it pre-fills the form when no live
  `formData` is available.
- Keep property keys camelCase; `"title"` is the human-readable label.
- Complex nested schemas work; RJSF renders them recursively.

---

## Registry index entry

When a plugin is submitted to the central registry, a `RegistryPluginEntry`
record is added to `index.json` on the registry GitHub Pages repo:

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
  "installs":       0,
  "updatedAt":      "2026-01-01T00:00:00.000Z"
}
```

The `manifestUrl` field is used by the installer to fetch the full `nodal.json`
and resolve the git repository URL for cloning.
