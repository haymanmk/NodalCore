import path from 'node:path'
import { fork, type ChildProcess } from 'node:child_process'
import { PLUGINS_DIR, readAndValidateManifest } from './installer.js'
import type { DevicePlugin, ConnectionOptions } from '@nodalcore/sdk'
import { dispatchHostRequest } from './broker.js'

interface IpcMessage {
  kind: 'request' | 'response'
  seq: number
  method?: string
  args?: unknown
  result?: unknown
  error?: string
}

interface LoadedPlugin {
  pluginId: string
  process: ChildProcess
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>
  nextSeq: number
}

const loaded = new Map<string, LoadedPlugin>()

/**
 * Load a JS/TS device-bridge plugin in an isolated child process.
 * The worker imports the plugin module, calls `activate(ctx)` if present,
 * and dispatches `connect`/`disconnect`/`shutdown` over bidirectional IPC.
 */
export async function loadDevicePlugin(pluginId: string): Promise<DevicePlugin> {
  const existing = loaded.get(pluginId)
  if (existing) return createProxy(existing)

  const pluginDir = path.join(PLUGINS_DIR, pluginId)
  const manifest = await readAndValidateManifest(pluginDir)

  if (manifest.type !== 'device-bridge') {
    throw new Error(`Plugin ${pluginId} is not a device-bridge plugin`)
  }
  if (!manifest.main) {
    throw new Error(`Plugin ${pluginId} has no "main" field in nodal.json`)
  }

  const entryPath = path.resolve(pluginDir, manifest.main)
  const workerPath = new URL('./worker.js', import.meta.url).pathname

  const child = fork(workerPath, [entryPath, pluginId], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    serialization: 'advanced',
  })

  const entry: LoadedPlugin = {
    pluginId,
    process: child,
    pending: new Map(),
    nextSeq: 1,
  }
  loaded.set(pluginId, entry)

  child.on('message', async (raw: unknown) => {
    const msg = raw as IpcMessage
    if (!msg || (msg.kind !== 'request' && msg.kind !== 'response')) return

    if (msg.kind === 'response') {
      const p = entry.pending.get(msg.seq)
      if (!p) return
      entry.pending.delete(msg.seq)
      if (msg.error !== undefined) p.reject(new Error(msg.error))
      else p.resolve(msg.result)
      return
    }

    if (msg.method === undefined) return
    try {
      const result = await dispatchHostRequest(pluginId, msg.method, msg.args)
      child.send({ kind: 'response', seq: msg.seq, result })
    } catch (err) {
      child.send({
        kind: 'response',
        seq: msg.seq,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })

  child.on('exit', () => loaded.delete(pluginId))

  await call(entry, 'init', null)

  return createProxy(entry)
}

function call(entry: LoadedPlugin, method: string, args: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const seq = entry.nextSeq++
    entry.pending.set(seq, { resolve, reject })
    entry.process.send({ kind: 'request', seq, method, args })
  })
}

function createProxy(entry: LoadedPlugin): DevicePlugin {
  return {
    connectionType: 'serial',
    connect: (options: ConnectionOptions) => call(entry, 'connect', options) as Promise<void>,
    disconnect: () => call(entry, 'disconnect', null) as Promise<void>,
  } as unknown as DevicePlugin
}

export async function unloadDevicePlugin(pluginId: string): Promise<void> {
  const entry = loaded.get(pluginId)
  if (!entry) return
  await call(entry, 'shutdown', null).catch(() => {})
  await call(entry, 'disconnect', null).catch(() => {})
  entry.process.kill()
  loaded.delete(pluginId)
}

/**
 * Issue a host → plugin request over the loaded plugin's IPC transport.
 * Used by the panel webview routing to forward `views.message` calls into
 * handlers a plugin registered via `ctx.views.onMessage(slotId, …)`.
 * Throws if the plugin is not currently loaded — UI should ensure the
 * device is connected before opening its panel.
 */
export function sendToPlugin(
  pluginId: string,
  method: string,
  args: unknown,
): Promise<unknown> {
  const entry = loaded.get(pluginId)
  if (!entry) {
    throw new Error(`Plugin ${pluginId} is not loaded — connect the device first`)
  }
  return call(entry, method, args)
}
