# Panel webviews

A plugin can contribute one or more **panel webviews** — HTML pages loaded
in a native `WebContentsView` and tiled into the desktop app's Workspace
tab. Webviews are the way plugins ship custom UI; the rest of the
contributes block (themes, statusBar slots) is intentionally minimal.

This document covers the runtime: how the URL gets resolved, what the
webview can call, how messages flow between the webview and the plugin,
and the gotchas plugin authors hit.

For declaration syntax, see
[`plugin-spec.md` § Contributes block](./plugin-spec.md#contributes-block).

## Lifecycle at a glance

```
User opens Workspace tab → clicks a panel entry
   │
   ▼
Renderer: WorkspacePage onSelect(panel)
   │ ipcRenderer.invoke('workspace:show-panel', pluginId, slotId, htmlPath)
   ▼
Main: webviews/manager.showPanel
   │ creates a WebContentsView (per (pluginId, slotId), one-time)
   │ loadURL("nodal-plugin://<pluginId>/<htmlPath>")
   │ adds to BrowserWindow.contentView
   ▼
Renderer: ResizeObserver fires on the workspace area
   │ ipcRenderer.invoke('workspace:set-bounds', {x,y,width,height})
   ▼
Main: manager.setPanelBounds → activeView.setBounds(...)
   │ (native compositor draws view at that rectangle, above the React shell)
   ▼
Webview HTML loads, preload runs first → window.nodalcore.{postMessage,onMessage}
```

When the user switches tabs the Workspace page unmounts; its cleanup
calls `__nodalcore.hidePanel()` and the manager hides the active view.
The view itself isn't destroyed — re-opening reuses it.

When the renderer hot-reloads (in dev), main's `did-finish-load` listener
calls `manager.destroyAll()` so orphaned native views don't accumulate.

## `nodal-plugin://` privileged scheme

Panel HTML and any sibling assets load via:

```
nodal-plugin://<pluginId>/<path-relative-to-plugin-install-dir>
```

Examples:

```
nodal-plugin://com.example.my-sensor/panel/index.html
nodal-plugin://com.example.my-sensor/panel/style.css
nodal-plugin://com.example.my-sensor/assets/needle.svg
```

The scheme is registered as **privileged** (Chromium term) before
`app.whenReady()`:

| Privilege | Effect |
|---|---|
| `standard` | Treated as an opaque-origin scheme; each `<pluginId>` is a distinct origin → cross-plugin storage is naturally partitioned. |
| `secure` | Counts as a secure origin → service workers, modern web APIs, lockdown semantics like a real `https://` page. |
| `supportFetchAPI` | `fetch('nodal-plugin://…/file')` works inside the panel. |
| `corsEnabled: false` | Disables CORS so a panel can read its own files freely. Cross-plugin reads are blocked by origin partitioning, not CORS. |
| `stream` | Large files stream in. |

After `app.whenReady()`, `protocol.handle('nodal-plugin', ...)` resolves
each request:

1. Validate `pluginId` against `^[a-zA-Z0-9._-]+$` (rejects shell-style
   path injection).
2. Compute the requested file path under
   `~/.nodalcore/plugins/<pluginId>/`. Reject if it escapes the plugin
   root via `..`.
3. `fs.realpath` the resolved path. Reject if the symlink target leaves
   the plugin root.
4. Read the file, infer MIME from extension, attach a CSP header to HTML
   responses.

The default Content-Security-Policy:

```
default-src 'self' nodal-plugin://<pluginId>;
script-src  'self' nodal-plugin://<pluginId>;
style-src   'self' 'unsafe-inline' nodal-plugin://<pluginId>;
img-src     'self' nodal-plugin://<pluginId> data:;
font-src    'self' nodal-plugin://<pluginId> data:;
connect-src 'self' nodal-plugin://<pluginId>;
media-src   'self' nodal-plugin://<pluginId>;
frame-ancestors 'none';
form-action 'none';
base-uri 'self';
```

Plugins can extend `connect-src`, `img-src`, etc. via the manifest's
`contributes.views.panel[].csp` block — see [`plugin-spec.md`](./plugin-spec.md#viewspanel).
The host merges those additions; the host-supplied directives are not
overridable.

## What the webview can call

Each panel runs with a **second** preload bundle, separate from the
BrowserWindow's preload. It exposes:

```ts
interface WebviewBridge {
  postMessage(data: unknown): Promise<unknown>
  onMessage(handler: (data: unknown) => void): () => void  // returns unsubscribe
}

// Available as:
window.nodalcore: WebviewBridge
```

That's the entire surface. No Node, no `require`, no direct IPC, no other
host methods. If a panel needs to talk to the host's window/workspace
APIs, it asks its plugin to do it.

```html
<script>
  // Read
  window.nodalcore.onMessage((data) => updateChart(data))

  // Write
  document.querySelector('#refresh').addEventListener('click', async () => {
    const reading = await window.nodalcore.postMessage({ type: 'measure' })
    showReading(reading)
  })
</script>
```

## Message routing

```
                                  (broker)
   ┌─────────────┐              ┌────────────┐              ┌─────────────┐
   │  Webview    │              │    Main    │              │   Plugin    │
   │  (HTML/JS)  │              │  process   │              │   worker    │
   └──────┬──────┘              └─────┬──────┘              └──────┬──────┘
          │                           │                            │
          │ window.nodalcore          │                            │
          │   .postMessage(data)      │                            │
          │ ─────────────────────────▶│                            │
          │ ipcRenderer.invoke(       │ findByWebContents(sender)  │
          │  'webview:msg-to-plugin') │ → (pluginId, slotId)       │
          │                           │ sendToPlugin(id,           │
          │                           │   'views.message',         │
          │                           │   { slotId, data })        │
          │                           │ ─────────────────────────▶ │
          │                           │                            │ ctx.views
          │                           │                            │ .onMessage(
          │                           │                            │   slotId)
          │                           │                            │   handler
          │                           │  return value via response │
          │                           │ ◀───────────────────────── │
          │     resolved value        │                            │
          │ ◀──────────────────────── │                            │

          │                           │  ctx.views.postMessage(    │
          │                           │     slotId, data)          │
          │                           │ ◀───────────────────────── │
          │                           │ broker handler             │
          │                           │  'views.postMessage'       │
          │                           │  → manager.sendToPanel     │
          │                           │  → WebContents.send(       │
          │                           │     'webview:msg-from-     │
          │                           │      plugin', data)        │
          │ webview:msg-from-plugin   │                            │
          │ ◀──────────────────────── │                            │
          │ onMessage handlers fire   │                            │
          │                           │                            │
```

Both directions go through the **broker** — the same one that backs
`host.window.*` and `host.workspace.*`. Method names:

- `views.message` — webview → plugin (host emits, plugin receives)
- `views.postMessage` — plugin → webview (plugin emits, host routes)

This is identical for device-bridge and (one direction of) standalone-tool
plugins.

### What's NOT supported today

- **Webview → standalone-tool**. The gRPC HostAPI is tool → host only;
  there's no reverse channel yet. Calling `window.nodalcore.postMessage`
  from a panel attached to a standalone-tool plugin resolves with `null`.
  Plugin → panel pushes still work via the broker.
- **Automatic replay on visibility change.** If a plugin pushes a value
  while the panel is hidden, the host returns false and the message is
  dropped. The SDK exports `coalesceLastWins` as a plugin-side helper, but
  it's not wired to a "panel visible" event yet. Plugins should re-send
  the latest value on the first message they receive after open, or
  document the staleness semantics for their UI.
- **Modal-overlap choreography.** `WebContentsView` is a native compositor
  layer above the renderer; CSS `z-index` cannot cover it. The Workspace
  area in v1 has no modals or tooltips that overlap a panel, so this is a
  theoretical constraint — but if a future feature drops one in, main
  must hide the active panel via `setVisible(false)` before showing the
  modal, then restore.

## Plugin-side bundling

Webview HTML is just HTML — bundling there is your call (vanilla, lit,
preact, whatever). The **plugin** itself, though, must be bundled
self-contained because the installer doesn't run `npm install`.

Both reference plugins use:

```ts
// tsup.config.ts
export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'dist',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  noExternal: [/.*/],          // inline ALL deps, including @nodalcore/sdk
  banner: {
    js: [
      'import { createRequire as __nodalcoreCreateRequire } from "node:module";',
      'const require = __nodalcoreCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  dts: true,
  clean: true,
})
```

The `createRequire` shim is needed because `@grpc/grpc-js` (a transitive
SDK dep) uses dynamic `require()` internally and esbuild can't statically
resolve those when emitting ESM. With the shim it works at runtime.

Without `noExternal: [/.*/]`, the bundle has bare `import {…} from
'@nodalcore/sdk'` lines that fail at runtime — the installed plugin has
no `node_modules`. This is a real failure mode; see the plan file for the
loader smoke that caught it.

## Caveats and known fragilities

- **Atomic-upgrade race.** The installer atomic-renames on upgrade. If a
  webview is mid-fetch on `nodal-plugin://<id>/...` when the rename
  happens, the read can fail. Mitigation options on the table: require
  webview close before upgrade; resolve protocol paths through a
  snapshotted plugin dir captured at panel-open time. Neither is
  implemented yet.
- **Hot-reload teardown.** Main's `did-finish-load` listener destroys all
  child views on every renderer reload. That's necessary because the
  React shell may recreate the workspace area, leaving native views
  stranded. Side effect: hot-reload during a panel session loses the
  webview's transient state. Persist anything important via
  `ctx.workspace.setConfiguration`.
- **CSP is opinionated.** The default policy disallows inline scripts.
  If your panel needs `'unsafe-inline'` for `<script>` (it almost
  certainly shouldn't), there is no way to widen `script-src` from the
  manifest today — by design. Move scripts into separate `.js` files.
- **One panel visible at a time.** The manager hides the previously
  active view before showing a new one. There is no "split panel" UX
  yet.

## See also

- [`architecture.md`](./architecture.md) — system topology, lifecycle.
- [`host-api.md`](./host-api.md) — `ctx.views` surface in detail, the
  bidirectional contract, error semantics.
- [`examples.md`](./examples.md) — the device-bridge `panel/index.html`
  exercises both directions; the standalone-tool panel demonstrates the
  receive-only path.
