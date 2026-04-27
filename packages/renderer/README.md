# @nodalcore/renderer

React component library shared by the desktop app and the web catalog.
Includes the full UI and the dark theme CSS.

## Components

### `<App />`

Root component. Renders the nav bar with Store / Installed tabs and mounts
the active page.

### `<StorePage />`

Fetches the plugin registry, renders a searchable grid of `<PluginCard>`
components. Falls back to `mockRegistry.ts` when the live registry is
unreachable.

### `<InstalledPage />`

Lists installed plugins from `usePluginBridge`. Shows connect / disconnect
buttons and an inline `<SettingsPanel>` for running plugins.

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
  schema={manifest.settingsSchema}
  formData={currentSettings}         // optional — falls back to schema defaults
  onSubmit={(id, settings) => {}}
  onChange={(id, settings) => {}}    // optional live preview
  readOnly={false}
/>
```

Wraps `@rjsf/core`. The submit button is replaced by `AppSubmitButton` (a
custom template component) to match the app theme.

## Hooks

### `usePluginBridge()`

```ts
const {
  installedPlugins,    // InstalledPluginEntry[]
  installedPluginIds,  // Set<string>
  install, uninstall,
  connect, disconnect,
  readSettings, writeSettings,
  refresh,
} = usePluginBridge()
```

Abstracts the Electron `window.__nodalcore` IPC bridge in the desktop app and
returns read-only stubs in the web app.

## Styling

All styles live in `src/styles/index.css`. The file uses CSS custom properties
defined in `:root` — always use variables rather than hardcoded values:

```css
var(--accent)         /* indigo #6366f1 */
var(--surface)        /* card background */
var(--text-primary)   /* primary text */
var(--success)        /* green status */
var(--error)          /* red status */
```

The CSS is imported as a side effect from `App.tsx` and picked up by Vite
in consuming apps.
