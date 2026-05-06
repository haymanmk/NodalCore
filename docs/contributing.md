# Contributing

## Prerequisites

- Node.js 20+
- pnpm 9+
- Git
- A working X display if you want to run `pnpm dev` (electron needs one).

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

# Build everything (workspace packages, examples, CLI)
pnpm -r build
```

Changes to any file under `packages/` or `apps/desktop/src/` are picked
up immediately by the desktop dev server because
`electron.vite.config.ts` aliases all `@nodalcore/*` imports to their
TypeScript source. Plugin code at `examples/*/src/` is bundled by tsup
on save (`pnpm --filter <name> dev`) — the installed plugin copy at
`~/.nodalcore/plugins/<id>/` does NOT auto-update; reinstall after
rebuild.

## Branch strategy

| Branch | Purpose |
|---|---|
| `main` | Stable, always deployable |
| `dev` | Integration branch — PRs target here |
| `feat/<name>` | Feature branches, cut from `dev` |
| `fix/<name>` | Bug-fix branches, cut from `dev` |

## Adding a new package

1. Create `packages/<name>/` with `package.json`, `tsconfig.json`, and
   `tsup.config.ts` following the pattern of an existing package.
2. Add `"@nodalcore/<name>": "workspace:*"` to any consumer's
   `package.json`.
3. Add a Vite alias in `apps/desktop/electron.vite.config.ts` (and
   `apps/web/vite.config.ts` if the renderer needs it) so source is
   resolved directly in dev.
4. Add a `README.md` to the package explaining its public API.

## Adding a new UI component

1. Create the component in `packages/renderer/src/components/`.
2. Export it from `packages/renderer/src/index.ts` if it's part of the
   shared surface.
3. Add CSS in `packages/renderer/src/styles/index.css` using the
   existing CSS custom properties (`--accent`, `--surface`, etc.).

## Writing a plugin

See [`plugin-spec.md`](./plugin-spec.md) for the `nodal.json` reference,
[`host-api.md`](./host-api.md) for the `ctx` surface, and
[`webviews.md`](./webviews.md) for panel webviews. The `examples/`
directory contains reference implementations — see
[`examples.md`](./examples.md) for a code walkthrough.

Quick start:

```bash
# Copy a reference plugin
cp -r examples/plugin-device-bridge plugins/my-sensor
cd plugins/my-sensor

# Edit nodal.json: id, name, connectionType, contributes.configuration,
# any contributes.themes / views.panel.
# Edit src/index.ts: implement connect/disconnect, then activate(ctx).

pnpm install
pnpm build  # bundles src/ → dist/index.js (self-contained — see plugin-packaging.md)

# Install locally for testing
node ../../apps/cli/dist/index.js plugin install .
```

The host-side configuration store is per-plugin
(`~/.nodalcore/configurations.json`); plugins read via
`ctx.workspace.getConfiguration()`. Settings forms are RJSF-driven
straight from `manifest.contributes.configuration.properties` — never
hand-coded in the renderer.

## Updating the SDK

Both reference plugins declare `"sdkVersion": "^0.2.0"`. The host
enforces compatibility at install time via
`semver.satisfies(SDK_VERSION, manifest.sdkVersion)`. **When you bump
the SDK in `packages/sdk/package.json`, also bump `SDK_VERSION` in
`packages/sdk/src/version.ts`** — they must stay in lockstep, or the
installer silently lets mismatched plugins through.

## Running the examples end-to-end

```bash
pnpm install
pnpm -r build
node apps/cli/dist/index.js plugin install ./examples/plugin-device-bridge
node apps/cli/dist/index.js plugin install ./examples/plugin-standalone-tool
pnpm dev
```

See [`examples.md`](./examples.md) for the expected behaviour in each
tab.

## Commit style

```
<type>(<scope>): <short summary>

<optional body>

Co-Authored-By: …
```

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`. Add `!` after
the type for breaking changes (e.g. `feat(sdk)!: …`).

Keep the subject line under 72 characters. Body is optional but
encouraged for non-obvious changes — explain *why*, not *what*.

## Pull requests

- Target the `dev` branch.
- One logical change per PR (or a tightly coupled group, e.g. a fix
  plus its test).
- Include a short description of *why*, not just *what*.
- All `pnpm typecheck` checks must pass. `pnpm lint` is currently
  broken on `@eslint/js` resolution; flag it if you fix it.

## Validation before reporting work as done

- Run `pnpm typecheck` for any code change.
- For UI changes, run `pnpm dev` and exercise the affected screen.
  Type-check passing ≠ feature working.
- For plugin-host changes, exercise both example plugins
  (`examples/plugin-device-bridge` for fork-IPC, `examples/plugin-standalone-tool`
  for spawn + gRPC).
