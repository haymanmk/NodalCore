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

## Developing a plugin outside the monorepo

`@nodalcore/sdk` is not yet on npm. To author a plugin in a project
that lives outside this repo, use [yalc](https://github.com/wclr/yalc)
as a local registry. yalc survives `pnpm install` (unlike `pnpm link`,
which gets clobbered) and works cleanly with this repo's tsup-bundled
plugin layout.

**One-time setup**, from this repo:

```bash
# Build the SDK and publish it to your machine's yalc store.
# Re-run this every time you want consumers to pick up SDK changes.
pnpm sdk:publish-local
```

That builds `packages/sdk` and runs `yalc publish --push`, which
propagates to any external project that has already added the SDK via
`yalc add`.

**In your external plugin project:**

```bash
# Install yalc once (yalc itself is not on npm under @nodalcore;
# install it globally or use npx):
npm i -g yalc          # or: npx yalc add @nodalcore/sdk

# First time only — registers @nodalcore/sdk in your project from
# the local yalc store:
yalc add @nodalcore/sdk
pnpm install           # (or npm install / yarn) to wire up node_modules
```

After that, the iteration loop is:

```
[in NodalCore]              [in your plugin project]
edit packages/sdk/src/...
pnpm sdk:publish-local  ──► consumers auto-update via `yalc push`
                            pnpm build  # rebundle your plugin
```

A few things to watch:

- **Bundle the SDK into your plugin.** Use the tsup config from
  [`plugin-packaging.md`](./plugin-packaging.md) (`noExternal: [/.*/]`
  + the `createRequire` banner). The installed copy at
  `~/.nodalcore/plugins/<id>/` is run against an empty
  `node_modules` — anything not inlined will throw
  `ERR_MODULE_NOT_FOUND` at activation.
- **Match `sdkVersion`.** Your manifest's `sdkVersion` semver range
  must satisfy `SDK_VERSION` in `packages/sdk/src/version.ts`. If you
  bump the SDK locally, bump that constant too — the installer
  rejects mismatches.
- **Peer-style deps aren't auto-resolved.** yalc only ships
  `@nodalcore/sdk`. If your plugin uses anything else from this repo
  (e.g. `@nodalcore/renderer` for shared components), publish that
  package with yalc the same way.
- **Cleanup.** `pnpm sdk:remove-local` clears yalc's record of
  consumers if your project tree gets out of sync; in the consumer,
  `yalc remove @nodalcore/sdk` (or `yalc retreat`) drops the local
  link and restores the registry version (none, currently).

When the SDK is eventually published to npm, the only change in your
external project is `yalc remove @nodalcore/sdk && pnpm add @nodalcore/sdk`.

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
