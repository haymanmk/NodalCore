# Installed Page Tiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-column list on the Installed page with a responsive tile grid, add a search box, and move per-plugin settings into a click-to-expand panel that spans the full grid row (single-expand at a time).

**Architecture:** Renderer-only change in `packages/renderer/src/pages/InstalledPage.tsx` plus matching CSS in `packages/renderer/src/styles/index.css`. State is local React state. Form drafts persist across collapse by lifting `formData` out of `PluginSettings` into a `Record<pluginId, SettingsRecord>` map owned by `InstalledPage`. No SDK / host / IPC changes. `ConnectDialog`, `SettingsPanel`, `PluginIcon` reused as-is.

**Tech Stack:** React 18 function components + hooks, CSS custom properties (`--accent`, `--surface`, …), TypeScript strict, RJSF (already integrated).

**Spec reference:** `docs/superpowers/specs/2026-05-11-installed-page-tiles-design.md`

**Verification harness:** The renderer has no test framework, so each task ends with `pnpm typecheck` (must pass) and a brief manual smoke in `pnpm dev` (must render without console errors). Where a task introduces a discrete user-visible behaviour, the smoke step lists what to check.

---

## File Structure

| File | Role | Action |
|---|---|---|
| `packages/renderer/src/pages/InstalledPage.tsx` | All page logic — state, filtering, expand, tile render | Rewrite |
| `packages/renderer/src/styles/index.css` | Installed-page section starting at line 530 | Replace + add new classes |
| `packages/renderer/src/components/SettingsPanel.tsx` | RJSF wrapper | **No change** — already exposes `formData` + `onChange` + `onSubmit` |
| `packages/renderer/src/components/PluginCard.tsx` | Store-page card | **No change** — different page |

`InstalledPage.tsx` ends up a bit longer than today but stays single-file: the page is a single cohesive screen, the per-tile render is a small inline component, and pulling tile rendering into its own file would force prop-drilling for `expandedId`, `setExpandedId`, `formDataById`, `setFormDataById`, `query` — net negative.

---

## Task 1: Lift form-data ownership into InstalledPage

**Goal:** Refactor without changing behaviour. After this task the Installed page renders exactly the same as today, but the RJSF form's working draft for each plugin lives in `InstalledPage` state instead of inside `PluginSettings`. This unlocks Task 4 (collapse-without-losing-edits).

**Files:**
- Modify: `packages/renderer/src/pages/InstalledPage.tsx`

- [ ] **Step 1: Add `formDataById` state to `InstalledPage`**

In `packages/renderer/src/pages/InstalledPage.tsx`, inside the `InstalledPage` component, add at the top alongside the existing `dialogFor` state:

```tsx
const [formDataById, setFormDataById] = useState<Record<string, SettingsRecord>>({})
```

Add `SettingsRecord` to the existing `@nodalcore/sdk` import line if not already present (it already is).

- [ ] **Step 2: Seed `formDataById` from disk on mount and when the installed list changes**

Right after the `formDataById` declaration:

```tsx
useEffect(() => {
  let cancelled = false
  Promise.all(
    installedPlugins.map(async (entry) => {
      const data = await readSettings(entry.manifest.id).catch(() => ({}))
      return [entry.manifest.id, data] as const
    }),
  ).then((pairs) => {
    if (cancelled) return
    setFormDataById((prev) => {
      const next = { ...prev }
      for (const [id, data] of pairs) {
        // Only seed plugins we haven't touched yet — preserve unsaved drafts.
        if (!(id in next)) next[id] = data
      }
      return next
    })
  })
  return () => {
    cancelled = true
  }
}, [installedPlugins, readSettings])
```

- [ ] **Step 3: Replace the existing `PluginSettings` wrapper with an inline render**

Delete the `PluginSettings` component definition (lines 57–91) and its usage. Replace the `<PluginSettings ... />` call inside the map with:

```tsx
<SettingsPanel
  pluginId={entry.manifest.id}
  schema={configurationToSchema(entry.manifest)}
  formData={formDataById[entry.manifest.id]}
  onChange={(id, settings) =>
    setFormDataById((prev) => ({ ...prev, [id]: settings }))
  }
  onSubmit={async (id, settings) => {
    await writeSettings(id, settings)
    setFormDataById((prev) => ({ ...prev, [id]: settings }))
  }}
/>
```

Remove the `PluginSettings`-related imports if any become unused (`useEffect` is still needed for the seeding effect; keep it).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @nodalcore/renderer typecheck`
Expected: PASS — zero errors.

- [ ] **Step 5: Smoke test**

Run: `pnpm dev` (in repo root). In the desktop app, open the Installed tab.
Check: (a) settings forms render with their saved values, (b) editing a field then clicking Apply persists (close + reopen the tab; value sticks), (c) browser DevTools console has no new errors.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/pages/InstalledPage.tsx
git commit -m "$(cat <<'EOF'
refactor(renderer): lift InstalledPage form state into a per-plugin map

Drops the local PluginSettings wrapper component in favour of an
inline SettingsPanel rendered with controlled formData owned by
InstalledPage. Pure refactor — no UI changes. Sets up the upcoming
tile-grid expand/collapse work where the form must survive across
collapse without remounting.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Replace the list with the tile grid (collapsed state only)

**Goal:** Visually replace the `installed-page__list` flex column with a responsive grid of horizontal-row tiles (Layout B from the spec). Settings still render below each tile inline — we don't introduce expand/collapse yet (Task 4). This task is purely visual restructuring + new CSS.

**Files:**
- Modify: `packages/renderer/src/pages/InstalledPage.tsx`
- Modify: `packages/renderer/src/styles/index.css`

- [ ] **Step 1: Add the new CSS for grid + tile**

In `packages/renderer/src/styles/index.css`, locate `.installed-page__list` (around line 570) and **replace it** plus add the new classes. The full new block to drop in (replacing only `.installed-page__list { … }`):

```css
.installed-page__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 12px;
  align-items: start;
}

.installed-page__tile {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  transition: border-color var(--transition), box-shadow var(--transition);
}

.installed-page__tile:hover {
  border-color: var(--border-accent);
}

.installed-page__tile-header {
  display: grid;
  grid-template-columns: 48px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
}

.installed-page__tile-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--surface-raised);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.installed-page__tile-icon img {
  width: 48px;
  height: 48px;
  object-fit: cover;
  display: block;
}

.installed-page__tile-info {
  min-width: 0;
}

.installed-page__tile-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
```

Leave every other `installed-page__*` rule (status pill, buttons, headings, empty state) **untouched** — we'll reuse them.

The existing `.installed-page__list` rule is now gone; verify with `grep -n installed-page__list packages/renderer/src/styles/index.css` after the edit (expect no output).

- [ ] **Step 2: Update `PluginIcon` to size 48 instead of 36**

In `packages/renderer/src/pages/InstalledPage.tsx`, change the `<PluginIcon>` component's image to 48×48:

```tsx
function PluginIcon({ manifest }: { manifest: PluginManifest }) {
  const [err, setErr] = useState(false)
  if (!manifest.icon || err) {
    const initials = manifest.name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase()
    const hue = (manifest.name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) * 37) % 360
    return (
      <div
        className="installed-page__tile-icon"
        style={{ background: `hsl(${hue} 60% 40%)` }}
      >
        {initials}
      </div>
    )
  }
  return (
    <div className="installed-page__tile-icon">
      <img src={manifest.icon} alt="" width={48} height={48} onError={() => setErr(true)} />
    </div>
  )
}
```

Note class name changed from `installed-page__item-icon` to `installed-page__tile-icon`.

- [ ] **Step 3: Rewrite the render markup**

In `packages/renderer/src/pages/InstalledPage.tsx`, replace the return JSX (the part starting `return (` after the `if (installedPlugins.length === 0)` block) with:

```tsx
return (
  <div>
    <div className="installed-page__header-row">
      <h2 className="installed-page__heading">Installed</h2>
      <span className="installed-page__count">{installedPlugins.length} installed</span>
    </div>

    <div className="installed-page__grid">
      {installedPlugins.map((entry) => {
        const isDevice = entry.manifest.type === 'device-bridge'
        const isStopped = entry.status === 'idle' || entry.status === 'error'
        return (
          <div key={entry.manifest.id} className="installed-page__tile">
            <div className="installed-page__tile-header">
              <PluginIcon manifest={entry.manifest} />

              <div className="installed-page__tile-info">
                <div className="installed-page__item-name">{entry.manifest.name}</div>
                <div className="installed-page__item-meta">
                  v{entry.manifest.version} · {isDevice ? 'Device' : 'Tool'}
                  {entry.manifest.connectionType ? ` · ${entry.manifest.connectionType}` : ''}
                </div>
              </div>

              <div className="installed-page__tile-actions">
                <span className={`installed-page__status installed-page__status--${entry.status}`}>
                  <span className="installed-page__status-dot" />
                  {entry.status}
                </span>
                {isDevice ? (
                  isStopped ? (
                    <button
                      className="installed-page__btn installed-page__btn--connect"
                      onClick={() => onConnectClick(entry)}
                    >
                      Connect
                    </button>
                  ) : (
                    <button
                      className="installed-page__btn installed-page__btn--disconnect"
                      onClick={() => disconnect(entry.manifest.id)}
                    >
                      Disconnect
                    </button>
                  )
                ) : isStopped ? (
                  <button
                    className="installed-page__btn installed-page__btn--connect"
                    onClick={() => startTool(entry.manifest.id)}
                  >
                    Start
                  </button>
                ) : (
                  <button
                    className="installed-page__btn installed-page__btn--disconnect"
                    onClick={() => stopTool(entry.manifest.id)}
                  >
                    Stop
                  </button>
                )}
              </div>
            </div>

            <SettingsPanel
              pluginId={entry.manifest.id}
              schema={configurationToSchema(entry.manifest)}
              formData={formDataById[entry.manifest.id]}
              onChange={(id, settings) =>
                setFormDataById((prev) => ({ ...prev, [id]: settings }))
              }
              onSubmit={async (id, settings) => {
                await writeSettings(id, settings)
                setFormDataById((prev) => ({ ...prev, [id]: settings }))
              }}
            />
          </div>
        )
      })}
    </div>

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
  </div>
)
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @nodalcore/renderer typecheck`
Expected: PASS.

- [ ] **Step 5: Smoke test**

Run: `pnpm dev`. With at least one installed plugin:
- Tiles render in a grid (≥ 2 columns at default window width).
- Each tile shows: 48px icon, name, `v… · Device · serial` meta, status pill on top-right, button below it.
- Hover on a tile lights the border accent.
- Settings panels still render under each tile.
- Resize window narrower — grid collapses to 1 column.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/pages/InstalledPage.tsx packages/renderer/src/styles/index.css
git commit -m "$(cat <<'EOF'
feat(renderer): replace Installed list with a responsive tile grid

Switches from a single-column list to a grid of horizontal-row tiles
(icon left, name + version/type/connectionType middle, status pill +
action button stacked right). 360px-min auto-fill so the layout adapts
1→N columns. Settings panels still render under each tile; expand/
collapse and search land in follow-up commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add search bar with multi-field matching + no-match empty state

**Goal:** Add a full-width search input above the grid that filters the rendered tiles in real time on name, id, description, connectionType, and the type literal (`device` / `tool`).

**Files:**
- Modify: `packages/renderer/src/pages/InstalledPage.tsx`
- Modify: `packages/renderer/src/styles/index.css`

- [ ] **Step 1: Add CSS for the search bar and no-match block**

Append to `packages/renderer/src/styles/index.css`, immediately after the new `.installed-page__tile-actions` rule from Task 2:

```css
.installed-page__search {
  width: 100%;
  margin-bottom: 14px;
  padding: 9px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 13px;
  transition: border-color var(--transition);
}

.installed-page__search::placeholder {
  color: var(--text-muted);
}

.installed-page__search:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-light);
}

.installed-page__no-match {
  padding: 60px 20px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}

.installed-page__no-match button {
  margin-left: 10px;
  padding: 5px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background: var(--surface-raised);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
}

.installed-page__no-match button:hover {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}
```

- [ ] **Step 2: Add `query` state and a `matches` helper**

In `packages/renderer/src/pages/InstalledPage.tsx`, alongside the other `useState` calls, add:

```tsx
const [query, setQuery] = useState('')
```

Above the `return`, derive the filtered list:

```tsx
const trimmed = query.trim().toLowerCase()
const visible = trimmed === ''
  ? installedPlugins
  : installedPlugins.filter((entry) => {
      const m = entry.manifest
      const typeWord = m.type === 'device-bridge' ? 'device' : 'tool'
      const haystack = [
        m.name,
        m.id,
        m.description ?? '',
        m.connectionType ?? '',
        typeWord,
      ]
        .join('\n')
        .toLowerCase()
      return haystack.includes(trimmed)
    })
```

- [ ] **Step 3: Render the search input and switch the grid to `visible`**

In the return JSX, insert the search input right after the `installed-page__header-row` div and before the `installed-page__grid` div:

```tsx
<input
  type="text"
  className="installed-page__search"
  placeholder="Search installed…"
  value={query}
  onChange={(e) => setQuery(e.target.value)}
/>
```

Then change `{installedPlugins.map((entry) => {` to `{visible.map((entry) => {`.

- [ ] **Step 4: Add the no-match empty state**

Wrap the `installed-page__grid` div so the no-match message renders when `visible` is empty *but* `installedPlugins` has entries:

```tsx
{visible.length === 0 ? (
  <div className="installed-page__no-match">
    No installed plugins match “{query}”.
    <button onClick={() => setQuery('')}>Clear</button>
  </div>
) : (
  <div className="installed-page__grid">
    {visible.map((entry) => {
      /* …existing tile render unchanged… */
    })}
  </div>
)}
```

Leave the original `if (installedPlugins.length === 0)` early-return at the top of the component untouched — that still handles the truly-empty case before search is even relevant.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @nodalcore/renderer typecheck`
Expected: PASS.

- [ ] **Step 6: Smoke test**

Run: `pnpm dev`. With at least 2 installed plugins:
- Search bar renders above the grid, full-width.
- Typing part of one plugin's name filters the grid.
- Typing `device` shows only device-bridge plugins; `tool` shows only standalone tools.
- Typing `serial` shows only plugins with `connectionType: serial`.
- A query that matches nothing shows the no-match message + Clear button.
- Clicking Clear empties the input and restores all tiles.

- [ ] **Step 7: Commit**

```bash
git add packages/renderer/src/pages/InstalledPage.tsx packages/renderer/src/styles/index.css
git commit -m "$(cat <<'EOF'
feat(renderer): add search bar to Installed page

Adds a full-width search input above the tile grid. Matches case-
insensitive substring against name, id, description, connectionType,
and the literal type word (device/tool). Shows a no-match block
with a Clear button when the query has no hits; the truly-empty
state (no installed plugins at all) is unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Click-to-expand with single-expand state + full-row layout

**Goal:** Make the tile collapsible. Settings panel hides by default; clicking the tile (outside the action button and status pill) expands it. The expanded tile spans `grid-column: 1 / -1` so the form gets full row width. Only one tile can be expanded at a time. Form drafts persist across collapse because `formDataById` already lives in `InstalledPage`.

**Files:**
- Modify: `packages/renderer/src/pages/InstalledPage.tsx`
- Modify: `packages/renderer/src/styles/index.css`

- [ ] **Step 1: Add expanded-tile CSS**

Append to `packages/renderer/src/styles/index.css`, immediately after the `.installed-page__tile:hover` rule:

```css
.installed-page__tile--expanded {
  grid-column: 1 / -1;
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent) inset, var(--shadow-sm);
}

.installed-page__tile--clickable {
  cursor: pointer;
}

.installed-page__tile-divider {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 0;
}
```

- [ ] **Step 2: Add `expandedId` state and click handlers**

In `packages/renderer/src/pages/InstalledPage.tsx`, alongside the other `useState`s:

```tsx
const [expandedId, setExpandedId] = useState<string | null>(null)
```

Add an effect that clears `expandedId` if the expanded plugin is no longer installed *or* is filtered out by the search query. Put this after the `visible` derivation:

```tsx
useEffect(() => {
  if (expandedId && !visible.some((e) => e.manifest.id === expandedId)) {
    setExpandedId(null)
  }
}, [visible, expandedId])
```

- [ ] **Step 3: Make tiles click-to-expand and conditionally render the settings panel**

Update the tile render so:
- The outer `<div className="installed-page__tile">` becomes clickable, with class toggling for expanded state.
- Action buttons and status pill stop click propagation so they don't toggle expand.
- `SettingsPanel` is only rendered when expanded; wrap it in a divider + section.

Replace the per-tile JSX (the body of `visible.map`) with:

```tsx
{visible.map((entry) => {
  const isDevice = entry.manifest.type === 'device-bridge'
  const isStopped = entry.status === 'idle' || entry.status === 'error'
  const isExpanded = expandedId === entry.manifest.id
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  return (
    <div
      key={entry.manifest.id}
      className={
        'installed-page__tile installed-page__tile--clickable' +
        (isExpanded ? ' installed-page__tile--expanded' : '')
      }
      onClick={() =>
        setExpandedId((cur) => (cur === entry.manifest.id ? null : entry.manifest.id))
      }
    >
      <div className="installed-page__tile-header">
        <PluginIcon manifest={entry.manifest} />

        <div className="installed-page__tile-info">
          <div className="installed-page__item-name">{entry.manifest.name}</div>
          <div className="installed-page__item-meta">
            v{entry.manifest.version} · {isDevice ? 'Device' : 'Tool'}
            {entry.manifest.connectionType ? ` · ${entry.manifest.connectionType}` : ''}
          </div>
        </div>

        <div className="installed-page__tile-actions" onClick={stop}>
          <span className={`installed-page__status installed-page__status--${entry.status}`}>
            <span className="installed-page__status-dot" />
            {entry.status}
          </span>
          {isDevice ? (
            isStopped ? (
              <button
                className="installed-page__btn installed-page__btn--connect"
                onClick={(e) => {
                  e.stopPropagation()
                  onConnectClick(entry)
                }}
              >
                Connect
              </button>
            ) : (
              <button
                className="installed-page__btn installed-page__btn--disconnect"
                onClick={(e) => {
                  e.stopPropagation()
                  disconnect(entry.manifest.id)
                }}
              >
                Disconnect
              </button>
            )
          ) : isStopped ? (
            <button
              className="installed-page__btn installed-page__btn--connect"
              onClick={(e) => {
                e.stopPropagation()
                startTool(entry.manifest.id)
              }}
            >
              Start
            </button>
          ) : (
            <button
              className="installed-page__btn installed-page__btn--disconnect"
              onClick={(e) => {
                e.stopPropagation()
                stopTool(entry.manifest.id)
              }}
            >
              Stop
            </button>
          )}
        </div>
      </div>

      {isExpanded && (
        <div onClick={stop}>
          <hr className="installed-page__tile-divider" />
          <SettingsPanel
            pluginId={entry.manifest.id}
            schema={configurationToSchema(entry.manifest)}
            formData={formDataById[entry.manifest.id]}
            onChange={(id, settings) =>
              setFormDataById((prev) => ({ ...prev, [id]: settings }))
            }
            onSubmit={async (id, settings) => {
              await writeSettings(id, settings)
              setFormDataById((prev) => ({ ...prev, [id]: settings }))
            }}
          />
        </div>
      )}
    </div>
  )
})}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @nodalcore/renderer typecheck`
Expected: PASS.

- [ ] **Step 5: Smoke test**

Run: `pnpm dev`. With at least 2 installed plugins:
- Tiles render collapsed by default (no settings form visible).
- Clicking a tile expands it: tile spans the full row, settings render below the header.
- Clicking another tile collapses the first and expands the second.
- Clicking the expanded tile (outside button/pill) collapses it.
- Clicking the action button does **not** toggle expand — it just connects / disconnects / starts / stops.
- Editing a field in tile A, collapsing A by clicking tile B, returning to A — the edit is still there.
- Clicking Apply persists; reopening shows the saved value.
- Typing a search query that excludes the expanded tile collapses it automatically.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/pages/InstalledPage.tsx packages/renderer/src/styles/index.css
git commit -m "$(cat <<'EOF'
feat(renderer): click-to-expand Installed tiles for settings

Collapses settings panels by default. Clicking a tile expands it to
full grid-row width (grid-column: 1 / -1) and renders the existing
SettingsPanel inside. Single-expand: opening tile B collapses tile A.
Form drafts persist across collapse via the per-plugin formDataById
map lifted in Task 1. Filtering the expanded tile out via search
auto-collapses it.

Action buttons and the status pill stopPropagation so they don't
toggle expand.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Polish — focus outlines, accent transitions, dead-CSS cleanup

**Goal:** Final polish pass. Add visible focus ring on the search input and tiles (keyboard users), animate the expand a bit, and delete the now-unused `installed-page__list`/`installed-page__item*` CSS rules that the tile refactor replaced.

**Files:**
- Modify: `packages/renderer/src/styles/index.css`

- [ ] **Step 1: Delete dead CSS rules**

In `packages/renderer/src/styles/index.css`, remove these rules (they are no longer referenced anywhere in `packages/renderer/src/pages/InstalledPage.tsx`):

- `.installed-page__list` (already removed in Task 2 — verify it's gone)
- `.installed-page__item`
- `.installed-page__item:hover`
- `.installed-page__item-header`
- `.installed-page__item-icon`
- `.installed-page__item-icon img`
- `.installed-page__item-info`
- `.installed-page__item-actions`

Keep `.installed-page__item-name` and `.installed-page__item-meta` — these are still used inside the new tile.

After deletion, verify with:

```bash
grep -nE 'installed-page__(list|item-header|item-icon|item-info|item-actions)\b' \
  packages/renderer/src/styles/index.css packages/renderer/src/pages/InstalledPage.tsx
```

Expected: no output.

- [ ] **Step 2: Add focus outline on the tile when keyboard-focused**

Append to `packages/renderer/src/styles/index.css`, after `.installed-page__tile--expanded`:

```css
.installed-page__tile:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-light);
}
```

- [ ] **Step 3: Make tiles keyboard-activatable**

In `packages/renderer/src/pages/InstalledPage.tsx`, add `role="button"`, `tabIndex={0}`, and an `onKeyDown` to the tile `<div>`:

```tsx
<div
  key={entry.manifest.id}
  role="button"
  tabIndex={0}
  className={
    'installed-page__tile installed-page__tile--clickable' +
    (isExpanded ? ' installed-page__tile--expanded' : '')
  }
  onClick={() =>
    setExpandedId((cur) => (cur === entry.manifest.id ? null : entry.manifest.id))
  }
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setExpandedId((cur) => (cur === entry.manifest.id ? null : entry.manifest.id))
    }
  }}
>
```

- [ ] **Step 4: Add a subtle expand transition**

Append to `packages/renderer/src/styles/index.css`, after the new `.installed-page__tile-divider` rule:

```css
.installed-page__tile {
  /* extends the rule from Task 2; CSS allows multiple rules */
  transition:
    border-color var(--transition),
    box-shadow var(--transition),
    grid-column 0s;
}
```

The `grid-column` transition isn't animatable — listing it at `0s` documents intent and silences any future "missing transition" review nits without trying to animate a non-animatable property.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @nodalcore/renderer typecheck`
Expected: PASS.

- [ ] **Step 6: Smoke test**

Run: `pnpm dev`. With at least 2 installed plugins:
- Tab into the search bar — focus ring visible.
- Tab again — focus lands on the first tile with a visible accent ring.
- Press Enter or Space on the focused tile — it expands.
- Press Tab from the expanded tile — focus moves into the form fields.
- Mouse-only: hover lights the border subtly, click expands cleanly.
- DevTools console: no warnings about missing keys, invalid ARIA, etc.

- [ ] **Step 7: Commit**

```bash
git add packages/renderer/src/pages/InstalledPage.tsx packages/renderer/src/styles/index.css
git commit -m "$(cat <<'EOF'
polish(renderer): keyboard activation + focus rings for Installed tiles

Adds role=button, tabIndex, and Enter/Space keyboard activation so
keyboard users can expand tiles. Adds a visible focus ring on the
search bar and tiles. Drops dead .installed-page__list/item-* CSS
rules left over from the pre-tile list layout.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

Run after writing the plan:

- **Spec coverage:** every section in the spec (`docs/superpowers/specs/2026-05-11-installed-page-tiles-design.md`) is covered:
  - Grid + tile layout → Task 2
  - Search across name/id/description/connectionType/type → Task 3
  - Click-to-expand with full-row takeover + single-expand → Task 4
  - Form drafts persist across collapse → Task 1 (state lift) + Task 4 (conditional render keeps state alive via React reconciliation of `formDataById`)
  - No-match empty state → Task 3
  - Auto-collapse on uninstall *or* on filter-out → Task 4 effect
  - Action buttons don't expand the tile → Task 4 stopPropagation
  - `ConnectDialog` unchanged → confirmed; only its callsite is wired the same way
  - Focus outlines / keyboard activation → Task 5
- **Placeholder scan:** no TBD/TODO/"similar to" — every step has full code.
- **Type consistency:** `formDataById: Record<string, SettingsRecord>` defined in Task 1 and used the same way in Tasks 2 and 4. `expandedId: string | null` defined in Task 4 and used consistently. Status values match the existing union `'idle' | 'running' | 'error'`. Class names introduced in Task 2 (`installed-page__tile`, `installed-page__tile-*`) are referenced consistently in Tasks 4 and 5.
