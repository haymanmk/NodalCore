/**
 * Plugin-host worker — runs in a forked child process.
 *
 * Bidirectional IPC:
 *   host → plugin: 'init' | 'connect' | 'disconnect' | 'shutdown'
 *   plugin → host: 'window.showMessage' | 'workspace.getConfiguration' | …
 *
 * Both directions share the same `{ kind: 'request' | 'response', seq, … }`
 * envelope (see @nodalcore/sdk/host/ipc-adapter.ts). Plugins consume the
 * plugin → host direction through `ExtensionContext`, never directly.
 */

import { createIpcTransport, createExtensionContext } from '@nodalcore/sdk'

const entryPath = process.argv[2]
const pluginId = process.argv[3] ?? 'unknown'

if (!entryPath) {
  process.send?.({ kind: 'response', seq: 0, error: 'No entry path provided' })
  process.exit(1)
}

const transport = createIpcTransport()

interface ConnectablePlugin {
  connect(options: unknown): Promise<unknown> | unknown
  disconnect(): Promise<unknown> | unknown
}

let pluginInstance: Partial<ConnectablePlugin> | null = null
let deactivateFn: (() => unknown | Promise<unknown>) | null = null

transport.onRequest('init', async () => {
  const mod = await import(entryPath)
  const ctor = mod.default ?? mod
  pluginInstance = (typeof ctor === 'function' ? new ctor() : ctor) as Partial<ConnectablePlugin>

  if (typeof mod.activate === 'function') {
    const ctx = createExtensionContext(transport, pluginId)
    await mod.activate(ctx)
  }
  if (typeof mod.deactivate === 'function') {
    deactivateFn = mod.deactivate
  }
  return null
})

transport.onRequest('connect', async (args) => {
  if (!pluginInstance?.connect) throw new Error('Plugin does not implement connect()')
  return pluginInstance.connect(args)
})

transport.onRequest('disconnect', async () => {
  if (!pluginInstance?.disconnect) throw new Error('Plugin does not implement disconnect()')
  return pluginInstance.disconnect()
})

transport.onRequest('shutdown', async () => {
  if (deactivateFn) {
    try { await deactivateFn() } catch (err) { console.error('[plugin] deactivate failed:', err) }
  }
  pluginInstance = null
  deactivateFn = null
  return null
})
