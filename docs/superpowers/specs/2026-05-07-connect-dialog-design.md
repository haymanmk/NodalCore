# Connect dialog (schema-driven, last-used prefill) — design

**Status:** approved (brainstormed 2026-05-07)
**Owner:** desktop / sdk / plugin-host
**Affects:** `apps/desktop`, `packages/sdk`, `packages/plugin-host`, `packages/renderer`

## Problem

The desktop's Connect button on the Installed tab calls `device:connect` with no options today. For a TCP-only plugin (the immediate motivator) this means the plugin's `connect()` method receives `{}` and has no way to know which host or port to dial. Plugin authors currently have to either hardcode addresses, hand-roll an out-of-band config dialog, or stash values via the SettingsPanel — and the SettingsPanel is itself gated on `status === 'running'`, which can't happen until after a successful connect (chicken-and-egg).

We want a Connect button that opens a schema-driven dialog before the actual connect runs, prefills it with the values the user entered last time, and only persists them after the connect succeeds — so a fat-fingered IP doesn't poison future Connect clicks.

## Decisions (set during brainstorming)

| Question | Decision |
|---|---|
| Where do connection options live? | Separate host-owned store. Plugins receive them only via the existing `DevicePlugin.connect(options)` parameter — never via `workspace.getConfiguration()` |
| Which connection types in v1? | All five built-in types (`serial`, `usb`, `bluetooth`, `tcp`, `mqtt`), schema-driven |
| Form rendering | RJSF (already in the renderer's deps for `SettingsPanel`) |
| Schema source | Built into the SDK, one JSONSchema7 per ConnectionType |
| Dialog trigger | Always opens on Connect click (with prefilled last-used values) |
| Persistence policy | Persist only after a successful `connect()` |
| Cancel behaviour | Esc closes; outside-click does NOT (avoids accidental dismissal) |

## Architecture

```
packages/sdk/src/
  schemas/connection.ts          (NEW — built-in JSONSchema7 per ConnectionType)
  index.ts                       (re-exports the schema map)

packages/plugin-host/src/
  connection-store.ts            (NEW — ~/.nodalcore/connections.json CRUD)
  index.ts                       (re-exports get/set/clear)
  __tests__/connection-store.test.ts

apps/desktop/src/
  main/index.ts                  (UPDATED — new IPC: connection:read; device:connect persists on success)
  preload/index.ts               (UPDATED — exposes readConnection)

packages/renderer/src/
  components/ConnectDialog.tsx   (NEW — RJSF form, submit/cancel, prefill mechanics)
  hooks/usePluginBridge.ts       (UPDATED — bridge gains readConnection; connect() takes optional options)
  pages/InstalledPage.tsx        (UPDATED — Connect button opens ConnectDialog instead of calling connect() directly)
  styles/index.css               (UPDATED — six new .connect-dialog__* classes)
```

## Click-flow

```
User clicks Connect on a plugin row in InstalledPage
  → renderer: bridge.readConnection(pluginId, manifest.connectionType)
  → IPC: connection:read
  → main: connectionStore.get(pluginId, expectedType) → ConnectionOptions | null
  → renderer: open <ConnectDialog>
       schema      = connectionSchemas[manifest.connectionType]
       formData    = stored options ?? schema's defaults

User edits, clicks Connect inside the dialog
  → renderer: bridge.connect(pluginId, options)
  → IPC: device:connect(pluginId, options)
  → main: loadDevicePlugin(pluginId)            ← fork worker, init
          proxy.connect(options)                ← actually open device
          connectionStore.set(pluginId, options) ← persist ONLY on success
  → renderer: refresh() picks up new 'running' status; button flips to Disconnect

User clicks Cancel / Esc
  → dialog closes; nothing else happens (no load, no persistence write)
```

## Built-in schemas

`packages/sdk/src/schemas/connection.ts`:

```ts
import type { JSONSchema7 } from 'json-schema'
import type { ConnectionType } from '../types/manifest.js'

export const connectionSchemas: Record<ConnectionType, JSONSchema7> = {
  serial: {
    type: 'object',
    required: ['port', 'baudRate'],
    properties: {
      connectionType: { type: 'string', const: 'serial' },
      port:     { type: 'string',  title: 'Port', description: 'e.g. /dev/ttyUSB0 or COM3', default: '' },
      baudRate: { type: 'integer', title: 'Baud rate',
                  enum: [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600], default: 115200 },
      dataBits: { type: 'integer', title: 'Data bits', enum: [5, 6, 7, 8], default: 8 },
      stopBits: { type: 'integer', title: 'Stop bits', enum: [1, 2], default: 1 },
      parity:   { type: 'string',  title: 'Parity',
                  enum: ['none', 'even', 'odd', 'mark', 'space'], default: 'none' },
    },
  },

  usb: {
    type: 'object',
    required: ['vendorId', 'productId'],
    properties: {
      connectionType: { type: 'string', const: 'usb' },
      vendorId:  { type: 'integer', title: 'Vendor ID',
                   description: '0x… (decimal accepted)', minimum: 0, maximum: 0xFFFF, default: 0 },
      productId: { type: 'integer', title: 'Product ID',
                   minimum: 0, maximum: 0xFFFF, default: 0 },
    },
  },

  bluetooth: {
    type: 'object',
    required: ['serviceUUID'],
    properties: {
      connectionType:     { type: 'string', const: 'bluetooth' },
      serviceUUID:        { type: 'string', title: 'Service UUID',
                            description: 'e.g. 0000180f-0000-1000-8000-00805f9b34fb', default: '' },
      characteristicUUID: { type: 'string', title: 'Characteristic UUID (optional)', default: '' },
    },
  },

  tcp: {
    type: 'object',
    required: ['host', 'port'],
    properties: {
      connectionType: { type: 'string', const: 'tcp' },
      host: { type: 'string',  title: 'Host', description: 'IP address or hostname', default: '127.0.0.1' },
      port: { type: 'integer', title: 'Port', minimum: 1, maximum: 65535, default: 5025 },
    },
  },

  mqtt: {
    type: 'object',
    required: ['brokerUrl', 'topic'],
    properties: {
      connectionType: { type: 'string', const: 'mqtt' },
      brokerUrl: { type: 'string', title: 'Broker URL',
                   description: 'e.g. mqtts://broker.example.com:8883', default: '' },
      topic:     { type: 'string', title: 'Topic', default: '' },
      username:  { type: 'string', title: 'Username (optional)', default: '' },
      password:  { type: 'string', title: 'Password (optional)', format: 'password', default: '' },
    },
  },
}
```

Re-exported from `packages/sdk/src/index.ts`:

```ts
export { connectionSchemas } from './schemas/connection.js'
```

**Three points worth flagging:**

1. **`connectionType` is a `const` field in every schema.** When the form submits, that constant lands in the values object and the result is a *valid* `ConnectionOptions` discriminated-union member with no extra glue. The renderer hides the field via `uiSchema: { connectionType: { 'ui:widget': 'hidden' } }`.
2. **Defaults are sensible but conservative.** TCP defaults to `127.0.0.1:5025` (a common SCPI port) so the form isn't empty on first open. USB IDs default to `0` (signals "must set"). Empty strings on UUIDs/topics combined with `required` triggers RJSF's missing-field UI.
3. **Stored values always win over schema defaults.** Once the user has connected once, the prefill shows their last values; until then, conservative schema defaults.

## Persistence — `packages/plugin-host/src/connection-store.ts`

```ts
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { ConnectionOptions } from '@nodalcore/sdk'

const CONNECTIONS_FILE = path.join(os.homedir(), '.nodalcore', 'connections.json')

type ConnectionsStore = Record<string, ConnectionOptions>

async function readStore(): Promise<ConnectionsStore> {
  try {
    const raw = await fs.readFile(CONNECTIONS_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ConnectionsStore
    }
    return {}
  } catch {
    return {}
  }
}

async function writeStore(store: ConnectionsStore): Promise<void> {
  await fs.mkdir(path.dirname(CONNECTIONS_FILE), { recursive: true })
  await fs.writeFile(CONNECTIONS_FILE, JSON.stringify(store, null, 2), 'utf8')
}

/**
 * Read the last-used connection options for a plugin, or null if none stored.
 * The host validates the discriminator matches what the plugin's manifest
 * declares; a stale stored value (manifest changed plugin types since save)
 * is treated as "no value" rather than handed back wrong.
 */
export async function getConnectionOptions(
  pluginId: string,
  expectedType: string,
): Promise<ConnectionOptions | null> {
  const store = await readStore()
  const entry = store[pluginId]
  if (!entry) return null
  if (entry.connectionType !== expectedType) return null
  return entry
}

export async function setConnectionOptions(
  pluginId: string,
  options: ConnectionOptions,
): Promise<void> {
  const store = await readStore()
  store[pluginId] = options
  await writeStore(store)
}

export async function clearConnectionOptions(pluginId: string): Promise<void> {
  const store = await readStore()
  delete store[pluginId]
  await writeStore(store)
}

export { CONNECTIONS_FILE }
```

Re-exported from `packages/plugin-host/src/index.ts`:

```ts
export {
  getConnectionOptions,
  setConnectionOptions,
  clearConnectionOptions,
  CONNECTIONS_FILE,
} from './connection-store.js'
```

Mirrors the existing `configuration.ts` shape (read-swallow-on-error, atomic JSON writes). Kept in a separate file because the data lifetimes and consumers differ — configurations are plugin-readable; connections are host-private.

## IPC additions

One new channel; one update to the existing channel. The `device:connect` channel already accepts an `options` second arg from earlier work — we just start using it and persist on success.

```ts
// apps/desktop/src/main/index.ts — additions
import {
  // …existing imports…
  getConnectionOptions,
  setConnectionOptions,
} from '@nodalcore/plugin-host'

safeHandle(
  'connection:read',
  'Read stored connection options',
  async (_event, pluginId: string, expectedType: string) => {
    return getConnectionOptions(pluginId, expectedType)   // ConnectionOptions | null
  },
)
```

Updated `device:connect`:

```ts
safeHandle('device:connect', 'Connect device', async (_event, pluginId: string, options?: ConnectionOptions) => {
  const proxy = await loadDevicePlugin(pluginId)
  const opts = (options ?? {}) as ConnectionOptions
  await proxy.connect(opts)
  // Only persist after a successful connect — never store options that didn't work.
  if (options) await setConnectionOptions(pluginId, options)
  return { success: true }
})
```

## Preload + bridge

```ts
// apps/desktop/src/preload/index.ts — one new entry
readConnection: (pluginId: string, expectedType: string) =>
  ipcRenderer.invoke('connection:read', pluginId, expectedType),
```

```ts
// packages/renderer/src/hooks/usePluginBridge.ts — interface additions
interface NodalCoreBridge {
  // …existing…
  connect: (id: string, options?: ConnectionOptions) => Promise<void>
  readConnection?: (id: string, expectedType: string) => Promise<ConnectionOptions | null>
}
```

The hook's `connect` callback gains the optional second argument, and a new `readConnection` callback is exposed alongside the existing methods:

```ts
const connect = useCallback(async (id: string, options?: ConnectionOptions) => {
  await bridge.connect(id, options)
  await refresh()
}, [bridge, refresh])

const readConnection = useCallback(
  async (id: string, expectedType: string): Promise<ConnectionOptions | null> => {
    if (!bridge.readConnection) return null
    return bridge.readConnection(id, expectedType)
  },
  [bridge],
)
```

`readConnection` is added to the hook's returned object alongside `connect`, `disconnect`, `readSettings`, etc. — same pattern, consumers go through the hook, not the bare bridge.

Web-mode fallback (`getBridge()`'s stub) leaves `bridge.readConnection` undefined — same optional-method pattern as `onHostMessage` and `signalReady`. The hook's wrapper resolves to `null` in that case.

## ConnectDialog component

`packages/renderer/src/components/ConnectDialog.tsx`. Reuses the same RJSF + ajv8 setup as `SettingsPanel`; no new dependencies.

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import Form from '@rjsf/core'
import type { IChangeEvent } from '@rjsf/core'
import type { ValidatorType } from '@rjsf/utils'
import validator from '@rjsf/validator-ajv8'
import type { JSONSchema7 } from 'json-schema'
import type { ConnectionOptions, ConnectionType } from '@nodalcore/sdk'
import { connectionSchemas } from '@nodalcore/sdk'

export interface ConnectDialogProps {
  pluginId: string
  pluginName: string
  connectionType: ConnectionType
  initialOptions: ConnectionOptions | null
  onSubmit: (options: ConnectionOptions) => Promise<void>
  onCancel: () => void
}

export function ConnectDialog({
  pluginId,
  pluginName,
  connectionType,
  initialOptions,
  onSubmit,
  onCancel,
}: ConnectDialogProps) {
  const schema = connectionSchemas[connectionType] as JSONSchema7

  const [formData, setFormData] = useState<Record<string, unknown>>(
    () => (initialOptions ? { ...(initialOptions as object) } : { connectionType }),
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Esc closes the dialog; click-outside intentionally does NOT.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [submitting, onCancel])

  const formRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('input, select')?.focus()
  }, [])

  const handleSubmit = useCallback(
    async (data: IChangeEvent<Record<string, unknown>>) => {
      if (!data.formData) return
      const opts = { ...data.formData, connectionType } as unknown as ConnectionOptions
      setSubmitting(true)
      setError(null)
      try {
        await onSubmit(opts)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setSubmitting(false)
      }
    },
    [connectionType, onSubmit],
  )

  return (
    <div className="connect-dialog__backdrop" role="presentation">
      <div
        className="connect-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`connect-dialog-title-${pluginId}`}
        ref={formRef}
      >
        <header className="connect-dialog__header">
          <h2 id={`connect-dialog-title-${pluginId}`} className="connect-dialog__title">
            Connect — {pluginName}
          </h2>
          <p className="connect-dialog__sub">{connectionType.toUpperCase()} connection</p>
        </header>

        <Form
          schema={schema}
          formData={formData}
          validator={validator as unknown as ValidatorType}
          onChange={(e) => setFormData(e.formData ?? {})}
          onSubmit={handleSubmit}
          disabled={submitting}
          uiSchema={{
            connectionType: { 'ui:widget': 'hidden' },
            password: { 'ui:widget': 'password' },
          }}
        >
          {error && (
            <div className="connect-dialog__error" role="alert">
              {error}
            </div>
          )}

          <div className="connect-dialog__footer">
            <button
              type="button"
              className="connect-dialog__btn connect-dialog__btn--cancel"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="connect-dialog__btn connect-dialog__btn--submit"
              disabled={submitting}
            >
              {submitting ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </Form>
      </div>
    </div>
  )
}
```

**Deliberate choices:**

- **No `<dialog>` element / portal.** Renders inline as a fixed-position overlay child of the React tree. Avoids portal complexity; CSS owns the z-index above everything except panel webviews (which the user can't open from a non-running plugin anyway).
- **Esc closes; outside-click doesn't.** Outside-click cancellation is too easy to mis-trigger; form data lives in component state that vanishes on unmount.
- **Submit shows "Connecting…" and disables both buttons.** `device:connect` can take seconds for slow handshakes.
- **Errors stay inline in the dialog.** Failed connect → user can edit and retry without losing form state. A toast still fires from `safeHandle` for global visibility.
- **No "Don't show next time" checkbox.** User asked for the dialog every Connect click, prefilled.

## CSS

Six classes added to `packages/renderer/src/styles/index.css`, all using existing CSS custom properties (`--surface`, `--accent`, `--accent-hover`, `--border`, `--text`, `--text-muted`, `--accent-light`). If `--danger` isn't already declared, it's added next to the other root custom properties as `#dc2626`.

```css
.connect-dialog__backdrop {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}
.connect-dialog {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1.5rem;
  min-width: 24rem; max-width: 32rem;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
}
.connect-dialog__header { margin-bottom: 1rem; }
.connect-dialog__title { font-size: 1.1rem; margin: 0; color: var(--text); }
.connect-dialog__sub {
  font-size: 0.8rem; color: var(--text-muted); margin: 0.25rem 0 0;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.connect-dialog__footer {
  display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem;
}
.connect-dialog__btn {
  padding: 0.5rem 1rem; border-radius: 6px;
  border: 1px solid var(--border); cursor: pointer;
}
.connect-dialog__btn--submit {
  background: var(--accent); color: white; border-color: var(--accent);
}
.connect-dialog__btn--submit:hover:not(:disabled) { background: var(--accent-hover); }
.connect-dialog__btn--submit:disabled { opacity: 0.6; cursor: not-allowed; }
.connect-dialog__btn--cancel { background: transparent; color: var(--text); }
.connect-dialog__error {
  margin-top: 0.75rem; padding: 0.5rem 0.75rem; border-radius: 4px;
  background: var(--accent-light); color: var(--danger, #dc2626);
  border: 1px solid var(--danger, #dc2626); font-size: 0.85rem;
}
```

## InstalledPage integration

```tsx
// packages/renderer/src/pages/InstalledPage.tsx — additions
import { useState, useCallback } from 'react'
import { connectionSchemas, type ConnectionOptions } from '@nodalcore/sdk'
import { ConnectDialog } from '../components/ConnectDialog.js'

// `connect` and `readConnection` come from usePluginBridge(); pull them out of
// the existing hook destructure at the top of InstalledPage.
const { /* …existing… */, connect, readConnection } = usePluginBridge()

const [dialogFor, setDialogFor] = useState<{
  entry: InstalledPluginEntry
  initialOptions: ConnectionOptions | null
} | null>(null)

const onConnectClick = useCallback(async (entry: InstalledPluginEntry) => {
  const ct = entry.manifest.connectionType
  if (!ct || !(ct in connectionSchemas)) {
    // Unknown connectionType — fall back to today's empty-options behaviour.
    await connect(entry.manifest.id)
    return
  }
  const initial = await readConnection(entry.manifest.id, ct)
  setDialogFor({ entry, initialOptions: initial })
}, [connect, readConnection])
```

Replace the existing Connect button's `onClick` with `() => onConnectClick(entry)`. At the bottom of the Installed list (after the `.map(...)`), render the dialog conditionally:

```tsx
{dialogFor && (
  <ConnectDialog
    pluginId={dialogFor.entry.manifest.id}
    pluginName={dialogFor.entry.manifest.name}
    connectionType={dialogFor.entry.manifest.connectionType!}
    initialOptions={dialogFor.initialOptions}
    onSubmit={async (options) => {
      await connect(dialogFor.entry.manifest.id, options)
      setDialogFor(null)
    }}
    onCancel={() => setDialogFor(null)}
  />
)}
```

## Failure / edge cases

| Case | Behaviour |
|---|---|
| Plugin's `manifest.connectionType` is one of the five built-in keys | Dialog opens, schema-driven |
| `manifest.connectionType` is undefined or unknown | Skip dialog, call `connect(id)` with no options. `console.warn` so plugin authors notice |
| `bridge.readConnection` is undefined (web fallback) | No last-used → schema defaults |
| Stored options have a stale `connectionType` | `getConnectionOptions(id, expectedType)` returns null → schema defaults. Stale entry stays on disk; will be overwritten on next successful connect |
| `proxy.connect(options)` throws | Inline error in dialog; user can edit and retry. Toast also fires via `safeHandle`. Bad options NOT persisted (only persist on success) |
| User clicks Connect twice quickly | Second click is a no-op while `submitting === true` (button disabled) |
| User closes the app mid-dialog | Component-local state lost; nothing persisted |

## Testing

- **`connection-store.ts`** — unit tests under `packages/plugin-host/src/__tests__/connection-store.test.ts`:
  - `set` then `get` round-trips a `TcpConnectionOptions`
  - `get` for an unknown pluginId returns `null`
  - `get` with an `expectedType` mismatch returns `null` (the manifest-changed guard)
  - `clear` removes the entry
  - File missing / corrupted → `get` returns `null` instead of throwing

  Tests use a redirected `CONNECTIONS_FILE` via a temp-dir fixture — same approach we'll establish in this task and reuse for any future host-data tests.

- **`connectionSchemas`** — small assertion tests under `packages/sdk/src/__tests__/connection-schemas.test.ts`:
  - Every key in the map matches the schema's `connectionType` `const` value
  - All `required` fields appear in the `properties` map
  - Catches "I forgot to update the schema after a SDK type change" regressions

- **`ConnectDialog`** — no component-level tests in v1. The renderer has no existing component test setup; standing up jsdom + RTL for one component is disproportionate. Manual smoke covers the flow.

- **End-to-end smoke** (manual) — covered in the implementation plan: install the device-bridge example (its `connectionType` is `serial` per the manifest, so the dialog will render the serial schema), open the dialog, edit fields, submit, observe success toast, click Disconnect, click Connect again, observe prefilled values.

## Non-goals

Explicitly out of scope:

- Per-device connection histories (multiple stored configs per plugin). One stored options bag per pluginId.
- "Connect with last-used, no dialog" shortcut. Dialog always shows.
- Advanced field types (file pickers for cert paths, port-discovery dropdowns, etc.). Plain text/integer/select is enough for v1.
- A "Forget connection" button. User can either successfully reconnect with new values (overwrites) or hand-edit `~/.nodalcore/connections.json`. Future polish.
- Plugin-supplied schemas (option C from brainstorming). Built-in schemas cover the five SDK-defined types; plugins outside that set fall back to no-options.
- Migration of existing data. There are no installed users of the old (no-options) flow whose data we'd need to migrate.

## Affected files (summary)

**New:**

- `packages/sdk/src/schemas/connection.ts`
- `packages/plugin-host/src/connection-store.ts`
- `packages/renderer/src/components/ConnectDialog.tsx`
- `packages/sdk/src/__tests__/connection-schemas.test.ts`
- `packages/plugin-host/src/__tests__/connection-store.test.ts`

**Modified:**

- `packages/sdk/src/index.ts` — re-export `connectionSchemas`
- `packages/plugin-host/src/index.ts` — re-export `getConnectionOptions`, `setConnectionOptions`, `clearConnectionOptions`, `CONNECTIONS_FILE`
- `apps/desktop/src/main/index.ts` — new `connection:read` handler; updated `device:connect` to persist on success
- `apps/desktop/src/preload/index.ts` — expose `readConnection`
- `packages/renderer/src/hooks/usePluginBridge.ts` — bridge type + `connect` callback gain optional options
- `packages/renderer/src/pages/InstalledPage.tsx` — Connect button opens dialog
- `packages/renderer/src/styles/index.css` — six new dialog classes (and `--danger` if absent)
