# Connect dialog (schema-driven, last-used prefill) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A modal dialog that pops on Connect, prefilled with the user's last-used connection options for that plugin, with submitted values flowing into the existing `DevicePlugin.connect(options)` parameter and only persisting after a successful connect.

**Architecture:** Built-in JSONSchema7 per `ConnectionType` shipped from `@nodalcore/sdk`. Host-private store at `~/.nodalcore/connections.json` accessed via a new `connection:read` IPC plus an updated `device:connect` that persists on success. Renderer renders the dialog via the existing RJSF + ajv8 setup that powers `SettingsPanel`. No plugin-side API change.

**Tech Stack:** TypeScript (strict, ESM), React 18, RJSF 5 (already in renderer deps), Electron 34 IPC, vitest (already configured at workspace root from prior work).

**Spec:** `docs/superpowers/specs/2026-05-07-connect-dialog-design.md`

---

## File map

**New files:**

- `packages/sdk/src/schemas/connection.ts` — `connectionSchemas: Record<ConnectionType, JSONSchema7>`
- `packages/sdk/src/__tests__/connection-schemas.test.ts`
- `packages/plugin-host/src/connection-store.ts` — `getConnectionOptions` / `setConnectionOptions` / `clearConnectionOptions`
- `packages/plugin-host/src/__tests__/connection-store.test.ts`
- `packages/renderer/src/components/ConnectDialog.tsx`

**Modified files:**

- `packages/sdk/src/index.ts` — re-export `connectionSchemas`
- `packages/plugin-host/src/index.ts` — re-export the three connection-store functions
- `apps/desktop/src/main/index.ts` — new `connection:read` IPC handler; update `device:connect` to persist on success
- `apps/desktop/src/preload/index.ts` — expose `readConnection`
- `packages/renderer/src/hooks/usePluginBridge.ts` — bridge interface gains `readConnection`; `connect` callback gains optional `options`
- `packages/renderer/src/pages/InstalledPage.tsx` — Connect button opens `ConnectDialog`
- `packages/renderer/src/styles/index.css` — six new `.connect-dialog__*` classes (using existing `--surface`, `--accent`, `--accent-hover`, `--border`, `--text-primary`, `--text-secondary`, `--error`, `--error-bg`, `--error-border` — no new custom properties needed)

---

## Task 1: SDK — built-in connection schemas

**Files:**
- Create: `packages/sdk/src/schemas/connection.ts`
- Create: `packages/sdk/src/__tests__/connection-schemas.test.ts`
- Modify: `packages/sdk/src/index.ts`

Pure data + a couple of structural assertion tests that catch "I forgot to update the schema after a SDK type change" regressions. Tests come first per TDD even though the implementation is mostly a static map.

- [ ] **Step 1: Write the failing tests**

Create `packages/sdk/src/__tests__/connection-schemas.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { connectionSchemas } from '../schemas/connection.js'
import type { ConnectionType } from '../types/manifest.js'

const ALL_TYPES: ConnectionType[] = ['serial', 'usb', 'bluetooth', 'tcp', 'mqtt']

describe('connectionSchemas', () => {
  for (const type of ALL_TYPES) {
    describe(type, () => {
      it('exists in the schema map', () => {
        expect(connectionSchemas[type]).toBeDefined()
      })

      it('declares connectionType as a const matching the map key', () => {
        const schema = connectionSchemas[type]
        const props = (schema.properties ?? {}) as Record<string, { const?: string }>
        expect(props.connectionType?.const).toBe(type)
      })

      it('every required field is declared in properties', () => {
        const schema = connectionSchemas[type]
        const required = schema.required ?? []
        const props = schema.properties ?? {}
        for (const field of required) {
          expect(props).toHaveProperty(field)
        }
      })

      it('is type: object', () => {
        expect(connectionSchemas[type].type).toBe('object')
      })
    })
  }
})

describe('connectionSchemas — TCP shape (sanity)', () => {
  it('requires host and port', () => {
    expect(connectionSchemas.tcp.required).toContain('host')
    expect(connectionSchemas.tcp.required).toContain('port')
  })

  it('defaults host to 127.0.0.1 and port to 5025', () => {
    const props = connectionSchemas.tcp.properties as Record<string, { default?: unknown }>
    expect(props.host?.default).toBe('127.0.0.1')
    expect(props.port?.default).toBe(5025)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:run packages/sdk/src/__tests__/connection-schemas.test.ts`
Expected: FAIL with "Cannot find module '../schemas/connection.js'".

- [ ] **Step 3: Create `packages/sdk/src/schemas/connection.ts`**

```ts
import type { JSONSchema7 } from 'json-schema'
import type { ConnectionType } from '../types/manifest.js'

export const connectionSchemas: Record<ConnectionType, JSONSchema7> = {
  serial: {
    type: 'object',
    required: ['port', 'baudRate'],
    properties: {
      connectionType: { type: 'string', const: 'serial' },
      port: {
        type: 'string',
        title: 'Port',
        description: 'e.g. /dev/ttyUSB0 or COM3',
        default: '',
      },
      baudRate: {
        type: 'integer',
        title: 'Baud rate',
        enum: [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600],
        default: 115200,
      },
      dataBits: { type: 'integer', title: 'Data bits', enum: [5, 6, 7, 8], default: 8 },
      stopBits: { type: 'integer', title: 'Stop bits', enum: [1, 2], default: 1 },
      parity: {
        type: 'string',
        title: 'Parity',
        enum: ['none', 'even', 'odd', 'mark', 'space'],
        default: 'none',
      },
    },
  },

  usb: {
    type: 'object',
    required: ['vendorId', 'productId'],
    properties: {
      connectionType: { type: 'string', const: 'usb' },
      vendorId: {
        type: 'integer',
        title: 'Vendor ID',
        description: '0x… (decimal accepted)',
        minimum: 0,
        maximum: 0xFFFF,
        default: 0,
      },
      productId: {
        type: 'integer',
        title: 'Product ID',
        minimum: 0,
        maximum: 0xFFFF,
        default: 0,
      },
    },
  },

  bluetooth: {
    type: 'object',
    required: ['serviceUUID'],
    properties: {
      connectionType: { type: 'string', const: 'bluetooth' },
      serviceUUID: {
        type: 'string',
        title: 'Service UUID',
        description: 'e.g. 0000180f-0000-1000-8000-00805f9b34fb',
        default: '',
      },
      characteristicUUID: {
        type: 'string',
        title: 'Characteristic UUID (optional)',
        default: '',
      },
    },
  },

  tcp: {
    type: 'object',
    required: ['host', 'port'],
    properties: {
      connectionType: { type: 'string', const: 'tcp' },
      host: {
        type: 'string',
        title: 'Host',
        description: 'IP address or hostname',
        default: '127.0.0.1',
      },
      port: {
        type: 'integer',
        title: 'Port',
        minimum: 1,
        maximum: 65535,
        default: 5025,
      },
    },
  },

  mqtt: {
    type: 'object',
    required: ['brokerUrl', 'topic'],
    properties: {
      connectionType: { type: 'string', const: 'mqtt' },
      brokerUrl: {
        type: 'string',
        title: 'Broker URL',
        description: 'e.g. mqtts://broker.example.com:8883',
        default: '',
      },
      topic: { type: 'string', title: 'Topic', default: '' },
      username: { type: 'string', title: 'Username (optional)', default: '' },
      password: {
        type: 'string',
        title: 'Password (optional)',
        format: 'password',
        default: '',
      },
    },
  },
}
```

- [ ] **Step 4: Re-export from `packages/sdk/src/index.ts`**

Add to the bottom of the file:

```ts
export { connectionSchemas } from './schemas/connection.js'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test:run packages/sdk/src/__tests__/connection-schemas.test.ts`
Expected: PASS — 22 tests (4 per type × 5 types + 2 TCP-specific).

- [ ] **Step 6: Typecheck SDK**

Run: `pnpm --filter @nodalcore/sdk typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/schemas packages/sdk/src/__tests__/connection-schemas.test.ts packages/sdk/src/index.ts
git commit -m "feat(sdk): built-in connection schemas (one JSONSchema7 per ConnectionType)

connectionSchemas[ConnectionType] gives a JSON Schema describing the
parameters DevicePlugin.connect(options) accepts for each underlying
transport. Used by the desktop's Connect dialog to render an RJSF form;
plugins themselves don't need to declare anything new.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: plugin-host — connection store

**Files:**
- Create: `packages/plugin-host/src/connection-store.ts`
- Create: `packages/plugin-host/src/__tests__/connection-store.test.ts`
- Modify: `packages/plugin-host/src/index.ts`

Pure CRUD over `~/.nodalcore/connections.json`. Path is computed lazily (each call resolves `os.homedir()`) so tests can redirect via `$HOME` between cases.

- [ ] **Step 1: Write the failing tests**

Create `packages/plugin-host/src/__tests__/connection-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  getConnectionOptions,
  setConnectionOptions,
  clearConnectionOptions,
} from '../connection-store.js'
import type { TcpConnectionOptions } from '@nodalcore/sdk'

let tempHome: string
let originalHome: string | undefined

beforeEach(() => {
  tempHome = mkdtempSync(path.join(tmpdir(), 'nodalcore-conn-test-'))
  originalHome = process.env.HOME
  process.env.HOME = tempHome
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  rmSync(tempHome, { recursive: true, force: true })
})

const tcp: TcpConnectionOptions = {
  connectionType: 'tcp',
  host: '192.168.1.50',
  port: 5025,
}

describe('connection-store', () => {
  it('set then get round-trips a TcpConnectionOptions', async () => {
    await setConnectionOptions('plug-1', tcp)
    const got = await getConnectionOptions('plug-1', 'tcp')
    expect(got).toEqual(tcp)
  })

  it('get for an unknown pluginId returns null', async () => {
    const got = await getConnectionOptions('does-not-exist', 'tcp')
    expect(got).toBeNull()
  })

  it('get with a mismatched expectedType returns null (manifest-changed guard)', async () => {
    await setConnectionOptions('plug-1', tcp)
    const got = await getConnectionOptions('plug-1', 'serial')
    expect(got).toBeNull()
  })

  it('clear removes the entry', async () => {
    await setConnectionOptions('plug-1', tcp)
    await clearConnectionOptions('plug-1')
    const got = await getConnectionOptions('plug-1', 'tcp')
    expect(got).toBeNull()
  })

  it('set is per-plugin — does not affect other entries', async () => {
    await setConnectionOptions('plug-1', tcp)
    await setConnectionOptions('plug-2', { ...tcp, host: '10.0.0.1' })
    expect(await getConnectionOptions('plug-1', 'tcp')).toEqual(tcp)
    expect(await getConnectionOptions('plug-2', 'tcp')).toEqual({ ...tcp, host: '10.0.0.1' })
  })

  it('returns null when the file is missing', async () => {
    // Fresh temp HOME has no .nodalcore directory yet.
    const got = await getConnectionOptions('plug-1', 'tcp')
    expect(got).toBeNull()
  })

  it('returns null when the file is corrupted', async () => {
    mkdirSync(path.join(tempHome, '.nodalcore'), { recursive: true })
    writeFileSync(path.join(tempHome, '.nodalcore', 'connections.json'), 'not json{', 'utf8')
    const got = await getConnectionOptions('plug-1', 'tcp')
    expect(got).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:run packages/plugin-host/src/__tests__/connection-store.test.ts`
Expected: FAIL with "Cannot find module '../connection-store.js'".

- [ ] **Step 3: Create `packages/plugin-host/src/connection-store.ts`**

```ts
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { ConnectionOptions } from '@nodalcore/sdk'

type ConnectionsStore = Record<string, ConnectionOptions>

// Lazy: each call resolves homedir so tests can redirect via $HOME between cases.
function connectionsFilePath(): string {
  return path.join(os.homedir(), '.nodalcore', 'connections.json')
}

async function readStore(): Promise<ConnectionsStore> {
  try {
    const raw = await fs.readFile(connectionsFilePath(), 'utf8')
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
  const file = connectionsFilePath()
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(store, null, 2), 'utf8')
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
```

- [ ] **Step 4: Re-export from `packages/plugin-host/src/index.ts`**

Add at the bottom of the file:

```ts
export {
  getConnectionOptions,
  setConnectionOptions,
  clearConnectionOptions,
} from './connection-store.js'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test:run packages/plugin-host/src/__tests__/connection-store.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 6: Typecheck plugin-host**

Run: `pnpm --filter @nodalcore/plugin-host typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-host/src/connection-store.ts packages/plugin-host/src/__tests__/connection-store.test.ts packages/plugin-host/src/index.ts
git commit -m "feat(plugin-host): host-private connection-options store

CRUD for ~/.nodalcore/connections.json. The host validates the stored
discriminator against the plugin's manifest connectionType on read so a
stale entry from before a manifest change is treated as 'no value'
rather than handed back wrong. Path is computed lazily so unit tests can
redirect via \$HOME.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Desktop main — `connection:read` IPC + persist on `device:connect` success

**Files:**
- Modify: `apps/desktop/src/main/index.ts`

Add a new IPC handler that reads stored options, and update the existing `device:connect` handler so it persists the options after a successful connect (only on success — bad options never poison the prefill).

- [ ] **Step 1: Add the new imports at the top of `apps/desktop/src/main/index.ts`**

In the existing `import { … } from '@nodalcore/plugin-host'` block, add `getConnectionOptions` and `setConnectionOptions` to the named imports:

```ts
import {
  installPlugin,
  uninstallPlugin,
  listInstalledPlugins,
  loadDevicePlugin,
  unloadDevicePlugin,
  sendToPlugin,
  listLoadedPlugins,
  spawnTool,
  stopTool,
  reconcileRegistry,
  getConfiguration,
  setConfiguration,
  registerHostApiHandlers,
  setWindowMessageEmitter,
  setModalDispatcher,
  listContributions,
  getConnectionOptions,
  setConnectionOptions,
} from '@nodalcore/plugin-host'
```

- [ ] **Step 2: Replace the existing `device:connect` handler to persist on success**

Find the current handler:

```ts
safeHandle('device:connect', 'Connect device', async (_event, pluginId: string, options?: ConnectionOptions) => {
  const proxy = await loadDevicePlugin(pluginId)
  // The renderer doesn't currently surface a connection-options dialog, so
  // `options` is typically undefined here. Pass an empty object through —
  // plugins whose connect() ignores options keep working; plugins that need
  // host/port (e.g. TCP) should read them from ctx.workspace.getConfiguration()
  // until a Configure-and-Connect UI lands.
  await proxy.connect((options ?? {}) as ConnectionOptions)
  return { success: true }
})
```

Replace with:

```ts
safeHandle('device:connect', 'Connect device', async (_event, pluginId: string, options?: ConnectionOptions) => {
  const proxy = await loadDevicePlugin(pluginId)
  await proxy.connect((options ?? {}) as ConnectionOptions)
  // Persist only after a successful connect. Skips persistence when the
  // renderer omitted options (legacy/no-dialog path) so we don't overwrite
  // a good stored value with an empty fallback.
  if (options) await setConnectionOptions(pluginId, options)
  return { success: true }
})
```

- [ ] **Step 3: Add the new `connection:read` handler**

Inside `registerIpcHandlers()`, near the other plugin/connection handlers (after the `device:disconnect` handler is a natural spot), add:

```ts
safeHandle(
  'connection:read',
  'Read stored connection options',
  async (_event, pluginId: string, expectedType: string) => {
    return getConnectionOptions(pluginId, expectedType)
  },
)
```

- [ ] **Step 4: Typecheck and rebuild desktop**

Run: `pnpm --filter @nodalcore/desktop typecheck && pnpm --filter @nodalcore/desktop build`
Expected: no errors; build completes.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/index.ts
git commit -m "feat(desktop): connection:read IPC + persist device:connect options on success

Adds a read-only IPC the renderer uses to prefill the Connect dialog
with last-used options. Updates device:connect to call
setConnectionOptions(pluginId, options) only after proxy.connect()
resolves — a fat-fingered IP that fails to connect never poisons the
saved value.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Preload + bridge

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `packages/renderer/src/hooks/usePluginBridge.ts`

Expose the new IPC, widen the bridge interface, expose a hook callback so consumers go through `usePluginBridge()` rather than reaching for the bare bridge.

- [ ] **Step 1: Add `readConnection` to the preload bridge**

In `apps/desktop/src/preload/index.ts`, inside the `contextBridge.exposeInMainWorld('__nodalcore', { ... })` object, add this entry near `signalReady`:

```ts
  readConnection: (pluginId: string, expectedType: string) =>
    ipcRenderer.invoke('connection:read', pluginId, expectedType),
```

- [ ] **Step 2: Update the `NodalCoreBridge` interface in the renderer hook**

In `packages/renderer/src/hooks/usePluginBridge.ts`, replace the existing `NodalCoreBridge` interface block with:

```ts
import type { ConnectionOptions, PluginManifest, SettingsRecord } from '@nodalcore/sdk'

// (… existing InstalledPluginEntry and HostWindowMessage interfaces unchanged …)

interface NodalCoreBridge {
  listInstalled: () => Promise<InstalledPluginEntry[]>
  install: (idOrUrl: string) => Promise<void>
  uninstall: (id: string) => Promise<void>
  connect: (id: string, options?: ConnectionOptions) => Promise<void>
  disconnect: (id: string) => Promise<void>
  startTool: (id: string) => Promise<void>
  stopTool: (id: string) => Promise<void>
  readSettings: (id: string) => Promise<SettingsRecord>
  writeSettings: (id: string, settings: Partial<SettingsRecord>) => Promise<void>
  onHostMessage?: (handler: (msg: HostWindowMessage) => void) => () => void
  signalReady?: () => Promise<void>
  readConnection?: (id: string, expectedType: string) => Promise<ConnectionOptions | null>
}
```

(`ConnectionOptions` is added to the existing `import type { ... } from '@nodalcore/sdk'` line at the top of the file. If it's not already imported there, add it.)

- [ ] **Step 3: Update the `connect` callback in the hook to take optional options**

In the same file, find the existing `connect` `useCallback`:

```ts
const connect = useCallback(async (id: string) => {
  await bridge.connect(id)
  await refresh()
}, [bridge, refresh])
```

Replace with:

```ts
const connect = useCallback(async (id: string, options?: ConnectionOptions) => {
  await bridge.connect(id, options)
  await refresh()
}, [bridge, refresh])
```

- [ ] **Step 4: Add a `readConnection` callback to the hook**

In the same file, after the `writeSettings` `useCallback`, add:

```ts
const readConnection = useCallback(
  async (id: string, expectedType: string): Promise<ConnectionOptions | null> => {
    if (!bridge.readConnection) return null
    return bridge.readConnection(id, expectedType)
  },
  [bridge],
)
```

Then add `readConnection` to the object the hook returns:

```ts
return {
  installedPlugins,
  installedPluginIds,
  install,
  uninstall,
  connect,
  disconnect,
  startTool,
  stopTool,
  readSettings,
  writeSettings,
  readConnection,
  refresh,
}
```

- [ ] **Step 5: Typecheck and rebuild**

Run: `pnpm typecheck && pnpm --filter @nodalcore/desktop build`
Expected: no errors across the workspace; build completes.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/preload/index.ts packages/renderer/src/hooks/usePluginBridge.ts
git commit -m "feat(renderer): bridge + hook expose readConnection

Adds the readConnection IPC to the preload bridge and widens the
usePluginBridge() hook so consumers go through the hook rather than
reaching for the bare bridge. The connect callback also gains an
optional options arg, threading values from the upcoming dialog through
to device:connect.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: CSS for the dialog

**Files:**
- Modify: `packages/renderer/src/styles/index.css`

Six new classes, all using existing CSS custom properties. No new variables needed — the project already has the full `--error`, `--error-bg`, `--error-border` triplet for the inline-error block.

- [ ] **Step 1: Add the dialog styles at the bottom of `packages/renderer/src/styles/index.css`**

Append:

```css
/* Connect dialog — modal that pops on the Installed-page Connect button. */

.connect-dialog__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.connect-dialog {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1.5rem;
  min-width: 24rem;
  max-width: 32rem;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
}

.connect-dialog__header {
  margin-bottom: 1rem;
}

.connect-dialog__title {
  font-size: 1.1rem;
  margin: 0;
  color: var(--text-primary);
}

.connect-dialog__sub {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin: 0.25rem 0 0;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.connect-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}

.connect-dialog__btn {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  cursor: pointer;
  font-size: 0.9rem;
}

.connect-dialog__btn--submit {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}

.connect-dialog__btn--submit:hover:not(:disabled) {
  background: var(--accent-hover);
}

.connect-dialog__btn--submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.connect-dialog__btn--cancel {
  background: transparent;
  color: var(--text-primary);
}

.connect-dialog__error {
  margin-top: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  background: var(--error-bg);
  color: var(--error);
  border: 1px solid var(--error-border);
  font-size: 0.85rem;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/renderer/src/styles/index.css
git commit -m "style(renderer): connect-dialog styles using existing CSS custom properties

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `ConnectDialog` component

**Files:**
- Create: `packages/renderer/src/components/ConnectDialog.tsx`

No component-level test in v1 (per spec — the renderer has no jsdom/RTL setup; manual smoke covers it).

- [ ] **Step 1: Create `packages/renderer/src/components/ConnectDialog.tsx`**

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
  /** Last-used options, or null if first connect. */
  initialOptions: ConnectionOptions | null
  /** User clicked Connect — parent calls bridge.connect(pluginId, options). */
  onSubmit: (options: ConnectionOptions) => Promise<void>
  /** User clicked Cancel or pressed Esc. */
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

  // Esc closes the dialog; click-outside intentionally does NOT (RJSF text
  // inputs steal focus and we don't want a stray click outside the form
  // discarding the user's edits).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [submitting, onCancel])

  // Initial focus: the first input inside the form.
  const formRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('input, select')?.focus()
  }, [])

  const handleSubmit = useCallback(
    async (data: IChangeEvent<Record<string, unknown>>) => {
      if (!data.formData) return
      // Force the discriminator constant regardless of any stale value in
      // formData (e.g. if a stored entry's connectionType somehow drifted).
      const opts = { ...data.formData, connectionType } as unknown as ConnectionOptions
      setSubmitting(true)
      setError(null)
      try {
        await onSubmit(opts)
        // On success the parent unmounts us; no need to clear submitting.
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

- [ ] **Step 2: Typecheck the renderer**

Run: `pnpm --filter @nodalcore/renderer typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/renderer/src/components/ConnectDialog.tsx
git commit -m "feat(renderer): ConnectDialog component (RJSF, Esc-cancel, inline errors)

Renders a modal driven by connectionSchemas[manifest.connectionType],
prefilled with the parent-provided initialOptions. Submit calls
onSubmit and stays open with an inline error on failure so the user can
edit and retry without losing form state. Esc cancels; outside-click
intentionally doesn't (avoids accidental discard).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: InstalledPage — open the dialog on Connect

**Files:**
- Modify: `packages/renderer/src/pages/InstalledPage.tsx`

Replace the existing direct `connect(entry.manifest.id)` call with a flow that opens `ConnectDialog`, prefilled with whatever the host has stored. Keep the no-options fallback for plugins whose `connectionType` isn't one of the five built-in schemas.

- [ ] **Step 1: Update imports at the top of `packages/renderer/src/pages/InstalledPage.tsx`**

Add (or merge into existing imports):

```tsx
import { useState, useCallback } from 'react'
import { connectionSchemas, type ConnectionOptions, type ConnectionType } from '@nodalcore/sdk'
import { ConnectDialog } from '../components/ConnectDialog.js'
```

(`useState` and `useCallback` may already be imported from `'react'`. If so, add the missing ones to the existing import; don't duplicate.)

- [ ] **Step 2: Pull `readConnection` out of the `usePluginBridge()` destructure**

Find the line (around `:41`):

```tsx
const { installedPlugins, connect, disconnect, startTool, stopTool, writeSettings } = usePluginBridge()
```

Replace with:

```tsx
const { installedPlugins, connect, disconnect, startTool, stopTool, writeSettings, readConnection } = usePluginBridge()
```

- [ ] **Step 3: Add the dialog state and the click handler inside the `InstalledPage` component**

Right after the destructure above, add:

```tsx
const [dialogFor, setDialogFor] = useState<{
  pluginId: string
  pluginName: string
  connectionType: ConnectionType
  initialOptions: ConnectionOptions | null
} | null>(null)

const onConnectClick = useCallback(
  async (entry: { manifest: { id: string; name: string; connectionType?: string } }) => {
    const ct = entry.manifest.connectionType
    if (!ct || !(ct in connectionSchemas)) {
      // Unknown/missing connectionType — fall back to no-options behaviour.
      // Plugins can still log + use defaults inside their connect().
      console.warn(
        `[connect] no built-in schema for connectionType="${ct ?? '<unset>'}" on plugin ${entry.manifest.id}; opening with empty options`,
      )
      await connect(entry.manifest.id)
      return
    }
    const initial = await readConnection(entry.manifest.id, ct)
    setDialogFor({
      pluginId: entry.manifest.id,
      pluginName: entry.manifest.name,
      connectionType: ct as ConnectionType,
      initialOptions: initial,
    })
  },
  [connect, readConnection],
)
```

- [ ] **Step 4: Update the Connect button's onClick**

Find the existing `<button … connect …>Connect</button>` (around `:81-86`). It currently calls `connect(entry.manifest.id)`. Change the onClick:

```tsx
<button
  className="installed-page__btn installed-page__btn--connect"
  onClick={() => onConnectClick(entry)}
>
  Connect
</button>
```

- [ ] **Step 5: Render the dialog at the bottom of the component's JSX**

Just before the closing `</div>` of the outermost wrapper returned by `InstalledPage`, add:

```tsx
{dialogFor && (
  <ConnectDialog
    pluginId={dialogFor.pluginId}
    pluginName={dialogFor.pluginName}
    connectionType={dialogFor.connectionType}
    initialOptions={dialogFor.initialOptions}
    onSubmit={async (options) => {
      await connect(dialogFor.pluginId, options)
      setDialogFor(null)
    }}
    onCancel={() => setDialogFor(null)}
  />
)}
```

- [ ] **Step 6: Typecheck workspace and rebuild**

Run: `pnpm typecheck && pnpm --filter @nodalcore/desktop build`
Expected: no errors; build completes.

- [ ] **Step 7: Run the full test suite**

Run: `pnpm test:run`
Expected: PASS — all prior tests (28) plus the new ones from Tasks 1 and 2 (22 + 7 = 29). Total: 57.

- [ ] **Step 8: Commit**

```bash
git add packages/renderer/src/pages/InstalledPage.tsx
git commit -m "feat(renderer): InstalledPage Connect button opens ConnectDialog

Click Connect → fetch last-used options for the plugin → open the dialog
with those values prefilled (or schema defaults on first connect).
Submit threads options through usePluginBridge().connect(id, options) to
device:connect, which persists them on success. Cancel/Esc closes
without effect. Plugins with an unknown connectionType fall back to the
existing no-options path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: End-to-end smoke test

**Files:** none (manual)

The example device-bridge plugin (`examples/plugin-device-bridge`, manifest id `example-multimeter`, connectionType `serial`) is sufficient — its `connect()` ignores options, but logs them, so we can watch the IPC values appear in the main-process console without real hardware.

- [ ] **Step 1: Build everything and (re)install the example**

```bash
pnpm -r build
node apps/cli/dist/index.js plugin install ./examples/plugin-device-bridge
```

Expected: install succeeds.

- [ ] **Step 2: Start the desktop app**

```bash
pnpm dev
```

Expected: the app window opens, the Installed tab lists `example-multimeter`.

- [ ] **Step 3: First-connect dialog shows schema defaults**

Click **Connect** on the multimeter row.

Expected:
- `ConnectDialog` opens, titled "Connect — Example Multimeter Bridge", subtitle "SERIAL connection".
- Form fields: Port (empty), Baud rate (115200), Data bits (8), Stop bits (1), Parity (none).
- The hidden `connectionType` discriminator is not visible.
- The first input (Port) is focused.

- [ ] **Step 4: Submit succeeds and options reach the plugin**

Type `/dev/ttyUSB0` into Port, leave Baud rate at 115200, click **Connect**.

Expected:
- Button briefly shows "Connecting…".
- Dialog closes.
- The Connect button on the row flips to **Disconnect** (the prior fix in `da0801a` made this work).
- The main-process console (visible in your `pnpm dev` output) prints `[MultimeterPlugin] Connecting via serial... { connectionType: 'serial', port: '/dev/ttyUSB0', baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none' }`.
- A success toast appears (`Multimeter activated (unit: …)` from `activate()`).

- [ ] **Step 5: Disconnect, then reopen — values are prefilled**

Click **Disconnect** on the row. Then click **Connect** again.

Expected:
- Dialog opens with **Port = `/dev/ttyUSB0`** (the value from Step 4).
- All other fields show what was submitted last time.
- Cancel the dialog (click Cancel or press Esc).
- Confirm the Connect button is still "Connect" (no connect happened).

- [ ] **Step 6: Bad-options round-trip (the persist-on-success guard)**

Edit `examples/plugin-device-bridge/src/index.ts`'s `connect()` method temporarily:

```ts
async connect(options: ConnectionOptions): Promise<void> {
  console.log('[MultimeterPlugin] Connecting via serial...', options)
  if ((options as { port?: string }).port === '/dev/bad') {
    throw new Error('simulated bad port')
  }
  this.connected = true
  console.log('[MultimeterPlugin] Connected.')
}
```

Run `pnpm --filter example-multimeter build && node apps/cli/dist/index.js plugin install ./examples/plugin-device-bridge` to reinstall.

In the running app, click Connect, change Port to `/dev/bad`, click Connect.

Expected:
- Dialog stays open with "simulated bad port" in the inline error block.
- A separate error toast also appears via `safeHandle`.
- Click Cancel.
- Click Connect again — Port is still `/dev/ttyUSB0` (the LAST SUCCESSFUL value), NOT `/dev/bad`. The bad value was not persisted.

- [ ] **Step 7: Inspect the on-disk store**

```bash
cat ~/.nodalcore/connections.json
```

Expected: pretty-printed JSON containing one entry under `example-multimeter` with `{ connectionType: 'serial', port: '/dev/ttyUSB0', baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none' }`.

- [ ] **Step 8: Revert the smoke-test changes**

```bash
git checkout examples/plugin-device-bridge/src/index.ts
pnpm --filter example-multimeter build
```

- [ ] **Step 9: Final commit (only if anything other than reverts changed)**

```bash
git status
```

If clean, the smoke test is complete. If something needed fixing during smoke (e.g. a Connect-button styling issue), commit as `fix(renderer): …`.

---

## Notes for the executor

- **Spec divergence on CSS variable names.** The spec mentions `--text` / `--text-muted` / `--danger`. The actual stylesheet uses `--text-primary` / `--text-secondary` / `--error` (with `--error-bg` and `--error-border`). The plan's Task 5 uses the actual names; trust the plan.
- **Connection-store path is lazy.** `connection-store.ts` resolves `os.homedir()` on every call, not once at module load. This is what makes the unit-test `$HOME` fixture work; don't refactor it to a module-level const without also rethinking the test setup.
- **Persist only when `options` is truthy.** The `device:connect` handler intentionally skips `setConnectionOptions(...)` if the renderer didn't pass options (the unknown-connectionType fallback path). This prevents the empty-options call from clobbering a previously-good stored value.
- **The dialog renders inline (no portal).** It's a fixed-position overlay child of the React tree with `z-index: 100`. The Workspace tab's panel webviews use `WebContentsView` which is a native layer above the renderer — but the user can't open a panel from a non-running plugin anyway, so the overlap concern is theoretical.
- **No new dependencies.** RJSF + ajv8 were already in the renderer's deps for `SettingsPanel`. The dialog reuses them.
- **Renderer has no component-test setup.** The plan deliberately doesn't add jsdom + RTL just for `ConnectDialog`. Coverage is via the manual smoke step.
