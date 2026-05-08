# Connect-dialog polish — design

**Date:** 2026-05-08
**Status:** Approved (visual companion validated)
**Scope:** `packages/renderer/src/components/ConnectDialog.tsx` + `packages/renderer/src/styles/index.css` (`.connect-dialog__*` block)

## Why

The dialog that opens from the Installed page's Connect button is functional but visually
unfinished compared to the surrounding app. RJSF inputs render with browser defaults
(white boxes inside a dark dialog), the header has no anchor, the submit button lacks the
gradient/glow treatment used elsewhere, and there is no entrance animation or backdrop blur.

## What changes

Refinement, not redesign. Component API is unchanged (`pluginId`, `pluginName`, `connectionType`,
`initialOptions`, `onSubmit`, `onCancel`).

### Markup additions in `ConnectDialog.tsx`
- Close `×` button in the top-right (calls `onCancel`).
- Header band: a 44px initials disc reusing the `PluginIcon` color-from-name pattern,
  next to a small uppercase eyebrow ("Connect device" / "Connect tool"), the plugin name
  as the title, and a connection-type pill with an indigo accent dot.
- Field descriptions surface from the JSON schema's `description` field (RJSF already
  renders these — we just style them).

### CSS replacements in `.connect-dialog__*`
- **Backdrop** — `backdrop-filter: blur(6px) saturate(115%)` over a darker, slightly bluish
  overlay; subtle fade-in.
- **Card** — `--surface` with a soft top-radial accent tint; thicker `--border-strong`
  border; gradient hairline at the top edge (indigo → violet); deeper shadow with an
  inset highlight; entrance animation (180ms fade + 6px slide + tiny scale).
- **Header** — bottom-bordered band; icon + eyebrow + title + pill layout.
- **Form fields** — extend the `.settings-panel` input/select treatment to RJSF inputs
  inside the dialog (focus ring with `--accent-glow`, custom select chevron). Labels in
  the same secondary-text style. Hint text uses `--text-muted`.
- **Footer** — top-bordered, subtle bottom gradient, gradient submit button with hover
  glow that mirrors the brand-logo treatment.
- **Error** — left accent bar in `--error`, monospace for the error string.

## Out of scope
- No new dependencies.
- No changes to the connection schemas or to `InstalledPage.tsx` other than what's
  already wired.
- No structural changes to RJSF's rendered hierarchy.

## Verification
After implementation, run the renderer type-check, then start the desktop dev server and
open the Installed page in a Playwright-driven browser. Install one device-bridge example
(`example-multimeter`) if not already installed, click Connect, and screenshot the dialog
to confirm the polish landed as designed.
