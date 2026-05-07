# Background mode + plugin modal API — design

**Status:** approved (brainstormed 2026-05-07)
**Owner:** desktop / plugin-host
**Affects:** `apps/desktop`, `packages/sdk`, `packages/plugin-host`

## Problem

Today the desktop app quits when the last window closes (on Linux/Windows), which kills every running plugin — including device-bridges that the user expected to keep streaming. There is also no way for a plugin to grab the user's attention with anything stronger than a transient toast (`ctx.window.showMessage`), and toasts emitted while the app is hidden go nowhere.

We want:

1. The app to stay alive in the background (system tray) when the user closes the window, so plugins keep running.
2. A way to surface important information when the app is backgrounded.
3. A new plugin-facing modal API so plugins can call out to the user with both passive ("look at this") and interactive ("which button?") prompts.

## Decisions (set during brainstorming)

| Question | Decision |
|---|---|
| Primary background scenario | Devices keep running; alert on important events |
| Plugin modal API shape | Two methods: passive `showWarning` + interactive `showModal` |
| Modal surface | Always native dialog (`dialog.showMessageBox`) — works in both states |
| Window [X] button behavior | Always hides to tray; "Quit" only via tray menu |
| Backgrounded toast policy | Queue silently, flush as toasts when window reopens |

## Architecture

Three connected concerns, each in its own file under `apps/desktop/src/main/`.

```
apps/desktop/src/main/
  tray.ts             ← new: tray icon + menu (Open / Quit), unread label
  window-state.ts     ← new: hide-vs-quit policy, isWindowVisible(), one source of truth
  notifications/
    queue.ts          ← new: in-memory toast queue while window is hidden
    modal.ts          ← new: native dialog dispatcher (serializes concurrent modals)
  index.ts            ← updated: wire tray + state machine; remove window-all-closed quit
```

Plus matching changes in `packages/plugin-host` to register two new broker handlers (`window.showWarning`, `window.showModal`) and expose a `setModalDispatcher(...)` hook so the desktop shell can plug in the dialog implementation. Headless / CLI contexts get a default no-op dispatcher.

The existing `setWindowMessageEmitter` becomes visibility-aware:

- Window visible → forward to renderer toast as today.
- Window hidden → enqueue to `notifications/queue`.
- On `host:ready` IPC from the renderer (sent in a renderer `useEffect`), `index.ts` drains the queue and re-emits each item as a `host:window:showMessage` IPC. Existing `HostMessageToast` renders them with no changes.

## SDK API additions

In `packages/sdk/src/host/extension-context.ts`:

```ts
export interface WindowApi {
  // existing — unchanged
  showMessage(message: string, level?: 'info' | 'warning' | 'error'): Promise<void>

  // new — passive native dialog, fire-and-forget
  showWarning(message: string, detail?: string): Promise<void>

  // new — interactive native dialog, returns the chosen button's id
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

`createExtensionContext` adds two new transport requests (`window.showWarning`, `window.showModal`). The same broker routes them on the host side; standalone-tool plugins get the identical surface for free via the gRPC adapter.

`SDK_VERSION` bumps `0.2.0` → `0.3.0` (additive minor — older hosts can't satisfy the new methods). Reference plugins update their `manifest.sdkVersion` to `^0.3.0`.

### Example plugin usage

```ts
// Passive — louder than a toast, but no decision required.
await ctx.window.showWarning(
  'Multimeter disconnected',
  'The serial port closed unexpectedly. Reconnect from the Devices tab.',
)

// Interactive — wait for the user.
const choice = await ctx.window.showModal({
  type: 'question',
  message: 'Discard 4 unsaved readings?',
  detail: 'This will clear the buffer for the current session.',
  buttons: [
    { id: 'discard', label: 'Discard', default: true },
    { id: 'keep',    label: 'Keep',    cancel: true },
  ],
})

// Simple acknowledge — defaults to a single 'OK' button.
await ctx.window.showModal({ message: 'Calibration complete.' })
```

### API design notes

- `showModal` returns a `string` (the button id), not an index, so button order can change without breaking plugin code.
- `buttons` is optional; an omitted/empty array defaults to `[{ id: 'ok', label: 'OK', default: true }]`. Lets plugins call `showModal({ message: 'Done.' })` for a simple acknowledge.

## Host implementation

### `window-state.ts` — single source of truth for visibility

```ts
import type { BrowserWindow } from 'electron'

let win: BrowserWindow | null = null
let quitting = false

export function bindWindow(w: BrowserWindow): void { win = w }
export function getWindow(): BrowserWindow | null { return win }
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

/** Set true *before* calling app.quit() so the close handler stops intercepting. */
export function beginQuit(): void { quitting = true }
export function isQuitting(): boolean { return quitting }
```

The window's `'close'` handler in `index.ts`:

```ts
mainWindow.on('close', (e) => {
  if (!isQuitting()) { e.preventDefault(); mainWindow?.hide() }
})
```

The `app.on('window-all-closed')` quit-on-non-darwin block is removed. The tray "Quit" item is the only path to exit.

### `tray.ts` — tray icon + menu + unread label

```ts
import { Tray, Menu, app, nativeImage } from 'electron'
import path from 'node:path'
import { showWindow, beginQuit } from './window-state.js'
import { getQueueLength, onQueueChange } from './notifications/queue.js'

let tray: Tray | null = null

export function createTray(): void {
  const iconPath = path.join(__dirname, '../assets/tray-icon.png')
  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip('NodalCore')
  rebuildMenu()
  tray.on('click', showWindow)
  onQueueChange(rebuildMenu)
}

function rebuildMenu(): void {
  if (!tray) return
  const unread = getQueueLength()
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: unread > 0 ? `Open NodalCore (${unread} unread)` : 'Open NodalCore',
      click: showWindow,
    },
    { type: 'separator' },
    { label: 'Quit NodalCore', click: () => { beginQuit(); app.quit() } },
  ]))
  tray.setToolTip(unread > 0 ? `NodalCore — ${unread} unread` : 'NodalCore')
  if (process.platform === 'darwin') tray.setTitle(unread > 0 ? '•' : '')
}

export function destroyTray(): void { tray?.destroy(); tray = null }
```

The unread count surfaces in three places: the tray's menu-item label, the tooltip, and (macOS only) a `•` next to the icon. Cross-platform OS-level badges aren't worth the per-DE complexity in v1.

### `notifications/queue.ts` — backgrounded toast buffer

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
  if (queue.length > MAX) queue.splice(0, queue.length - MAX)   // drop oldest
  listeners.forEach((l) => l())
}

export function drain(): QueuedToast[] {
  const out = queue.splice(0, queue.length)
  listeners.forEach((l) => l())
  return out
}

export function getQueueLength(): number { return queue.length }
export function onQueueChange(fn: () => void): () => void {
  listeners.add(fn); return () => listeners.delete(fn)
}
```

Bounded at 200; drop-oldest because the newest signals are the most actionable. Crash → queue lost (acceptable for transient operational messages).

### `notifications/modal.ts` — native dialog dispatcher with serialization

```ts
import { dialog } from 'electron'
import type { ShowModalOptions } from '@nodalcore/sdk'
import { getWindow } from '../window-state.js'

let chain: Promise<unknown> = Promise.resolve()

function showBox(opts: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const w = getWindow()
  return w ? dialog.showMessageBox(w, opts) : dialog.showMessageBox(opts)
}

export async function showWarning(
  pluginId: string, message: string, detail?: string,
): Promise<void> {
  const next = chain.then(() => showBox({
    type: 'warning',
    title: pluginId,
    message,
    detail,
    buttons: ['OK'],
    defaultId: 0,
    noLink: true,
  }))
  chain = next.catch(() => {})
  await next
}

export async function showModal(
  pluginId: string, options: ShowModalOptions,
): Promise<string> {
  const buttons = options.buttons?.length
    ? options.buttons
    : [{ id: 'ok', label: 'OK', default: true }]

  const labels = buttons.map((b) => b.label)
  const defaultId = Math.max(0, buttons.findIndex((b) => b.default))
  const cancelIdx = buttons.findIndex((b) => b.cancel)
  const cancelId  = cancelIdx >= 0 ? cancelIdx : 0

  const next = chain.then(() => showBox({
    type: options.type ?? 'info',
    title: pluginId,
    message: options.message,
    detail: options.detail,
    buttons: labels,
    defaultId,
    cancelId,
    noLink: true,
  }))
  chain = next.catch(() => {})
  const { response } = await next
  return buttons[response]!.id
}
```

Three points worth flagging:

- **Serialization via `chain`** — both methods enqueue onto a single promise chain so two plugins racing into `showModal` get sequenced (FIFO), not interleaved. The `.catch(() => {})` on the chain stub prevents one rejected dialog from breaking the chain.
- **`getWindow() ?? undefined`** — when the window is hidden, Electron still accepts a parented dialog (it just shows top-level). When the window doesn't exist yet (rare race during startup) the dialog appears as system-modal. Either way it's reachable.
- **`title: pluginId`** — the dialog title is the only attribution surface. We can swap to a friendlier display name from the manifest later.

### Wiring in `index.ts`

```ts
import { createTray } from './tray.js'
import { bindWindow, isWindowVisible, isQuitting } from './window-state.js'
import { enqueue, drain } from './notifications/queue.js'
import { showWarning, showModal } from './notifications/modal.js'
import { setWindowMessageEmitter, setModalDispatcher } from '@nodalcore/plugin-host'

function createWindow() {
  mainWindow = new BrowserWindow({ /* ... unchanged ... */ })
  bindWindow(mainWindow)
  mainWindow.on('close', (e) => {
    if (!isQuitting()) { e.preventDefault(); mainWindow?.hide() }
  })
  // ... rest unchanged
}

app.whenReady().then(() => {
  // ... existing setup ...
  setWindowMessageEmitter((pluginId, payload) => {
    if (isWindowVisible()) {
      mainWindow?.webContents.send('host:window:showMessage', { pluginId, ...payload })
    } else {
      enqueue({ pluginId, message: payload.message, level: payload.level ?? 'info', ts: Date.now() })
    }
  })
  setModalDispatcher({ showWarning, showModal })
  createTray()
  createWindow()
})

// REMOVED: app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

ipcMain.handle('host:ready', () => {
  for (const t of drain()) {
    mainWindow?.webContents.send('host:window:showMessage', {
      pluginId: t.pluginId, message: t.message, level: t.level,
    })
  }
})
```

### `plugin-host` changes

- `host-api/server.ts` adds `registerHostHandler('window.showWarning', ...)` and `registerHostHandler('window.showModal', ...)` that delegate to a `ModalDispatcher` injected via a new exported `setModalDispatcher(...)`.
- A default no-op dispatcher logs `console.warn` and (for `showModal`) returns the cancel button's id, so CLI/headless contexts don't crash plugins that call modal APIs.

```ts
// packages/plugin-host/src/host-api/server.ts (additions)
export interface ModalDispatcher {
  showWarning(pluginId: string, message: string, detail?: string): Promise<void>
  showModal(pluginId: string, options: ShowModalOptions): Promise<string>
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

export function setModalDispatcher(d: ModalDispatcher): void { modalDispatcher = d }

// inside registerHostApiHandlers():
registerHostHandler('window.showWarning', (pluginId, args) => {
  const { message, detail } = (args as { message: string; detail?: string }) ?? { message: '' }
  return modalDispatcher.showWarning(pluginId, message, detail)
})

registerHostHandler('window.showModal', (pluginId, args) => {
  return modalDispatcher.showModal(pluginId, args as ShowModalOptions)
})
```

## Assets

- `apps/desktop/assets/tray-icon.png` — 22×22 baseline + `tray-icon@2x.png` 44×44 HiDPI.
- `apps/desktop/assets/tray-iconTemplate.png` — macOS template variant (monochrome alpha-only, OS auto-tints for light/dark menu bars).
- electron-vite asset-copy config extended to land `assets/` under `out/main/assets/`.
- v1 uses a placeholder solid-color glyph. Final iconography swaps in without code change.

## Configuration

No new user-facing settings in v1. Behavior is fixed:

- Close [X] always hides to tray.
- Tray "Quit" is the only exit path.
- Backgrounded toasts queued (cap 200, drop-oldest), flushed on `host:ready`.

If we later want a "Quit on close" preference, it slots into a new host-level preferences module reading/writing `~/.nodalcore/preferences.json`. Out of scope here.

## Platform notes

- **macOS** — standard model; this design just makes Linux/Windows match. Drop the `window-all-closed → quit` block so closing the last window on macOS doesn't need the activate-handler dance to re-create the window — the existing window is hidden and re-shown.
- **Linux tray** — Electron's `Tray` requires `libappindicator3-1` (or `libayatana-appindicator3-1`). On GNOME without the AppIndicator extension, the tray icon is invisible. Documented in `docs/contributing.md` under a new "Background mode (Linux)" subsection. As a fallback, register a single-instance lock via `app.requestSingleInstanceLock()` so re-launching `nodalcore` while it's running calls our `'second-instance'` handler, which calls `showWindow()`. The user can `nodalcore` from the terminal to bring the window back even on a tray-less Linux session.
- **Windows** — tray works out of the box. Close-to-tray matches Slack / Discord / Teams.

## Non-goals

Explicitly out of scope for this spec:

- Auto-start on login (`app.setLoginItemSettings`) — trivial to add later.
- Per-plugin "do not disturb" / silencing. Tray queue is global.
- A panel/window listing queued messages. They flush as toasts; if scrollback is needed, that's a follow-up.
- Rich-content modals (HTML, custom buttons, inline form inputs). Native dialog only — plugins needing forms use a panel webview.
- Auto-promotion of error-level toasts to modals when backgrounded. Plugins that want attention while backgrounded must call `showWarning` / `showModal` explicitly.
- Persisting the queue across host restarts. Crash → queue lost (transient operational messages, not durable signals).

## Testing

- `notifications/queue.ts` — pure module; unit tests for cap behavior, FIFO drain, listener notifications.
- `notifications/modal.ts` — serialization is testable by stubbing `dialog.showMessageBox` to return after a delay and asserting the second call doesn't start until the first resolves. Unit-test the buttons-default fallback and the cancel-id fallback.
- `window-state.ts` — pure helpers around a `BrowserWindow` interface; minimal tests with a stub window.
- `tray.ts` — integration-tested by hand (Electron `Tray` doesn't unit-test cleanly).
- `plugin-host` default `ModalDispatcher` — unit test that `showModal` with no buttons returns `'ok'`, and that an explicit cancel button is returned on dismiss.
- End-to-end smoke test: launch desktop, install device-bridge example, close window, observe process still alive (`ps`), tray icon present (Linux: only with AppIndicator), call `ctx.window.showWarning` and `ctx.window.showModal` from the example plugin and confirm a native dialog appears in both visible and hidden states.

## Affected files (summary)

**New:**

- `apps/desktop/src/main/tray.ts`
- `apps/desktop/src/main/window-state.ts`
- `apps/desktop/src/main/notifications/queue.ts`
- `apps/desktop/src/main/notifications/modal.ts`
- `apps/desktop/assets/tray-icon.png` (+ `@2x` + `Template` variants)
- Tests under `apps/desktop/src/main/__tests__/` and `packages/plugin-host/src/host-api/__tests__/`.

**Modified:**

- `apps/desktop/src/main/index.ts` — wire tray + state machine, queue/flush, modal dispatcher; remove `window-all-closed` quit; add `host:ready` IPC handler.
- `apps/desktop/electron.vite.config.ts` — asset copy for `assets/` (if not already covered).
- `apps/desktop/src/preload/index.ts` — expose `host:ready` IPC and ensure `host:window:showMessage` listener is unchanged.
- `packages/renderer/src/...` — emit `host:ready` once in a top-level `useEffect` after mount.
- `packages/sdk/src/host/extension-context.ts` — add `showWarning`, `showModal`, `ShowModalOptions`, `ModalButton`.
- `packages/sdk/src/version.ts` — bump `SDK_VERSION` to `0.3.0`.
- `packages/sdk/package.json` — version `0.3.0`.
- `packages/plugin-host/src/host-api/server.ts` — new broker handlers + `setModalDispatcher` + default no-op dispatcher.
- `packages/plugin-host/src/index.ts` — re-export `setModalDispatcher` and the `ModalDispatcher` type.
- `examples/plugin-device-bridge/nodal.json` and `examples/plugin-standalone-tool/nodal.json` — bump `sdkVersion` to `^0.3.0`.
- `docs/host-api.md` — document the new `WindowApi` methods.
- `docs/contributing.md` — add a "Background mode (Linux)" subsection.
