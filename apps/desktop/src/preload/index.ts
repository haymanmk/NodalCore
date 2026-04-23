import { contextBridge, ipcRenderer } from 'electron'
import type { ConnectionOptions, SettingsRecord } from '@nodalcore/sdk'

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
})
