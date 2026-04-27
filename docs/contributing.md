# Contributing

## Prerequisites

- Node.js 20+
- pnpm 9+
- Git

```bash
git clone https://github.com/nodalcore/nodalcore.git
cd nodalcore
pnpm install
```

## Development workflow

```bash
# Start the desktop app with hot-reload
pnpm dev

# Type-check all packages
pnpm typecheck

# Lint
pnpm lint

# Format
pnpm format
```

Changes to any file under `packages/` are picked up immediately by the
desktop dev server because `electron.vite.config.ts` aliases all
`@nodalcore/*` imports to their TypeScript source.

## Branch strategy

| Branch | Purpose |
|---|---|
| `main` | Stable, always deployable |
| `dev` | Integration branch — PRs target here |
| `feat/<name>` | Feature branches, cut from `dev` |
| `fix/<name>` | Bug fix branches, cut from `dev` |

## Adding a new package

1. Create `packages/<name>/` with `package.json`, `tsconfig.json`, and
   `tsup.config.ts` following the pattern of an existing package.
2. Add `"@nodalcore/<name>": "workspace:*"` to any consumer's
   `package.json`.
3. Add a Vite alias in `apps/desktop/electron.vite.config.ts` (and
   `apps/web/vite.config.ts` if applicable) so the source is resolved
   directly in dev.
4. Add a `README.md` to the package explaining its public API.

## Adding a new UI component

1. Create the component in `packages/renderer/src/components/`.
2. Export it from `packages/renderer/src/index.ts`.
3. Add CSS in `packages/renderer/src/styles/index.css` using the existing
   CSS custom properties (`--accent`, `--surface`, etc.).

## Writing a plugin

See [`docs/plugin-spec.md`](./plugin-spec.md) for the full `nodal.json`
specification and the `DevicePlugin` / standalone-tool contracts. The
`examples/` directory contains reference implementations.

Quick start:

```bash
# Copy the device-bridge example
cp -r examples/plugin-device-bridge my-plugin
cd my-plugin
# Edit nodal.json (change id, name, connectionType, settingsSchema)
# Edit src/index.ts (implement connect/disconnect/readSettings/writeSettings)

# Install locally for testing
node apps/cli/dist/index.js plugin install ./my-plugin
```

## Commit style

```
<type>: <short summary>

<optional body>

Co-Authored-By: …
```

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`.

Keep the subject line under 72 characters. Body is optional but encouraged
for non-obvious changes.

## Pull requests

- Target the `dev` branch.
- One logical change per PR.
- Include a short description of *why*, not just *what*.
- All `pnpm typecheck` and `pnpm lint` checks must pass.
