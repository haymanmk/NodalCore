# NodalCore — documentation

NodalCore is a desktop hub for hardware-integration plugins, modeled on
VSCode's three-pillar extension architecture: a **manifest** declares what a
plugin contributes; a **`contributes` block** registers themes, settings,
sidebar/statusBar slots, and panel webviews; and a **uniform host API** is
exposed to every plugin regardless of its plugin type.

If you only read one document, read [`architecture.md`](./architecture.md).
The rest are reference and walkthroughs.

## Map

| If you want to … | Read … |
|---|---|
| Understand the system end-to-end | [`architecture.md`](./architecture.md) |
| Write a plugin from scratch | [`plugin-spec.md`](./plugin-spec.md) → [`host-api.md`](./host-api.md) → [`examples.md`](./examples.md) |
| Add a panel webview to a plugin | [`webviews.md`](./webviews.md) |
| Publish a plugin / understand artifacts | [`plugin-packaging.md`](./plugin-packaging.md) |
| Hack on NodalCore itself | [`contributing.md`](./contributing.md) |

## Vocabulary

| Term | Meaning |
|---|---|
| **Manifest** | `nodal.json` at the plugin root — metadata + activation entry only |
| **Contributes** | Declarative block in the manifest registering themes / configuration / sidebar / statusBar / panel webviews |
| **Host API** | `ctx.window` / `ctx.workspace` / `ctx.views` — the surface a plugin uses to call into the host |
| **Plugin host** | `@nodalcore/plugin-host` — installer, fork-loader, gRPC spawner, contributions aggregator |
| **device-bridge** | Plugin type that wraps a physical device. Runs in a forked Node child via the SDK's IPC transport. |
| **standalone-tool** | Plugin type that ships an independent process. Talks to the host over gRPC. |
| **Panel webview** | Plugin-supplied HTML loaded in a native `WebContentsView` inside the Workspace tab |
| **`nodal-plugin://`** | Privileged scheme that serves files from `~/.nodalcore/plugins/<id>/` to panel webviews |
