import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

/**
 * Preload exposed inside `WebContentsView`s loaded via `nodal-plugin://`.
 * Plugin webview HTML interacts with the host strictly through this surface
 * — there is no direct IPC, no Node, no `require`.
 *
 * Symmetric with the worker-side surface in @nodalcore/sdk's
 * `createExtensionContext`: webview `postMessage(data)` round-trips to the
 * plugin's `ctx.views.onMessage(slotId, …)` handler. Inbound `onMessage`
 * receives whatever the plugin pushed via `ctx.views.postMessage(slotId, data)`.
 */
contextBridge.exposeInMainWorld('nodalcore', {
  postMessage: (data: unknown) => ipcRenderer.invoke('webview:msg-to-plugin', data),
  onMessage: (handler: (data: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, data: unknown) => handler(data)
    ipcRenderer.on('webview:msg-from-plugin', listener)
    return () => {
      ipcRenderer.off('webview:msg-from-plugin', listener)
    }
  },
})
