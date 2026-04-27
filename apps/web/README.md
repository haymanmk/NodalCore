# @nodalcore/web

Read-only Vite web application that renders the plugin catalog. Useful for
browsing available plugins without the Electron desktop app.

## Limitations

The web app is intentionally **read-only**:

- Plugin installation is disabled (no Node.js, no `git clone`).
- Device connection is disabled (no serial/USB/BLE access from a browser).
- `usePluginBridge` returns stubs that throw on any write operation.

## Running

```bash
pnpm --filter @nodalcore/web dev     # dev server at http://localhost:5174
pnpm --filter @nodalcore/web build  # static site → apps/web/dist/
```

## Deployment

The `dist/` output is a fully static site. It can be served from any CDN or
GitHub Pages. Set `NODALCORE_REGISTRY_URL` at build time if using a custom
registry.
