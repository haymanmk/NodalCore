import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { ConnectionOptions, SettingsRecord } from '@nodalcore/sdk'

interface HostWindowMessage {
  pluginId: string
  message: string
  level?: 'info' | 'warning' | 'error'
}

/**
 * Exposes a safe, typed API to the renderer process via window.__nodalcore.
 * No Node.js APIs are leaked — only these explicit methods.
 */
contextBridge.exposeInMainWorld('__nodalcore', {
  listInstalled: () => ipcRenderer.invoke('plugin:list'),

  install: (idOrUrl: string) => ipcRenderer.invoke('plugin:install', idOrUrl),

  uninstall: (id: string) => ipcRenderer.invoke('plugin:uninstall', id),

  connect: (id: string, options?: ConnectionOptions) =>
    ipcRenderer.invoke('device:connect', id, options),

  disconnect: (id: string) => ipcRenderer.invoke('device:disconnect', id),

  readSettings: (id: string): Promise<SettingsRecord> =>
    ipcRenderer.invoke('settings:read', id),

  writeSettings: (id: string, settings: Partial<SettingsRecord>) =>
    ipcRenderer.invoke('settings:write', id, settings),

  startTool: (id: string) => ipcRenderer.invoke('tool:start', id),

  stopTool: (id: string) => ipcRenderer.invoke('tool:stop', id),

  /** Subscribe to plugin → host.window.showMessage events. Returns an unsubscribe fn. */
  onHostMessage: (handler: (msg: HostWindowMessage) => void) => {
    const listener = (_e: IpcRendererEvent, msg: HostWindowMessage) => handler(msg)
    ipcRenderer.on('host:window:showMessage', listener)
    return () => {
      ipcRenderer.off('host:window:showMessage', listener)
    }
  },

  getContributions: () => ipcRenderer.invoke('contributions:list'),

  showPanel: (pluginId: string, slotId: string, htmlPath: string) =>
    ipcRenderer.invoke('workspace:show-panel', pluginId, slotId, htmlPath),

  hidePanel: () => ipcRenderer.invoke('workspace:hide-panel'),

  destroyPanel: (pluginId: string, slotId: string) =>
    ipcRenderer.invoke('workspace:destroy-panel', pluginId, slotId),

  setWorkspaceBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('workspace:set-bounds', bounds),

  /** Tell main the renderer has mounted; main flushes any queued toasts. */
  signalReady: () => ipcRenderer.invoke('host:ready'),

  /** Read the last-used connection options for a plugin (or null if none stored). */
  readConnection: (pluginId: string, expectedType: string) =>
    ipcRenderer.invoke('connection:read', pluginId, expectedType),
})
