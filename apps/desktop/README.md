# @nodalcore/desktop

Electron 34 desktop application. Hosts the plugin store UI, manages plugin
installation, runs device-bridge plugins in forked workers, spawns
standalone-tool processes, and renders panel webviews. The renderer
(`@nodalcore/renderer`) reaches the Node side exclusively through the
preload bridge.

## Structure

```
src/
  main/
    index.ts            Wires IPC handlers, BrowserWindow, tray, modal dispatcher
    tray.ts             System tray icon + Open/Quit menu, unread-toast indicator
    window-state.ts     Visibility helpers; close [X] hides to tray
    notifications/
      queue.ts          Queue toasts emitted while the window is hidden
      modal.ts          Native dialog dispatcher (FIFO-serialized) for
                        window.showWarning / window.showModal
    webviews/
      protocol.ts       nodal-plugin:// privileged scheme + per-request handler
      manager.ts        WebContentsView lifecycle (one panel visible at a time)
      routing.ts        Bridges panel ↔ plugin via the broker

  preload/
    index.ts            BrowserWindow contextBridge → window.__nodalcore
    webview.ts          Separate preload for WebContentsViews → window.nodalcore

  renderer/
    index.html          Shell HTML
    src/main.tsx        Mounts <App /> from @nodalcore/renderer
```

## Running

```bash
pnpm dev      # electron-vite dev — hot-reload for main / preload / renderer
pnpm build    # electron-vite build → out/
pnpm preview  # run the built app
```

> The `dev` script runs `scripts/dev.mjs`, which `delete`s
> `ELECTRON_RUN_AS_NODE` from the child environment before spawning
> `electron-vite dev`. Claude Code presets that var to `1`, which makes
> Electron boot as plain Node.js; the wrapper removes that ambiguity
> identically on POSIX shells and Windows.

## IPC surface

The renderer reaches main through `window.__nodalcore` (BrowserWindow
preload). Panel webviews reach main through a separate `window.nodalcore`
bridge (webview preload).

### Renderer → main (`window.__nodalcore`)

| Channel | Action |
|---|---|
| `plugin:list` | `listInstalledPlugins()` |
| `plugin:install` | `installPlugin({ source })` — clone/copy + validate + register |
| `plugin:uninstall` | `uninstallPlugin(id)` |
| `device:connect` | `loadDevicePlugin(id)` then `plugin.connect(options)`; persists `options` to the connection-options store on success |
| `device:disconnect` | `unloadDevicePlugin(id)` |
| `connection:read` | Read the last-used `ConnectionOptions` for a plugin (used to pre-fill the Connect dialog) |
| `tool:start` | `spawnTool(id)` — returns the tool's port |
| `tool:stop` | `stopTool(id)` |
| `settings:read` | `getConfiguration(id)` from the host configuration store |
| `settings:write` | `setConfiguration(id, values)` — merge into host store |
| `workspace:show-panel` | Create / show a `WebContentsView` for `(pluginId, slotId, htmlPath)` |
| `workspace:hide-panel` | Hide the active panel (view kept around for re-open) |
| `workspace:destroy-panel` | Tear down a panel view |
| `workspace:set-bounds` | Renderer's `ResizeObserver` reports the layout rectangle |
| `host:ready` | Renderer signals it is mounted; main flushes the queued-toast buffer |

### Main → renderer (push)

| Channel | Purpose |
|---|---|
| `host:window:showMessage` | Toast emitted by a plugin (or replayed from the queue on `host:ready`) |
| `webview:msg-from-plugin` | Plugin → panel messages, delivered to the right `WebContents` |

### Webview → main (`window.nodalcore`, panel preload)

| Channel | Purpose |
|---|---|
| `webview:msg-to-plugin` | Panel JS calls `window.nodalcore.postMessage(data)`; main resolves `(pluginId, slotId)` from the sender and routes through the broker to the plugin's `ctx.views.onMessage` handler |

The full panel pipeline (privileged scheme registration, CSP, layout
choreography, message routing) is documented in
[`docs/webviews.md`](../../docs/webviews.md).

## Vite aliases

`electron.vite.config.ts` resolves all `@nodalcore/*` imports to TypeScript
source at dev time — no package rebuilds needed during development. The
preload bundle has two entries (`index` + `webview`) so the panel preload
ships independently of the BrowserWindow preload.

## Troubleshooting

### `pnpm install` fails downloading Electron with a self-signed certificate

Common on Windows behind a corporate TLS-intercepting proxy (Zscaler,
NetSkope, BlueCoat, Cisco Umbrella, etc.). Electron's postinstall script
fetches the platform binary from GitHub releases over HTTPS, and the
intercepting proxy presents a corporate root CA that Node doesn't trust
out of the box.

Symptoms:

```
RequestError: self-signed certificate in certificate chain
RequestError: unable to verify the first certificate
```

Try these in order — stop at the first one that works:

1. **Point Node at your corporate root CA (recommended).** Export the
   intercepting root certificate from the Windows certificate store (or
   ask IT for the `.crt` / `.pem`) and set `NODE_EXTRA_CA_CERTS` so Node
   loads it in addition to the bundled CAs.

   Verified working: add it to the project's `.npmrc` so lifecycle scripts
   (including Electron's postinstall) inherit it:

   ```ini
   # .npmrc
   NODE_EXTRA_CA_CERTS=C:\path\to\corp-root.crt
   ```

   Or as a user-level env var (PowerShell):

   ```powershell
   setx NODE_EXTRA_CA_CERTS "C:\path\to\corp-root.crt"
   ```

   Cert verification stays enabled — this just teaches Node which CA to
   trust.

2. **`cafile=` in `.npmrc` (pnpm-native).** Equivalent for pnpm's own HTTP
   client (does not propagate to child Node processes the way
   `NODE_EXTRA_CA_CERTS` does, so prefer option 1 unless only pnpm itself
   is failing):

   ```ini
   # .npmrc
   cafile=C:\path\to\corp-root.crt
   ```

3. **Electron-specific knobs.** If only Electron's binary download fails
   while regular `pnpm install` traffic is fine:

   ```ini
   # .npmrc
   ELECTRON_GET_USE_PROXY=true
   ```

   plus `HTTPS_PROXY=http://proxy.corp:8080` in your shell, or point at an
   internal mirror with `electron_mirror=https://internal.mirror/electron/`.

4. **Last resort: `strict-ssl=false`.** Disables TLS verification for
   pnpm globally and weakens your install pipeline. Only use as a
   temporary unblock — do **not** commit a `.npmrc` with this setting:

   ```ini
   # .npmrc — INSECURE, prefer options 1–3
   strict-ssl=false
   ```

### Installing a plugin from inside the app fails with the same TLS error

Same root cause as `pnpm install`, different code path. The runtime install
hits two HTTPS endpoints from Electron's main process: the registry
`index.json` and the plugin's artifact `.tgz`. Symptom looks like:

```
Artifact download failed: self-signed certificate in certificate chain
Registry fetch failed: unable to verify the first certificate
```

**Desktop app:** No action required. The main process routes both fetches
through Electron's `net.fetch`, which uses Chromium's TLS stack and reads the
**Windows certificate store**. If your IT department has pre-installed the
corporate root CA there (which is how the proxy works in the first place),
the app already trusts it.

If the desktop app still fails after this, it means the corporate root isn't
actually in the Windows store. Open `certmgr.msc` → *Trusted Root
Certification Authorities* and confirm the intercepting root is listed; if
it's not, ask IT to push it.

**CLI / headless (`@nodalcore/cli`):** The CLI runs under plain Node, not
Electron, so it falls back to Node's bundled CA list. Set
`NODE_EXTRA_CA_CERTS` in the shell that launches it:

```powershell
$env:NODE_EXTRA_CA_CERTS = "C:\path\to\corp-root.crt"
nodalcore install <plugin-id>
```

**Git-cloned plugins (legacy path):** If a registry entry has no
`artifacts[]` the installer falls back to `git clone`. Git for Windows ships
its own CA bundle and does **not** consult the Windows cert store by
default. Switch it to the OS backend once, globally:

```powershell
git config --global http.sslBackend schannel
```

After that, Git validates against the same Windows store the desktop app
uses.
