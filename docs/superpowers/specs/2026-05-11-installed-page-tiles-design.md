# Installed Page — Tile Grid + Search

**Status:** Design approved, ready for implementation plan
**Date:** 2026-05-11
**Scope:** Renderer-only UI redesign for the Installed page

## Summary

Replace the single-column list on the Installed page with a responsive tile
grid, add a search box, and move per-plugin settings into a click-to-expand
panel that opens inside the tile. Only one tile is expanded at a time; the
expanded tile spans the full grid row to give the settings form horizontal
space.

No host, main-process, or SDK changes. `ConnectDialog`, `SettingsPanel`,
`PluginSettings`, and `PluginIcon` are reused as-is.

## Goals

- Replace the dense vertical list with a scannable grid as the installed plugin
  count grows.
- Surface a search box so users can find a plugin by name, id, description, or
  connection type.
- Keep all today's metadata (`v{version}`, `Device|Tool`, `connectionType`) and
  status visible without expanding a tile.
- Make settings access a deliberate, focused interaction — one plugin at a
  time — rather than a wall of always-rendered RJSF forms.

## Non-goals

- Per-instance tiles for plugins driving multiple physical devices. (Deferred
  to the upcoming plugin-instances brainstorm.)
- Sort controls, type/status filter chips, bulk actions. Search is the only
  filter affordance in this iteration.
- Changes to `ConnectDialog`, `SettingsPanel`, the host configuration store, or
  any IPC path.

## User flow

1. User opens the Installed tab.
2. They see a grid of tiles. Each tile shows icon, name, version/type/
   connection meta, status pill, and a primary action button
   (`Connect`/`Disconnect` for device-bridge, `Start`/`Stop` for tool).
3. Typing into the search box filters the grid live, matching against name,
   id, description, and the connection-type / type literals.
4. Clicking anywhere on a tile that isn't the action button expands it. The
   tile spans the full row and reveals the existing `SettingsPanel` form.
5. Clicking another tile collapses the first one and expands the second.
   Clicking the expanded tile (outside the action button) collapses it.
6. The action button works without expanding the tile. For device-bridge
   plugins, `Connect` still opens the existing `ConnectDialog` modal to pick
   port/baud — unchanged.

## Layout details

### Grid

- `display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 12px;`
- Tiles are 360px minimum width, expand to fill. At typical desktop widths this
  yields 2–3 columns.
- `align-items: start` so a tall expanded tile doesn't drag siblings down.

### Collapsed tile

Three-column internal layout (`grid-template-columns: 48px 1fr auto`):

- **Icon (48px square, rounded 10px)** — reuses the existing `PluginIcon`
  initials/HSL fallback; if the manifest has an `icon`, that's rendered.
- **Name + meta** — `manifest.name` (semibold) and a one-line meta string
  `v{version} · {Device|Tool}{ · connectionType?}`.
- **Status + action stack** — status pill on top (rounded, color matches the
  existing status), primary action button below.

### Expanded tile

- `grid-column: 1 / -1` so it spans every column in the row regardless of how
  many the viewport fits.
- Visually emphasised with the accent border (same as `--accent` used in other
  hover/selected states).
- Top section reproduces the collapsed-tile content (icon, name+meta,
  status+button stack) so the user keeps the affordances they expect.
- A divider, then a "Settings" small-caps label, then the existing
  `<PluginSettings>` form. RJSF takes the full tile width — comfortable for
  two-column layouts.

### Search

- Plain `<input>` directly above the grid, full-width, placeholder
  `"Search installed…"`.
- State lives in `InstalledPage` (`useState<string>('')`).
- Match logic (case-insensitive):
  - `manifest.name` substring
  - `manifest.id` substring
  - `manifest.description` substring (if present)
  - `manifest.connectionType` substring
  - The literal words `device` / `tool` matched against
    `manifest.type === 'device-bridge' ? 'device' : 'tool'`
- All matchers OR-ed; empty query matches everything.
- When the filter changes and the currently expanded tile is filtered out,
  clear `expandedId` so the UI doesn't carry a hidden expanded state.

### Empty states

- **Truly empty** (no installed plugins): keep the existing
  `installed-page__empty` block ("No plugins installed. Browse the store…").
- **No matches** (search query has no hits): render
  `"No installed plugins match \"{query}\"."` with a `Clear` button that
  resets the search.

## State model

```ts
function InstalledPage() {
  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [formDataById, setFormDataById] = useState<Record<string, SettingsRecord>>({})
  // dialogFor as today
}
```

- `expandedId === entry.manifest.id` controls the expanded look.
- `formDataById` lifts the current settings draft per plugin out of
  `PluginSettings` so collapsing the tile doesn't unmount the form and lose
  edits. `SettingsPanel` already exposes `formData` + `onChange` + `onSubmit`
  props (verified in `packages/renderer/src/components/SettingsPanel.tsx`);
  `PluginSettings` is updated to forward an `onChange` from `InstalledPage`
  alongside the existing `onSubmit`. No SettingsPanel API change.
- Filtered list is derived inside render — no extra state needed.

## Interaction rules

- Click on a tile root → toggle expand for that tile. Click bubbling on the
  action button is stopped via `e.stopPropagation()` in the button handlers.
- `Connect` opens `ConnectDialog` as today; the dialog is independent of the
  expanded/collapsed state of the tile.
- Switching expanded tile collapses the previous one without prompting; the
  user's in-flight form draft for the previous plugin is preserved in
  `formDataById` and re-appears when they expand it again.
- If a plugin is uninstalled while expanded, `expandedId` is cleared via the
  same effect that watches `installedPlugins`.

## Out of scope (recorded so we don't forget)

- Multi-instance tiles (plugin-instances brainstorm).
- Drag-to-reorder, pinning, favorites.
- Plugin-update affordances on the tile.
- Keyboard navigation across the grid (Tab order is browser-default in this
  iteration; arrow-key grid nav is a follow-up).

## Tradeoffs

- **Single-expand**: forfeits side-by-side comparison of two plugins' settings
  to keep the form readable at full row width. Acceptable for current settings
  surface size.
- **OR-ed search across many fields**: typing `serial` will match every plugin
  whose `connectionType` is `serial`, not just plugins with `serial` in the
  name. Treated as a feature — the user thinks in terms of "find anything that
  involves serial".
- **No unsaved-changes prompt**: relies on persisting the draft per plugin
  rather than warning. Risk: user thinks edits were saved when only kept in
  memory. Mitigated by the existing `Apply` button being the only path to
  persistence, which is already true today.

## Files touched

| File | Change |
|---|---|
| `packages/renderer/src/pages/InstalledPage.tsx` | Rewrite render to grid + search + expand state. Lift form data into a `Record<pluginId, SettingsRecord>` map and pass `onChange` into `PluginSettings`. |
| `packages/renderer/src/styles/index.css` | New classes: `installed-page__grid`, `installed-page__search`, `installed-page__tile`, `installed-page__tile--expanded`, `installed-page__pill`, `installed-page__no-match`. Status colors reused. |

No other packages, no tests yet (UI-only and not in the existing test surface).

## Acceptance criteria

1. With ≥ 2 installed plugins, the Installed page renders tiles in a 2+ column
   grid at default window width.
2. Typing in the search box filters in real time; clearing it restores the
   full set.
3. Clicking a tile expands it to full row width and renders the existing
   `SettingsPanel` inside. Clicking another tile collapses the first.
4. The action button (`Connect` / `Disconnect` / `Start` / `Stop`) on a
   collapsed tile fires its handler without expanding the tile.
5. `Connect` on a device-bridge tile still opens `ConnectDialog`.
6. Editing settings in tile A, switching to tile B, then returning to A shows
   the in-flight edits still in the form.
7. Uninstalling a plugin while its tile is expanded does not throw and clears
   the expanded state.

## Implementation order (for the plan)

1. Lift form-data ownership into `InstalledPage` (smallest, lowest-risk
   refactor, keeps current list rendering intact).
2. Add `query` state + filter logic, no UI changes yet.
3. Replace the list rendering with the grid + collapsed-tile markup.
4. Add the search input and "no matches" empty state.
5. Add `expandedId` state + click-to-expand + full-row expanded view.
6. CSS polish pass (pill shape, accent border on expanded, hover, focus
   outlines for keyboard users).
