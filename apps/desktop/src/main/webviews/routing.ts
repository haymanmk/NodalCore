import { ipcMain, type WebContents } from 'electron'
import { registerHostHandler } from '@nodalcore/plugin-host'
import { findByWebContents, sendToPanel } from './manager.js'

/**
 * Bridges `WebContentsView` (panel) and the loaded plugin module.
 *
 * webview → plugin:
 *   webview's preload calls `ipcRenderer.invoke('webview:msg-to-plugin', data)`.
 *   We look up the (pluginId, slotId) from the sending WebContents, ask the
 *   plugin via its `views.message` handler (registered by the SDK's
 *   `createExtensionContext`), and return the plugin's response back through
 *   the invoke promise.
 *
 * plugin → webview:
 *   plugin calls `ctx.views.postMessage(slotId, data)`. The plugin's IPC
 *   transport emits a `views.postMessage` request which we register on the
 *   broker — we forward it to the matching open panel view (or no-op if the
 *   panel isn't currently mounted; coalescing/replay is the plugin's
 *   responsibility, see `coalesceLastWins` in the SDK).
 */
export function registerWebviewRouting(opts: {
  /**
   * Resolve `(pluginId, slotId, data)` into an awaited response from the
   * plugin's `views.message` handler. The desktop main wires this to the
   * device-bridge loader's request channel; standalone-tool plugins return
   * `null` (no host → tool callback path yet).
   */
  invokeOnPlugin: (pluginId: string, slotId: string, data: unknown) => Promise<unknown>
}): void {
  ipcMain.handle('webview:msg-to-plugin', async (event, data: unknown) => {
    const sender: WebContents = event.sender
    const ownership = findByWebContents(sender)
    if (!ownership) {
      throw new Error('webview:msg-to-plugin received from an untracked WebContents')
    }
    return opts.invokeOnPlugin(ownership.pluginId, ownership.slotId, data)
  })

  // Plugin → webview. Fired when the plugin's worker calls
  // `ctx.views.postMessage(slotId, data)`. Handler is keyed on the same
  // broker the IPC loader and gRPC server use.
  registerHostHandler('views.postMessage', (pluginId, args) => {
    const { slotId, data } = (args as { slotId: string; data: unknown } | undefined) ?? {
      slotId: '',
      data: null,
    }
    return sendToPanel(pluginId, slotId, data)
  })
}
