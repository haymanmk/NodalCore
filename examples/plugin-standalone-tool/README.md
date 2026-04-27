# Example: standalone-tool plugin

A minimal reference implementation of a **standalone-tool** plugin for
NodalCore. Simulates an image processor that communicates with the host over
a local port.

## What it demonstrates

- Correct `nodal.json` structure for a standalone tool
- Printing `NODALCORE_READY <port>` on stdout to signal readiness
- Settings schema for a tool (no `connectionType` required)

## Files

```
nodal.json      Plugin manifest (id, schema, permissions)
bin/tool.js     Executable entry point
```

## Settings schema

| Field | Type | Default |
|---|---|---|
| `outputFormat` | `enum` (png / jpeg / webp) | `"png"` |
| `quality` | `integer` (1–100) | `85` |
| `maxWidth` | `integer` (≥1) | `1920` |

## Installing locally for testing

```bash
# From the repo root
node apps/cli/dist/index.js plugin install ./examples/plugin-standalone-tool
node apps/cli/dist/index.js repl
> tool start example-image-processor
```
