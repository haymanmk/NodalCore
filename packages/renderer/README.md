# @nodalcore/renderer

React component library shared by the desktop app and the web catalog.
Includes the full UI shell, schema-driven settings forms, panel-launcher
chrome, and the dark-theme CSS.

## Components

### `<App />`

Root component. Renders the nav bar and switches between three tabs:
**Store**, **Installed**, **Workspace**. Mounts the host-message toast,
the contributions provider (themes / sidebar / statusBar / panels), the
theme provider, the theme picker, and the status bar.

### `<StorePage />`

Fetches the plugin registry, renders a searchable grid of `<PluginCard>`
components. Falls back to `mockRegistry.ts` when the live registry is
unreachable.

### `<InstalledPage />`

Lists installed plugins from `usePluginBridge`. Per row: connect /
disconnect (or start / stop for standalone tools), an inline
`<SettingsPanel>` driven by the plugin's `contributes.configuration`,
and a Connect button that opens `<ConnectDialog>` for device-bridge
plugins. Pre-fills the dialog from the connection-options store.

### `<WorkspacePage />`

Third tab. A left-rail of panel-launcher buttons (one per
`contributes.views.panel` slot across installed plugins), and a sized
area whose `ResizeObserver` reports its bounding rect via
`workspace:set-bounds`. Main draws the `WebContentsView` over that
rectangle — the renderer never owns webview pixels.

### `<PluginCard />`

```tsx
<PluginCard
  plugin={registryEntry}
  installed={boolean}
  installing={boolean}
  onInstall={(id) => {}}
  onUninstall={(id) => {}}
/>
```

Renders the plugin icon (with initials fallback), name, description, type
badge, tags, and install count.

### `<SettingsPanel />`

```tsx
<SettingsPanel
  pluginId="com.example.my-sensor"
  schema={configurationToSchema(manifest.contributes.configuration)}
  formData={currentSettings}    // optional — falls back to schema defaults
  onSubmit={(id, settings) => {}}
  onChange={(id, settings) => {}}  // optional live preview
  readOnly={false}
/>
```

Wraps `@rjsf/core`. The schema is built by `InstalledPage` from
`manifest.contributes.configuration` (`{ type: 'object', title,
properties }`); the old top-level `manifest.settingsSchema` field has
been removed. The submit button is replaced by `AppSubmitButton` (a
custom template component) to match the app theme.

### `<ConnectDialog />`

RJSF-driven modal. Picks the JSON Schema for the plugin's
`connectionType` from `connectionSchemas` in `@nodalcore/sdk`, pre-fills
with the last-used `ConnectionOptions` (read via `usePluginBridge`),
and submits to `device:connect`. Esc cancels.

### `<HostMessageToast />`

Subscribes to `__nodalcore.onHostMessage` and surfaces plugin-emitted
`window.showMessage` calls as toasts (info / warning / error). Toasts
queued in main while the window was hidden are flushed here on mount
via the `host:ready` IPC.

### `<StatusBar />`

Renders the status-bar slots aggregated from
`contributes.views.statusBar` across installed plugins. Slots show as
labeled pills sorted by `alignment` + `priority`; rich content rendering
is deferred.

### `<ThemePicker />`

Top-right dropdown listing the active theme plus every
`contributes.themes` entry. Selection is persisted in localStorage and
applied via `ThemeProvider` writing CSS custom properties on
`document.documentElement`.

## Hooks

### `usePluginBridge()`

```ts
const {
  installedPlugins,    // InstalledPluginEntry[]
  installedPluginIds,  // Set<string>
  install, uninstall,
  connect, disconnect,
  startTool, stopTool,
  readConnection,      // last-used ConnectionOptions for a plugin
  readSettings, writeSettings,  // → host configuration store
  refresh,
} = usePluginBridge()
```

Abstracts the Electron `window.__nodalcore` IPC bridge in the desktop app
and returns read-only stubs in the web app. The bridge module also
exports `getNodalCoreBridge()` for non-React callers — used by `<App />`
to fire the `host:ready` IPC on mount.

## Styling

All styles live in `src/styles/index.css`. The file uses CSS custom
properties defined in `:root` — always use variables rather than
hardcoded values:

```css
var(--accent)         /* indigo #6366f1 */
var(--surface)        /* card background */
var(--text-primary)   /* primary text */
var(--success)        /* green status */
var(--error)          /* red status */
```

The CSS is imported as a side effect from `App.tsx` and picked up by Vite
in consuming apps. Theme contributions override these custom properties
via `ThemeProvider`.
