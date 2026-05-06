# Capture checklist for README screenshots

Drop the captured files into this directory using the names below. The
README references each by relative path, so no further edits are needed.

## Tools

- **Stills (Linux):** `gnome-screenshot -w` (window only) or `grim -g "$(slurp)"` on Wayland.
- **GIFs (Linux):** [`peek`](https://github.com/phw/peek) — point-and-record, exports straight to .gif.
- **Trim/optimize gifs:** `gifsicle -O3 in.gif -o out.gif` for size; aim for <2 MB.
- **Resize to README width:** export at ~1280–1600 px wide for retina-friendly rendering.

## Shots

| File                       | Tab         | What to show                                                                                       |
|----------------------------|-------------|----------------------------------------------------------------------------------------------------|
| `hero.png`                 | Workspace   | The most striking shot — Workspace tab with a panel loaded and live data flowing. Used as banner.  |
| `store.png`                | Store       | Grid populated with plugins. Type a query to show the search filter working.                       |
| `workspace.gif`            | Workspace   | 4–6s loop — open the multimeter panel, click "Measure now" a few times. Live readout updates.      |
| `settings.png`             | Installed   | A plugin's settings form (RJSF), with a value being edited and the "Apply" button visible.         |
| `error-toast.png`          | Store       | Try to install a non-existent plugin (e.g. type a bogus URL via CLI or registry override) so the   |
|                            |             | red error toast appears in the bottom-right. Capture the moment the toast is visible.              |

## Reproducing the error toast

The simplest way: temporarily edit `MOCK_REGISTRY` in
`packages/renderer/src/mockRegistry.ts` to add a plugin with a non-existent
git URL, then click Install on it. Revert the change after the screenshot.
