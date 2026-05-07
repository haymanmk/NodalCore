# Background mode + plugin modal API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop app stay alive in a system tray when the window closes, and add two new SDK methods (`window.showWarning`, `window.showModal`) that surface as native dialogs from any plugin.

**Architecture:** Three new modules in `apps/desktop/src/main/` (`tray.ts`, `window-state.ts`, `notifications/{queue,modal}.ts`) plus a `ModalDispatcher` injection seam in `@nodalcore/plugin-host` that mirrors the existing `setWindowMessageEmitter` hook. Backgrounded toasts are queued in-memory and flushed when the renderer signals it has remounted.

**Tech Stack:** Electron 34, TypeScript (strict, ESM), pnpm workspaces, electron-vite, vitest (added in Task 1), tsup (existing).

**Spec:** `docs/superpowers/specs/2026-05-07-background-mode-and-modal-api-design.md`

---

## File map

**New files:**

- `apps/desktop/src/main/tray.ts` — tray icon + menu + unread label
- `apps/desktop/src/main/window-state.ts` — visibility/quit-flag source of truth
- `apps/desktop/src/main/notifications/queue.ts` — backgrounded toast buffer
- `apps/desktop/src/main/notifications/modal.ts` — native dialog dispatcher (serialized)
- `apps/desktop/src/main/assets/tray-icon.ts` — base64 PNG constants for tray icon (placeholder)
- `apps/desktop/scripts/gen-tray-icon.mjs` — one-shot generator for the placeholder PNG bytes
- `apps/desktop/src/main/__tests__/window-state.test.ts`
- `apps/desktop/src/main/__tests__/queue.test.ts`
- `apps/desktop/src/main/__tests__/modal.test.ts`
- `packages/sdk/src/host/__tests__/extension-context.test.ts`
- `packages/plugin-host/src/host-api/__tests__/server.test.ts`
- `vitest.config.ts` (root)

**Modified files:**

- `package.json` (root) — add vitest, add test scripts
- `packages/sdk/src/host/extension-context.ts` — add `showWarning`, `showModal`, `ShowModalOptions`, `ModalButton`
- `packages/sdk/src/host/index.ts` — re-export new types
- `packages/sdk/src/version.ts` — bump `SDK_VERSION` to `0.3.0`
- `packages/sdk/package.json` — bump version to `0.3.0`
- `packages/plugin-host/src/host-api/server.ts` — add ModalDispatcher abstraction + broker handlers
- `packages/plugin-host/src/index.ts` — re-export `setModalDispatcher`, `ModalDispatcher`
- `apps/desktop/src/main/index.ts` — wire tray + state + dispatcher; remove `window-all-closed` quit; add `host:ready` IPC + single-instance lock
- `apps/desktop/src/preload/index.ts` — expose `signalReady()` IPC
- `packages/renderer/src/App.tsx` — call `signalReady()` once on mount
- `packages/renderer/src/hooks/usePluginBridge.ts` — add `signalReady` to bridge type (find this file in Task 12)
- `examples/plugin-device-bridge/nodal.json` — bump `sdkVersion` to `^0.3.0`
- `examples/plugin-standalone-tool/nodal.json` — bump `sdkVersion` to `^0.3.0`
- `docs/host-api.md` — document `showWarning` / `showModal`
- `docs/contributing.md` — add "Background mode (Linux)" subsection

---

## Task 1: Add vitest infrastructure

**Files:**
- Modify: `package.json` (root)
- Create: `vitest.config.ts` (root)

The repo has no test framework today. We add vitest at the workspace root because all new tests are pure-TS modules, and a single root config is simpler than per-package configs for the small surface we're adding. Tests live next to source under `__tests__/` directories.

- [ ] **Step 1: Install vitest at the workspace root**

```bash
pnpm add -Dw vitest @vitest/coverage-v8
```

Expected: `vitest` and `@vitest/coverage-v8` appear in root `devDependencies`.

- [ ] **Step 2: Create `vitest.config.ts` at the repo root**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/**/__tests__/**/*.test.ts',
      'apps/**/__tests__/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**'],
    environment: 'node',
    clearMocks: true,
  },
})
```

- [ ] **Step 3: Add `test` and `test:run` scripts to root `package.json`**

In `package.json`, add inside `"scripts"`:

```json
"test": "vitest",
"test:run": "vitest run"
```

- [ ] **Step 4: Sanity-check by running with no tests yet**

Run: `pnpm test:run`
Expected: `No test files found, exiting with code 1` (or similar) — proves the runner works. We'll fix this with the first real test in Task 3.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "chore: add vitest infrastructure"
```

---

## Task 2: SDK — add `showWarning` / `showModal` types and transport calls

**Files:**
- Modify: `packages/sdk/src/host/extension-context.ts`
- Modify: `packages/sdk/src/host/index.ts`
- Modify: `packages/sdk/src/version.ts`
- Modify: `packages/sdk/package.json`
- Create: `packages/sdk/src/host/__tests__/extension-context.test.ts`

The SDK changes are pure types + thin wrappers around `transport.request(...)`. No host logic. We add tests at the SDK boundary that pass a fake transport and assert the right method/args are sent. This isolates SDK behavior from the host implementation.

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/src/host/__tests__/extension-context.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createExtensionContext } from '../extension-context.js'
import type { Transport } from '../transport.js'

function makeTransport(): { transport: Transport; calls: Array<{ method: string; args: unknown }> } {
  const calls: Array<{ method: string; args: unknown }> = []
  const transport: Transport = {
    request: vi.fn(async (method, args) => {
      calls.push({ method, args })
      // Default: showModal returns 0 (first button) for tests that don't override.
      if (method === 'window.showModal') return 0
      return undefined
    }),
    onRequest: vi.fn(),
  }
  return { transport, calls }
}

describe('createExtensionContext — window.showWarning', () => {
  it('forwards message and detail to the transport', async () => {
    const { transport, calls } = makeTransport()
    const ctx = createExtensionContext(transport, 'plug-1')
    await ctx.window.showWarning('hi', 'details')
    expect(calls).toEqual([{ method: 'window.showWarning', args: { message: 'hi', detail: 'details' } }])
  })

  it('omits detail when not provided', async () => {
    const { transport, calls } = makeTransport()
    const ctx = createExtensionContext(transport, 'plug-1')
    await ctx.window.showWarning('hi')
    expect(calls).toEqual([{ method: 'window.showWarning', args: { message: 'hi', detail: undefined } }])
  })
})

describe('createExtensionContext — window.showModal', () => {
  it('forwards options and resolves with the host-returned button id', async () => {
    const calls: Array<{ method: string; args: unknown }> = []
    const transport: Transport = {
      request: vi.fn(async (method, args) => {
        calls.push({ method, args })
        return 'discard'
      }),
      onRequest: vi.fn(),
    }
    const ctx = createExtensionContext(transport, 'plug-1')
    const result = await ctx.window.showModal({
      type: 'question',
      message: 'Discard?',
      buttons: [
        { id: 'discard', label: 'Discard', default: true },
        { id: 'keep', label: 'Keep', cancel: true },
      ],
    })
    expect(result).toBe('discard')
    expect(calls[0]?.method).toBe('window.showModal')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:run packages/sdk/src/host/__tests__/extension-context.test.ts`
Expected: FAIL with "Property 'showWarning' does not exist on type 'WindowApi'" (TypeScript) or runtime "showWarning is not a function".

- [ ] **Step 3: Add `ShowModalOptions`, `ModalButton`, and the new `WindowApi` methods to `packages/sdk/src/host/extension-context.ts`**

At the top of the file, replace the existing `WindowApi` interface block with:

```ts
export interface WindowApi {
  /** Show a message to the user (toast in the desktop app, log in headless contexts). */
  showMessage(message: string, level?: 'info' | 'warning' | 'error'): Promise<void>
  /**
   * Passive native dialog with a single OK button. Use for "you should look
   * at this" events that are louder than a toast but don't require a
   * decision from the user.
   */
  showWarning(message: string, detail?: string): Promise<void>
  /**
   * Interactive native dialog. Resolves with the id of the button the user
   * clicked, or with the cancel button's id if the user dismissed via Esc /
   * the dialog's close button. If no button has `cancel: true` and the user
   * dismisses, resolves with the id of the first button.
   */
  showModal(options: ShowModalOptions): Promise<string>
}

export interface ShowModalOptions {
  /** Primary headline — short, one line. */
  message: string
  /** Optional second-line body. */
  detail?: string
  /** Native dialog icon. Defaults to 'info'. */
  type?: 'info' | 'warning' | 'error' | 'question'
  /** Buttons, left-to-right. Defaults to a single 'OK' button if omitted or empty. */
  buttons?: ModalButton[]
}

export interface ModalButton {
  /** Stable identifier returned from `showModal`. Never shown to the user. */
  id: string
  /** User-visible button label. */
  label: string
  /** Highlighted as the default action (Enter key). At most one. */
  default?: boolean
  /**
   * Returned when the user presses Esc or closes the dialog.
   * If no button has `cancel: true` and the user dismisses, the promise
   * resolves with the id of the first button.
   */
  cancel?: boolean
}
```

- [ ] **Step 4: Implement the new methods inside `createExtensionContext`'s returned object**

In the same file, replace the existing `window:` block of the returned object (currently containing only `showMessage`) with:

```ts
window: {
  async showMessage(message, level) {
    await transport.request('window.showMessage', { message, level })
  },
  async showWarning(message, detail) {
    await transport.request('window.showWarning', { message, detail })
  },
  async showModal(options) {
    const result = await transport.request('window.showModal', options)
    return result as string
  },
},
```

- [ ] **Step 5: Re-export the new types from `packages/sdk/src/host/index.ts`**

Replace the existing top-of-file export block with:

```ts
export type { Transport, RequestHandler } from './transport.js'
export type {
  ExtensionContext,
  WindowApi,
  WorkspaceApi,
  ViewsApi,
  ViewMessageHandler,
  ShowModalOptions,
  ModalButton,
} from './extension-context.js'
export { createExtensionContext } from './extension-context.js'
export { createIpcTransport } from './ipc-adapter.js'
export { createGrpcTransport } from './grpc-adapter.js'
export { coalesceLastWins } from './coalesce.js'
```

- [ ] **Step 6: Bump SDK_VERSION**

Edit `packages/sdk/src/version.ts`:

```ts
// Must be kept in sync with packages/sdk/package.json on every SDK bump —
// installer.ts compares this against each plugin's manifest sdkVersion range.
export const SDK_VERSION = '0.3.0'
```

- [ ] **Step 7: Bump `packages/sdk/package.json` version**

Change the `"version"` field from `"0.2.0"` to `"0.3.0"`.

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm test:run packages/sdk/src/host/__tests__/extension-context.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 9: Verify SDK still type-checks**

Run: `pnpm --filter @nodalcore/sdk typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/sdk
git commit -m "feat(sdk): add window.showWarning and window.showModal

Adds two new methods to WindowApi:
- showWarning(message, detail?) — passive native dialog
- showModal(options) — interactive, returns the chosen button id

Bumps SDK_VERSION to 0.3.0."
```

---

## Task 3: plugin-host — add `ModalDispatcher` abstraction, broker handlers, default no-op

**Files:**
- Modify: `packages/plugin-host/src/host-api/server.ts`
- Modify: `packages/plugin-host/src/index.ts`
- Create: `packages/plugin-host/src/host-api/__tests__/server.test.ts`

The plugin-host owns the broker registration. We mirror the existing `setWindowMessageEmitter` pattern: a module-level dispatcher slot + a setter + a default no-op implementation. The default's `showModal` returns the cancel button's id (or `'ok'` for empty buttons) so headless/CLI contexts don't deadlock plugins waiting on user input.

- [ ] **Step 1: Write the failing tests**

Create `packages/plugin-host/src/host-api/__tests__/server.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dispatchHostRequest } from '../../broker.js'
import {
  registerHostApiHandlers,
  setModalDispatcher,
  type ModalDispatcher,
} from '../server.js'
import type { ShowModalOptions } from '@nodalcore/sdk'

describe('host-api server — modal handlers', () => {
  beforeEach(() => {
    registerHostApiHandlers()
  })

  it('routes window.showWarning to the dispatcher with pluginId', async () => {
    const showWarning = vi.fn(async () => undefined)
    setModalDispatcher({
      showWarning,
      showModal: async () => 'ok',
    })
    await dispatchHostRequest('plug-1', 'window.showWarning', { message: 'hi', detail: 'd' })
    expect(showWarning).toHaveBeenCalledWith('plug-1', 'hi', 'd')
  })

  it('routes window.showModal to the dispatcher and returns its result', async () => {
    const showModal = vi.fn(async (_pluginId: string, opts: ShowModalOptions) => {
      expect(opts.message).toBe('Pick one')
      return 'discard'
    })
    setModalDispatcher({
      showWarning: async () => undefined,
      showModal,
    })
    const result = await dispatchHostRequest('plug-1', 'window.showModal', {
      message: 'Pick one',
      buttons: [{ id: 'discard', label: 'Discard' }, { id: 'keep', label: 'Keep' }],
    })
    expect(result).toBe('discard')
    expect(showModal).toHaveBeenCalledWith('plug-1', expect.objectContaining({ message: 'Pick one' }))
  })
})

describe('host-api server — default no-op modal dispatcher', () => {
  beforeEach(() => {
    registerHostApiHandlers()
    // Reset to default by re-importing won't work; instead use the exported
    // default explicitly. The cleanest path is to call setModalDispatcher
    // with the known default (re-exported below) before each test.
  })

  it('default showModal returns "ok" when buttons is empty', async () => {
    // Use a dispatcher that mimics the default's behavior.
    setModalDispatcher({
      showWarning: async () => undefined,
      showModal: async (_id, opts) => {
        const buttons = opts.buttons?.length ? opts.buttons : [{ id: 'ok', label: 'OK' }]
        return (buttons.find((b) => b.cancel) ?? buttons[0]!).id
      },
    })
    const result = await dispatchHostRequest('plug-1', 'window.showModal', { message: 'go?' })
    expect(result).toBe('ok')
  })

  it('default showModal returns the cancel button id when present', async () => {
    setModalDispatcher({
      showWarning: async () => undefined,
      showModal: async (_id, opts) => {
        const buttons = opts.buttons?.length ? opts.buttons : [{ id: 'ok', label: 'OK' }]
        return (buttons.find((b) => b.cancel) ?? buttons[0]!).id
      },
    })
    const result = await dispatchHostRequest('plug-1', 'window.showModal', {
      message: 'pick',
      buttons: [
        { id: 'go', label: 'Go', default: true },
        { id: 'no', label: 'No', cancel: true },
      ],
    })
    expect(result).toBe('no')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:run packages/plugin-host/src/host-api/__tests__/server.test.ts`
Expected: FAIL with "setModalDispatcher is not a function" or "Module has no exported member 'setModalDispatcher'".

- [ ] **Step 3: Replace `packages/plugin-host/src/host-api/server.ts` with the new implementation**

Replace the entire file contents with:

```ts
import type { ShowModalOptions } from '@nodalcore/sdk'
import { registerHostHandler } from '../broker.js'
import { getConfiguration, setConfiguration } from '../configuration.js'

export interface WindowMessagePayload {
  message: string
  level?: 'info' | 'warning' | 'error'
}

export type WindowMessageEmitter = (pluginId: string, payload: WindowMessagePayload) => void

export interface ModalDispatcher {
  showWarning(pluginId: string, message: string, detail?: string): Promise<void>
  showModal(pluginId: string, options: ShowModalOptions): Promise<string>
}

let windowMessageEmitter: WindowMessageEmitter = (pluginId, payload) => {
  console.log(`[host.window.showMessage] ${pluginId}: ${payload.message}`)
}

let modalDispatcher: ModalDispatcher = {
  async showWarning(pluginId, message) {
    console.warn(`[host.window.showWarning] ${pluginId}: ${message}`)
  },
  async showModal(pluginId, options) {
    console.warn(`[host.window.showModal] ${pluginId}: ${options.message}`)
    const buttons = options.buttons?.length ? options.buttons : [{ id: 'ok', label: 'OK' }]
    const cancel = buttons.find((b) => b.cancel) ?? buttons[0]!
    return cancel.id
  },
}

/**
 * Hook the desktop shell (or any other UI surface) into `host.window.showMessage`.
 * Call once at host startup; later calls replace the previous emitter.
 */
export function setWindowMessageEmitter(emitter: WindowMessageEmitter): void {
  windowMessageEmitter = emitter
}

/**
 * Hook the desktop shell into `host.window.showWarning` / `host.window.showModal`.
 * The default is a no-op that logs and (for showModal) returns the cancel-button id,
 * so CLI/headless contexts don't deadlock plugins waiting on user input.
 */
export function setModalDispatcher(dispatcher: ModalDispatcher): void {
  modalDispatcher = dispatcher
}

let registered = false

/**
 * Wire the bundled host-API methods (`window.*`, `workspace.*`) into the broker.
 * Idempotent — safe to call from every host entry point that imports the broker.
 */
export function registerHostApiHandlers(): void {
  if (registered) return
  registered = true

  registerHostHandler('window.showMessage', (pluginId, args) => {
    const payload = (args as WindowMessagePayload | undefined) ?? { message: '' }
    windowMessageEmitter(pluginId, payload)
    return null
  })

  registerHostHandler('window.showWarning', (pluginId, args) => {
    const { message, detail } = (args as { message: string; detail?: string } | undefined) ?? {
      message: '',
    }
    return modalDispatcher.showWarning(pluginId, message, detail)
  })

  registerHostHandler('window.showModal', (pluginId, args) => {
    return modalDispatcher.showModal(pluginId, (args as ShowModalOptions) ?? { message: '' })
  })

  registerHostHandler('workspace.getConfiguration', (pluginId) => {
    return getConfiguration(pluginId)
  })

  registerHostHandler('workspace.setConfiguration', (pluginId, args) => {
    return setConfiguration(pluginId, (args as Record<string, unknown>) ?? {})
  })
}
```

- [ ] **Step 4: Re-export the new symbols from `packages/plugin-host/src/index.ts`**

Replace the existing `host-api/server.js` re-export block with:

```ts
export {
  registerHostApiHandlers,
  setWindowMessageEmitter,
  setModalDispatcher,
} from './host-api/server.js'
export type {
  WindowMessageEmitter,
  WindowMessagePayload,
  ModalDispatcher,
} from './host-api/server.js'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test:run packages/plugin-host/src/host-api/__tests__/server.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Verify plugin-host still type-checks**

Run: `pnpm --filter @nodalcore/plugin-host typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-host
git commit -m "feat(plugin-host): add ModalDispatcher seam for window.showWarning/showModal

Mirrors the existing setWindowMessageEmitter hook. Default dispatcher
logs to console and returns the cancel-button id from showModal so
headless contexts don't deadlock plugins waiting on user input."
```

---

## Task 4: Bump example plugin manifests to `^0.3.0`

**Files:**
- Modify: `examples/plugin-device-bridge/nodal.json`
- Modify: `examples/plugin-standalone-tool/nodal.json`

The installer rejects manifests whose `sdkVersion` semver range doesn't satisfy the host's `SDK_VERSION`. Both reference plugins must move in lockstep with the SDK bump or local installs from `examples/` will fail validation.

- [ ] **Step 1: Edit `examples/plugin-device-bridge/nodal.json`**

Change the line `"sdkVersion": "^0.2.0",` to `"sdkVersion": "^0.3.0",`.

- [ ] **Step 2: Edit `examples/plugin-standalone-tool/nodal.json`**

Change the line `"sdkVersion": "^0.2.0",` to `"sdkVersion": "^0.3.0",`.

- [ ] **Step 3: Verify the examples still build**

Run: `pnpm -r --filter './examples/*' build`
Expected: both example plugins build without errors. (They don't use the new APIs yet — this is just a guard against a regression.)

- [ ] **Step 4: Commit**

```bash
git add examples/plugin-device-bridge/nodal.json examples/plugin-standalone-tool/nodal.json
git commit -m "chore(examples): bump sdkVersion to ^0.3.0"
```

---

## Task 5: `apps/desktop/src/main/window-state.ts`

**Files:**
- Create: `apps/desktop/src/main/window-state.ts`
- Create: `apps/desktop/src/main/__tests__/window-state.test.ts`

Pure state module that wraps a `BrowserWindow` reference and the quitting flag. Imports `BrowserWindow` only as a type, so it's testable with a stub object.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/main/__tests__/window-state.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  bindWindow,
  getWindow,
  isWindowVisible,
  showWindow,
  hideWindow,
  beginQuit,
  isQuitting,
} from '../window-state.js'

interface StubWindow {
  isDestroyed: () => boolean
  isVisible: () => boolean
  isMinimized: () => boolean
  show: () => void
  restore: () => void
  focus: () => void
  hide: () => void
}

function makeWindow(overrides: Partial<StubWindow> = {}): StubWindow {
  return {
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    isMinimized: vi.fn(() => false),
    show: vi.fn(),
    restore: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn(),
    ...overrides,
  }
}

describe('window-state', () => {
  beforeEach(() => {
    bindWindow(null as never)
  })

  // NOTE: the `quitting` flag is module-level and there is no resetter
  // (production has no need for one). The `beginQuit + isQuitting` test
  // below is intentionally placed LAST so it doesn't poison earlier tests.
  // If you add new tests, put them before the `beginQuit` test.

  it('isWindowVisible is false when no window is bound', () => {
    expect(isWindowVisible()).toBe(false)
  })

  it('isWindowVisible is true when window is visible and not minimized', () => {
    bindWindow(makeWindow() as never)
    expect(isWindowVisible()).toBe(true)
  })

  it('isWindowVisible is false when window is minimized', () => {
    bindWindow(makeWindow({ isMinimized: () => true }) as never)
    expect(isWindowVisible()).toBe(false)
  })

  it('isWindowVisible is false when window is destroyed', () => {
    bindWindow(makeWindow({ isDestroyed: () => true }) as never)
    expect(isWindowVisible()).toBe(false)
  })

  it('showWindow restores and focuses a hidden window', () => {
    const w = makeWindow({ isVisible: () => false })
    bindWindow(w as never)
    showWindow()
    expect(w.show).toHaveBeenCalled()
    expect(w.focus).toHaveBeenCalled()
  })

  it('showWindow restores a minimized window', () => {
    const w = makeWindow({ isVisible: () => true, isMinimized: () => true })
    bindWindow(w as never)
    showWindow()
    expect(w.restore).toHaveBeenCalled()
    expect(w.focus).toHaveBeenCalled()
  })

  it('hideWindow calls hide on the bound window', () => {
    const w = makeWindow()
    bindWindow(w as never)
    hideWindow()
    expect(w.hide).toHaveBeenCalled()
  })

  it('getWindow returns the bound window', () => {
    const w = makeWindow()
    bindWindow(w as never)
    expect(getWindow()).toBe(w)
  })

  it('beginQuit + isQuitting flips the quit flag', () => {
    expect(isQuitting()).toBe(false)
    beginQuit()
    expect(isQuitting()).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:run apps/desktop/src/main/__tests__/window-state.test.ts`
Expected: FAIL with "Cannot find module '../window-state.js'".

- [ ] **Step 3: Create `apps/desktop/src/main/window-state.ts`**

```ts
import type { BrowserWindow } from 'electron'

let win: BrowserWindow | null = null
let quitting = false

export function bindWindow(w: BrowserWindow | null): void {
  win = w
}

export function getWindow(): BrowserWindow | null {
  return win
}

export function isWindowVisible(): boolean {
  return !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()
}

export function showWindow(): void {
  if (!win || win.isDestroyed()) return
  if (!win.isVisible()) win.show()
  if (win.isMinimized()) win.restore()
  win.focus()
}

export function hideWindow(): void {
  if (!win || win.isDestroyed()) return
  win.hide()
}

/** Set true *before* calling app.quit() so the window's close handler stops intercepting. */
export function beginQuit(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:run apps/desktop/src/main/__tests__/window-state.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/window-state.ts apps/desktop/src/main/__tests__/window-state.test.ts
git commit -m "feat(desktop): add window-state module"
```

---

## Task 6: `apps/desktop/src/main/notifications/queue.ts`

**Files:**
- Create: `apps/desktop/src/main/notifications/queue.ts`
- Create: `apps/desktop/src/main/__tests__/queue.test.ts`

Pure in-memory ring buffer with FIFO drain and a change-listener callback (so the tray can re-render its menu when the unread count changes). Bounded at 200 entries, drop-oldest.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/main/__tests__/queue.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  enqueue,
  drain,
  getQueueLength,
  onQueueChange,
  type QueuedToast,
} from '../notifications/queue.js'

function toast(overrides: Partial<QueuedToast> = {}): QueuedToast {
  return {
    pluginId: 'plug-1',
    message: 'm',
    level: 'info',
    ts: 0,
    ...overrides,
  }
}

describe('notifications/queue', () => {
  beforeEach(() => {
    drain() // clear leftovers from prior tests
  })

  it('enqueue + drain returns FIFO order', () => {
    enqueue(toast({ message: 'a' }))
    enqueue(toast({ message: 'b' }))
    enqueue(toast({ message: 'c' }))
    const out = drain()
    expect(out.map((t) => t.message)).toEqual(['a', 'b', 'c'])
  })

  it('drain empties the queue', () => {
    enqueue(toast())
    drain()
    expect(getQueueLength()).toBe(0)
  })

  it('caps at 200 entries by dropping oldest', () => {
    for (let i = 0; i < 250; i++) enqueue(toast({ message: `m${i}` }))
    expect(getQueueLength()).toBe(200)
    const out = drain()
    expect(out[0]?.message).toBe('m50')
    expect(out[out.length - 1]?.message).toBe('m249')
  })

  it('notifies listeners on enqueue and drain', () => {
    const listener = vi.fn()
    const off = onQueueChange(listener)
    enqueue(toast())
    expect(listener).toHaveBeenCalledTimes(1)
    drain()
    expect(listener).toHaveBeenCalledTimes(2)
    off()
    enqueue(toast())
    expect(listener).toHaveBeenCalledTimes(2) // unsubscribed
  })

  it('getQueueLength reports current size', () => {
    enqueue(toast())
    enqueue(toast())
    expect(getQueueLength()).toBe(2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:run apps/desktop/src/main/__tests__/queue.test.ts`
Expected: FAIL with "Cannot find module '../notifications/queue.js'".

- [ ] **Step 3: Create `apps/desktop/src/main/notifications/queue.ts`**

```ts
export interface QueuedToast {
  pluginId: string
  message: string
  level: 'info' | 'warning' | 'error'
  ts: number
}

const queue: QueuedToast[] = []
const MAX = 200
const listeners = new Set<() => void>()

export function enqueue(t: QueuedToast): void {
  queue.push(t)
  if (queue.length > MAX) queue.splice(0, queue.length - MAX)
  for (const l of listeners) l()
}

export function drain(): QueuedToast[] {
  const out = queue.splice(0, queue.length)
  for (const l of listeners) l()
  return out
}

export function getQueueLength(): number {
  return queue.length
}

export function onQueueChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:run apps/desktop/src/main/__tests__/queue.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/notifications/queue.ts apps/desktop/src/main/__tests__/queue.test.ts
git commit -m "feat(desktop): add backgrounded-toast queue"
```

---

## Task 7: `apps/desktop/src/main/notifications/modal.ts`

**Files:**
- Create: `apps/desktop/src/main/notifications/modal.ts`
- Create: `apps/desktop/src/main/__tests__/modal.test.ts`

Native dialog dispatcher with FIFO serialization. Tests mock the entire `electron` module so they run in a Node-only vitest environment.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/main/__tests__/modal.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

const showMessageBox = vi.fn()

vi.mock('electron', () => ({
  dialog: { showMessageBox: (...args: unknown[]) => showMessageBox(...args) },
}))

vi.mock('../window-state.js', () => ({
  getWindow: () => null,
}))

// Imported AFTER mocks so the module under test sees the stubs.
const { showWarning, showModal } = await import('../notifications/modal.js')

describe('notifications/modal — showWarning', () => {
  beforeEach(() => {
    showMessageBox.mockReset()
  })

  it('passes warning options to dialog.showMessageBox', async () => {
    showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    await showWarning('plug-1', 'Hi', 'detail line')
    expect(showMessageBox).toHaveBeenCalledTimes(1)
    const opts = showMessageBox.mock.calls[0]![0]
    expect(opts).toMatchObject({
      type: 'warning',
      title: 'plug-1',
      message: 'Hi',
      detail: 'detail line',
      buttons: ['OK'],
    })
  })
})

describe('notifications/modal — showModal', () => {
  beforeEach(() => {
    showMessageBox.mockReset()
  })

  it('returns the id of the button at the response index', async () => {
    showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false })
    const result = await showModal('plug-1', {
      message: 'Pick',
      buttons: [
        { id: 'go', label: 'Go' },
        { id: 'no', label: 'No' },
      ],
    })
    expect(result).toBe('no')
  })

  it('defaults to a single OK button when buttons is omitted', async () => {
    showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    const result = await showModal('plug-1', { message: 'Done' })
    expect(result).toBe('ok')
    const opts = showMessageBox.mock.calls[0]![0]
    expect(opts.buttons).toEqual(['OK'])
  })

  it('defaults to a single OK button when buttons is empty array', async () => {
    showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    const result = await showModal('plug-1', { message: 'Done', buttons: [] })
    expect(result).toBe('ok')
  })

  it('sets defaultId from the button marked default', async () => {
    showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    await showModal('plug-1', {
      message: 'Pick',
      buttons: [
        { id: 'go', label: 'Go' },
        { id: 'no', label: 'No', default: true },
      ],
    })
    expect(showMessageBox.mock.calls[0]![0].defaultId).toBe(1)
  })

  it('sets cancelId from the button marked cancel', async () => {
    showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    await showModal('plug-1', {
      message: 'Pick',
      buttons: [
        { id: 'go', label: 'Go' },
        { id: 'no', label: 'No', cancel: true },
      ],
    })
    expect(showMessageBox.mock.calls[0]![0].cancelId).toBe(1)
  })

  it('serializes concurrent calls — second dialog waits for first', async () => {
    let firstResolve!: (v: { response: number; checkboxChecked: boolean }) => void
    let secondResolve!: (v: { response: number; checkboxChecked: boolean }) => void
    showMessageBox
      .mockImplementationOnce(() => new Promise((r) => { firstResolve = r }))
      .mockImplementationOnce(() => new Promise((r) => { secondResolve = r }))

    const p1 = showModal('plug-1', { message: 'first' })
    const p2 = showModal('plug-2', { message: 'second' })

    // Microtask flush — only the first dialog should have started.
    await Promise.resolve()
    await Promise.resolve()
    expect(showMessageBox).toHaveBeenCalledTimes(1)

    firstResolve({ response: 0, checkboxChecked: false })
    await p1
    // After first resolves, the second can proceed.
    await Promise.resolve()
    expect(showMessageBox).toHaveBeenCalledTimes(2)
    secondResolve({ response: 0, checkboxChecked: false })
    await p2
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:run apps/desktop/src/main/__tests__/modal.test.ts`
Expected: FAIL with "Cannot find module '../notifications/modal.js'".

- [ ] **Step 3: Create `apps/desktop/src/main/notifications/modal.ts`**

```ts
import { dialog } from 'electron'
import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import type { ShowModalOptions } from '@nodalcore/sdk'
import { getWindow } from '../window-state.js'

let chain: Promise<unknown> = Promise.resolve()

function showBox(opts: MessageBoxOptions): Promise<MessageBoxReturnValue> {
  const w = getWindow()
  return w ? dialog.showMessageBox(w, opts) : dialog.showMessageBox(opts)
}

export async function showWarning(
  pluginId: string,
  message: string,
  detail?: string,
): Promise<void> {
  const next = chain.then(() =>
    showBox({
      type: 'warning',
      title: pluginId,
      message,
      detail,
      buttons: ['OK'],
      defaultId: 0,
      noLink: true,
    }),
  )
  chain = next.catch(() => {})
  await next
}

export async function showModal(
  pluginId: string,
  options: ShowModalOptions,
): Promise<string> {
  const buttons = options.buttons?.length
    ? options.buttons
    : [{ id: 'ok', label: 'OK', default: true }]

  const labels = buttons.map((b) => b.label)
  const defaultId = Math.max(0, buttons.findIndex((b) => b.default))
  const cancelIdx = buttons.findIndex((b) => b.cancel)
  const cancelId = cancelIdx >= 0 ? cancelIdx : 0

  const next = chain.then(() =>
    showBox({
      type: options.type ?? 'info',
      title: pluginId,
      message: options.message,
      detail: options.detail,
      buttons: labels,
      defaultId,
      cancelId,
      noLink: true,
    }),
  )
  chain = next.catch(() => {})
  const { response } = await next
  return buttons[response]!.id
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:run apps/desktop/src/main/__tests__/modal.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/notifications/modal.ts apps/desktop/src/main/__tests__/modal.test.ts
git commit -m "feat(desktop): add native-dialog modal dispatcher with FIFO serialization"
```

---

## Task 8: Generate placeholder tray-icon PNGs as a base64 module

**Files:**
- Create: `apps/desktop/scripts/gen-tray-icon.mjs`
- Create: `apps/desktop/src/main/assets/tray-icon.ts`

Spec calls for `tray-icon.png` (22×22), `tray-icon@2x.png` (44×44), and a macOS `tray-iconTemplate.png`. To avoid binary asset commits and electron-vite asset-copy config changes for v1, we encode the placeholder PNG bytes as base64 string constants in a TS module and load them via `nativeImage.createFromBuffer(...)` in the next task. Real icon files can replace the constants without changing tray.ts.

The generator script writes the TS module deterministically using only Node's `zlib` and `crypto`. Run it once; both the script and the generated TS module are committed.

- [ ] **Step 1: Create `apps/desktop/scripts/gen-tray-icon.mjs`**

```js
#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

function crcTable() {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c >>> 0
  }
  return table
}
const TABLE = crcTable()
function crc32(buf) {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) crc = TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}
function makeSolidPng(w, h, [r, g, b, a]) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8                    // bit depth 8
  ihdr[9] = 6                    // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const row = Buffer.alloc(1 + w * 4)
  row[0] = 0
  for (let x = 0; x < w; x++) {
    row[1 + x * 4] = r
    row[2 + x * 4] = g
    row[3 + x * 4] = b
    row[4 + x * 4] = a
  }
  const raw = Buffer.alloc(h * row.length)
  for (let y = 0; y < h; y++) row.copy(raw, y * row.length)
  const idat = deflateSync(raw)
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../src/main/assets/tray-icon.ts')
mkdirSync(dirname(out), { recursive: true })

// Placeholder palette: opaque mid-grey for color targets, opaque white for the
// macOS template (Electron uses alpha to drive the tint).
const standard22 = makeSolidPng(22, 22, [102, 102, 102, 255]).toString('base64')
const standard44 = makeSolidPng(44, 44, [102, 102, 102, 255]).toString('base64')
const template22 = makeSolidPng(22, 22, [255, 255, 255, 255]).toString('base64')

const banner = `// Generated by apps/desktop/scripts/gen-tray-icon.mjs — placeholder tray icons.
// Replace this module (or swap to real PNG files + electron-vite asset copy) when
// real iconography is ready. tray.ts loads these via nativeImage.createFromBuffer.\n\n`

const body = [
  `export const TRAY_ICON_PNG_BASE64 = '${standard22}'`,
  `export const TRAY_ICON_2X_PNG_BASE64 = '${standard44}'`,
  `export const TRAY_ICON_TEMPLATE_PNG_BASE64 = '${template22}'`,
].join('\n') + '\n'

writeFileSync(out, banner + body)
console.log(`Wrote ${out}`)
```

- [ ] **Step 2: Run the generator**

Run: `node apps/desktop/scripts/gen-tray-icon.mjs`
Expected: console output `Wrote .../apps/desktop/src/main/assets/tray-icon.ts`. The file exists and contains three `export const` lines with non-empty base64 strings.

- [ ] **Step 3: Sanity-check the generated PNG bytes are valid**

Run:
```bash
node -e "const m = await import('./apps/desktop/src/main/assets/tray-icon.ts').catch(() => null); const b = Buffer.from(require('./apps/desktop/src/main/assets/tray-icon.ts'.replace('.ts','.ts')) || '', 'base64'); console.log('skip — see step 4')"
```

Skip — TypeScript modules can't be `require`'d directly. Instead verify the base64 decodes to a PNG signature:

```bash
node -e "
const fs = require('node:fs')
const text = fs.readFileSync('apps/desktop/src/main/assets/tray-icon.ts', 'utf8')
const b64 = text.match(/TRAY_ICON_PNG_BASE64 = '([^']+)'/)[1]
const bytes = Buffer.from(b64, 'base64')
console.log('first 8 bytes (hex):', bytes.slice(0, 8).toString('hex'))
console.log('length:', bytes.length)
"
```

Expected: first 8 bytes are `89504e470d0a1a0a` (PNG signature), length is at least 100.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/scripts/gen-tray-icon.mjs apps/desktop/src/main/assets/tray-icon.ts
git commit -m "chore(desktop): generate placeholder tray-icon assets as base64 module"
```

---

## Task 9: `apps/desktop/src/main/tray.ts`

**Files:**
- Create: `apps/desktop/src/main/tray.ts`

The tray module is integration-only (Electron `Tray` doesn't unit-test cleanly), so we don't write unit tests for it. The end-to-end smoke in Task 13 verifies it.

- [ ] **Step 1: Create `apps/desktop/src/main/tray.ts`**

```ts
import { Tray, Menu, app, nativeImage } from 'electron'
import { showWindow, beginQuit } from './window-state.js'
import { getQueueLength, onQueueChange } from './notifications/queue.js'
import {
  TRAY_ICON_PNG_BASE64,
  TRAY_ICON_2X_PNG_BASE64,
  TRAY_ICON_TEMPLATE_PNG_BASE64,
} from './assets/tray-icon.js'

let tray: Tray | null = null

export function createTray(): void {
  if (tray) return

  const icon = process.platform === 'darwin'
    ? nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_TEMPLATE_PNG_BASE64, 'base64'))
    : nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG_BASE64, 'base64'))

  if (process.platform === 'darwin') {
    icon.setTemplateImage(true)
  } else {
    // Add @2x representation for HiDPI displays on Linux/Win.
    icon.addRepresentation({
      scaleFactor: 2,
      buffer: Buffer.from(TRAY_ICON_2X_PNG_BASE64, 'base64'),
    })
  }

  tray = new Tray(icon)
  tray.setToolTip('NodalCore')
  rebuildMenu()
  tray.on('click', showWindow)
  onQueueChange(rebuildMenu)
}

function rebuildMenu(): void {
  if (!tray) return
  const unread = getQueueLength()
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: unread > 0 ? `Open NodalCore (${unread} unread)` : 'Open NodalCore',
        click: showWindow,
      },
      { type: 'separator' },
      {
        label: 'Quit NodalCore',
        click: () => {
          beginQuit()
          app.quit()
        },
      },
    ]),
  )
  tray.setToolTip(unread > 0 ? `NodalCore — ${unread} unread` : 'NodalCore')
  if (process.platform === 'darwin') tray.setTitle(unread > 0 ? '•' : '')
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
```

- [ ] **Step 2: Verify desktop main still type-checks**

Run: `pnpm --filter @nodalcore/desktop typecheck`
Expected: no errors. (Note: tray.ts is referenced from index.ts only after Task 10, so this check confirms tray.ts is internally well-formed.)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/tray.ts
git commit -m "feat(desktop): add system tray with Open/Quit menu and unread label"
```

---

## Task 10: Wire the new modules into `apps/desktop/src/main/index.ts`

**Files:**
- Modify: `apps/desktop/src/main/index.ts`

This is the integration task. We:

1. Bind the window into `window-state` so other modules can find it.
2. Intercept the window's `close` event — hide instead of destroy unless `isQuitting()` is true.
3. Replace the `setWindowMessageEmitter` callback with a visibility-aware one that enqueues when hidden.
4. Register `setModalDispatcher(...)` so plugin `showWarning`/`showModal` calls become native dialogs.
5. Create the tray.
6. Remove the `app.on('window-all-closed', ...)` quit-on-non-darwin block.
7. Add a `host:ready` IPC handler that drains the queue back to the renderer.
8. Acquire the single-instance lock so a second `nodalcore` invocation just re-shows the existing window.

- [ ] **Step 1: Add the new imports at the top of `apps/desktop/src/main/index.ts`**

After the existing `import { registerWebviewRouting } from './webviews/routing.js'` line, add:

```ts
import { createTray } from './tray.js'
import {
  bindWindow,
  isWindowVisible,
  isQuitting,
  showWindow,
  beginQuit,
} from './window-state.js'
import { enqueue, drain } from './notifications/queue.js'
import { showWarning, showModal } from './notifications/modal.js'
```

And update the existing `import { ... } from '@nodalcore/plugin-host'` block to add `setModalDispatcher`:

```ts
import {
  installPlugin,
  uninstallPlugin,
  listInstalledPlugins,
  loadDevicePlugin,
  unloadDevicePlugin,
  sendToPlugin,
  spawnTool,
  stopTool,
  reconcileRegistry,
  getConfiguration,
  setConfiguration,
  registerHostApiHandlers,
  setWindowMessageEmitter,
  setModalDispatcher,
  listContributions,
} from '@nodalcore/plugin-host'
```

- [ ] **Step 2: Acquire the single-instance lock before `app.whenReady()`**

Right after the `registerSchemePrivileges()` call (and before `let mainWindow ...`), add:

```ts
// Single-instance: a second invocation of `nodalcore` while the app is
// running in the tray should just re-show the existing window, not start
// a second process.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showWindow()
  })
}
```

- [ ] **Step 3: Bind the window and intercept `close` in `createWindow()`**

Replace the existing `createWindow()` function body with:

```ts
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  bindWindow(mainWindow)
  setParentWindow(mainWindow)

  mainWindow.on('close', (e) => {
    if (!isQuitting()) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    bindWindow(null)
    mainWindow = null
  })
}
```

- [ ] **Step 4: Replace the `setWindowMessageEmitter` callback with a visibility-aware one and register the modal dispatcher**

Inside `app.whenReady().then(() => { ... })`, replace the existing `setWindowMessageEmitter(...)` call with:

```ts
  setWindowMessageEmitter((pluginId, payload) => {
    if (isWindowVisible()) {
      mainWindow?.webContents.send('host:window:showMessage', { pluginId, ...payload })
    } else {
      enqueue({
        pluginId,
        message: payload.message,
        level: payload.level ?? 'info',
        ts: Date.now(),
      })
    }
  })

  setModalDispatcher({ showWarning, showModal })
```

- [ ] **Step 5: Create the tray inside `app.whenReady()`**

After the existing `createWindow()` call inside `app.whenReady().then(...)`, add:

```ts
  createTray()
```

- [ ] **Step 6: Remove the `window-all-closed` quit block**

Delete the entire block:

```ts
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

The tray "Quit" item is the only exit path now (and `beginQuit()` is called there before `app.quit()` so the close handler stops intercepting).

- [ ] **Step 7: Add the `host:ready` IPC handler at the bottom of `registerIpcHandlers()`**

Inside `registerIpcHandlers()`, after the last `safeHandle(...)` block, add:

```ts
  // Renderer signals it has mounted; drain any toasts that were emitted while
  // the window was hidden and re-emit them so HostMessageToast can render them.
  ipcMain.handle('host:ready', () => {
    for (const t of drain()) {
      mainWindow?.webContents.send('host:window:showMessage', {
        pluginId: t.pluginId,
        message: t.message,
        level: t.level,
      })
    }
  })
```

- [ ] **Step 8: Verify desktop main still type-checks**

Run: `pnpm --filter @nodalcore/desktop typecheck`
Expected: no errors.

- [ ] **Step 9: Build the desktop app to confirm the bundle works**

Run: `pnpm --filter @nodalcore/desktop build`
Expected: build succeeds, no missing-import errors.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src/main/index.ts
git commit -m "feat(desktop): wire tray + visibility-aware toast queue + modal dispatcher

- Close [X] hides to tray; tray Quit is the only exit path.
- Backgrounded toasts queue until renderer signals host:ready, then flush.
- Plugin showWarning/showModal calls route to native dialogs.
- Single-instance lock so re-launching nodalcore re-shows the window."
```

---

## Task 11: Renderer signals `host:ready` after mount

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `packages/renderer/src/hooks/usePluginBridge.ts`
- Modify: `packages/renderer/src/App.tsx`

The renderer needs to tell main "I'm mounted, send me anything you queued." We expose a new `signalReady()` IPC on the bridge and call it once from `App.tsx` in a top-level `useEffect`. This also covers the case where the user re-shows the window — the renderer doesn't unmount on hide, but on hot-reload during dev or after a relaunch from `second-instance`, the renderer remounts and re-signals.

- [ ] **Step 1: Add `signalReady` to the preload bridge**

In `apps/desktop/src/preload/index.ts`, inside the `contextBridge.exposeInMainWorld('__nodalcore', { ... })` object, add a new entry near the bottom (right after `setWorkspaceBounds`):

```ts
  signalReady: () => ipcRenderer.invoke('host:ready'),
```

- [ ] **Step 2: Add `signalReady` to the `NodalCoreBridge` interface**

In `packages/renderer/src/hooks/usePluginBridge.ts`, locate the `interface NodalCoreBridge { ... }` block (around line 24). Add `signalReady` as the last entry, alongside `onHostMessage` (also optional, matching the existing pattern):

```ts
interface NodalCoreBridge {
  listInstalled: () => Promise<InstalledPluginEntry[]>
  install: (idOrUrl: string) => Promise<void>
  uninstall: (id: string) => Promise<void>
  connect: (id: string) => Promise<void>
  disconnect: (id: string) => Promise<void>
  startTool: (id: string) => Promise<void>
  stopTool: (id: string) => Promise<void>
  readSettings: (id: string) => Promise<SettingsRecord>
  writeSettings: (id: string, settings: Partial<SettingsRecord>) => Promise<void>
  onHostMessage?: (handler: (msg: HostWindowMessage) => void) => () => void
  signalReady?: () => Promise<void>
}
```

The web fallback (`getBridge()`'s `return { ... }`) intentionally omits `signalReady` — the optional `?` covers it.

- [ ] **Step 3: Call `signalReady` once from `App.tsx`**

In `packages/renderer/src/App.tsx`, add an import for the bridge accessor at the top (it's exported from `usePluginBridge.ts` as `getNodalCoreBridge` per `HostMessageToast.tsx`):

```tsx
import { useEffect } from 'react'
import { getNodalCoreBridge } from './hooks/usePluginBridge.js'
```

(If `useState` is already imported from `'react'`, merge: `import { useEffect, useState } from 'react'`.)

Inside the `App()` function body, before the `return`, add:

```tsx
  useEffect(() => {
    getNodalCoreBridge().signalReady?.()
  }, [])
```

- [ ] **Step 4: Verify renderer + desktop type-check**

Run: `pnpm typecheck`
Expected: no errors across the workspace.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/preload/index.ts packages/renderer/src/hooks/usePluginBridge.ts packages/renderer/src/App.tsx
git commit -m "feat(renderer): signal host:ready on mount to flush queued toasts"
```

---

## Task 12: Documentation

**Files:**
- Modify: `docs/host-api.md`
- Modify: `docs/contributing.md`

- [ ] **Step 1: Document the new methods in `docs/host-api.md`**

Open `docs/host-api.md` and locate the section that documents `window.showMessage`. Right after that subsection, add a new subsection:

````markdown
### `window.showWarning(message, detail?)`

Passive native dialog with a single OK button. Use for "you should look at
this" events that are louder than a toast but don't require a decision from
the user. Works regardless of whether the desktop window is visible.

```ts
await ctx.window.showWarning(
  'Multimeter disconnected',
  'The serial port closed unexpectedly. Reconnect from the Devices tab.',
)
```

In CLI / headless contexts the default dispatcher logs via `console.warn` and
returns immediately.

### `window.showModal(options): Promise<string>`

Interactive native dialog. Resolves with the `id` of the button the user
clicked, or with the `cancel`-marked button's id if the user dismissed via
Esc / the dialog's close button. If no button has `cancel: true` and the
user dismisses, resolves with the id of the first button.

```ts
const choice = await ctx.window.showModal({
  type: 'question',
  message: 'Discard 4 unsaved readings?',
  detail: 'This will clear the buffer for the current session.',
  buttons: [
    { id: 'discard', label: 'Discard', default: true },
    { id: 'keep',    label: 'Keep',    cancel: true },
  ],
})

if (choice === 'discard') { /* ... */ }
```

`buttons` is optional. Omitting it (or passing an empty array) defaults to a
single OK button — `await ctx.window.showModal({ message: 'Done.' })` resolves
to `'ok'`.

Concurrent calls from any plugin are serialized FIFO so dialogs don't
interleave.

In CLI / headless contexts the default dispatcher logs and returns the
`cancel`-marked button's id (or `'ok'` for empty buttons), so plugins
awaiting user input don't deadlock.
````

- [ ] **Step 2: Add a "Background mode (Linux)" subsection to `docs/contributing.md`**

Open `docs/contributing.md` and append (after the existing "Validation before reporting work as done" section, or wherever platform notes feel natural):

```markdown
## Background mode (Linux)

The desktop app stays alive in the system tray when the user closes the
window. On Linux, Electron's `Tray` requires `libappindicator3-1` (or
`libayatana-appindicator3-1` on newer distros). On GNOME without the
AppIndicator extension installed, the tray icon is invisible — the process
keeps running but the user has no UI affordance.

The app registers a single-instance lock as a fallback: re-running
`nodalcore` from the terminal while it is running in the background calls
the `'second-instance'` handler, which re-shows the main window. Document
this to users on tray-less Linux sessions.

To fully exit the app, use the tray menu's "Quit NodalCore" item — closing
the window only hides it.
```

- [ ] **Step 3: Commit**

```bash
git add docs/host-api.md docs/contributing.md
git commit -m "docs: window.showWarning/showModal + Linux background-mode note"
```

---

## Task 13: End-to-end smoke test

**Files:** none (manual)

This is a manual integration check — Electron `Tray`, `dialog.showMessageBox`, and the close-to-tray flow can't be unit-tested cleanly. We exercise both example plugins in the running app.

- [ ] **Step 1: Build everything and install both example plugins**

```bash
pnpm -r build
node apps/cli/dist/index.js plugin install ./examples/plugin-device-bridge
node apps/cli/dist/index.js plugin install ./examples/plugin-standalone-tool
```

Expected: both installs succeed (the manifest sdkVersion bump from Task 4 must satisfy the new `SDK_VERSION = '0.3.0'` from Task 2).

- [ ] **Step 2: Add a temporary `showWarning` and `showModal` call to the device-bridge example**

Open `examples/plugin-device-bridge/src/index.ts`. Find the `activate(ctx)` function. Add at the start of its body (or just after any existing setup):

```ts
  setTimeout(async () => {
    await ctx.window.showWarning(
      'Smoke test warning',
      'This dialog is here only for end-to-end verification — remove before merging.',
    )
    const result = await ctx.window.showModal({
      type: 'question',
      message: 'Smoke test modal',
      detail: 'Pick a button. The result will be logged to the host console.',
      buttons: [
        { id: 'a', label: 'Option A', default: true },
        { id: 'b', label: 'Option B' },
        { id: 'cancel', label: 'Cancel', cancel: true },
      ],
    })
    console.log('[smoke] showModal result:', result)
  }, 2000)
```

Rebuild only this plugin: `pnpm --filter example-multimeter build` (verify the package name with `cat examples/plugin-device-bridge/package.json | grep name`).

- [ ] **Step 3: Reinstall the plugin so the dist changes land in `~/.nodalcore/plugins/`**

```bash
node apps/cli/dist/index.js plugin install ./examples/plugin-device-bridge
```

- [ ] **Step 4: Launch the desktop app and connect the device-bridge plugin**

```bash
pnpm dev
```

In the running app: open the Installed tab, click Connect on the multimeter plugin. After ~2 seconds, a warning dialog appears, then a question dialog with three buttons. Click each in turn:

- Click the X / press Esc on the modal → host console prints `[smoke] showModal result: cancel`.
- Reconnect, click "Option A" → console prints `result: a`.
- Reconnect, click "Option B" → console prints `result: b`.

- [ ] **Step 5: Verify backgrounded-toast queue + flush**

With the plugin still connected, close the window via [X]. The process must NOT exit:

```bash
ps -ef | grep -i nodalcore | grep -v grep
```

Expected: at least one Electron process is still running.

From a terminal, write a small one-shot script that simulates a backgrounded toast — easiest path is to invoke `ctx.window.showMessage('queued while hidden', 'info')` from the plugin on a timer. (Alternatively, add a `setInterval(() => ctx.window.showMessage(...), 5000)` in the plugin source for the smoke test.)

Wait long enough for several toasts to be emitted. Re-launch `nodalcore` from the terminal:

```bash
nodalcore  # or whatever launcher path
```

Expected: the existing window comes back to the foreground (single-instance handler), and within ~1 second after mount the queued toasts flush in as a batch in the bottom-right toast area.

- [ ] **Step 6: Verify Quit actually quits**

Right-click the tray icon → "Quit NodalCore". The window closes and the process exits:

```bash
ps -ef | grep -i nodalcore | grep -v grep
```

Expected: no NodalCore process.

- [ ] **Step 7: Revert the smoke-test changes to the example plugin**

```bash
git checkout examples/plugin-device-bridge/src/index.ts
pnpm --filter example-multimeter build
```

- [ ] **Step 8: Final commit (only if any non-revert changes were captured)**

```bash
git status
```

If there are no uncommitted changes, the smoke test is complete. If something needed to be fixed during smoke (e.g. a path bug in the wire-up), commit the fix as `fix(desktop): ...`.

---

## Notes for the executor

- **Test runner is new.** The repo had no test framework before Task 1. If you encounter a test-tooling failure, suspect the Task 1 setup before suspecting the test bodies.
- **Electron is mocked in unit tests.** `notifications/modal.ts` imports `electron`, but the test file mocks it via `vi.mock('electron', ...)` so vitest can run in plain Node without an Electron runtime.
- **Don't forget the SDK lockstep.** If you bump `packages/sdk/package.json` without bumping `packages/sdk/src/version.ts` (or vice versa), the installer will silently let mismatched plugin manifests through. Both are touched in Task 2; confirm both before committing.
- **The placeholder tray icon is a flat grey square.** That's intentional for v1 — the spec calls for swap-friendly placeholder iconography. Real artwork lands in a follow-up.
- **The renderer's bridge type lives in `usePluginBridge.ts` (per the file map).** If `grep` in Task 11 step 2 surfaces it elsewhere, follow the actual path; the file map is a starting point, not a contract.
