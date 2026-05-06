import path from 'node:path'
import { fork, type ChildProcess } from 'node:child_process'
import { PLUGINS_DIR, readAndValidateManifest } from './installer.js'
import type { DevicePlugin, ConnectionOptions, SettingsRecord } from '@nodalcore/sdk'

interface LoadedPlugin {
  pluginId: string
  process: ChildProcess
  // Resolve/reject queues for pending IPC calls
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>
  nextSeq: number
}

const loaded = new Map<string, LoadedPlugin>()

/**
 * Load a JS/TS device-bridge plugin in an isolated child process.
 * The child process runs a thin plugin-host worker that dynamic-imports
 * the plugin entry and exposes it over Node IPC.
 */
export async function loadDevicePlugin(pluginId: string): Promise<DevicePlugin> {
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

  const child = fork(workerPath, [entryPath], {
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

  child.on('message', (msg: unknown) => {
    const m = msg as { seq: number; ok: boolean; result?: unknown; error?: string }
    const pending = entry.pending.get(m.seq)
    if (!pending) return
    entry.pending.delete(m.seq)
    if (m.ok) {
      pending.resolve(m.result)
    } else {
      pending.reject(new Error(m.error ?? 'Unknown plugin error'))
    }
  })

  child.on('exit', () => loaded.delete(pluginId))

  // Wait for the worker to signal it is ready
  await call(entry, 'init', {})

  // Return a proxy that delegates method calls over IPC
  return createProxy(entry)
}

function call(entry: LoadedPlugin, method: string, args: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const seq = entry.nextSeq++
    entry.pending.set(seq, { resolve, reject })
    entry.process.send({ seq, method, args })
  })
}

function createProxy(entry: LoadedPlugin): DevicePlugin {
  // We cast through unknown because DevicePlugin is abstract —
  // the actual implementation lives in the child process.
  return {
    connectionType: 'serial', // overridden by manifest; proxy only used for dispatch
    connect: (options: ConnectionOptions) => call(entry, 'connect', options) as Promise<void>,
    disconnect: () => call(entry, 'disconnect', {}) as Promise<void>,
    getSettingsSchema: () => {
      // Synchronous in the interface — return cached schema from IPC init response
      // TODO: cache schema during init and return it here
      throw new Error('getSettingsSchema() must be called after init; use readSchema() instead')
    },
    readSettings: () => call(entry, 'readSettings', {}) as Promise<SettingsRecord>,
    writeSettings: (settings: Partial<SettingsRecord>) => call(entry, 'writeSettings', settings) as Promise<void>,
  } as unknown as DevicePlugin
}

export async function unloadDevicePlugin(pluginId: string): Promise<void> {
  const entry = loaded.get(pluginId)
  if (!entry) return
  await call(entry, 'disconnect', {}).catch(() => {})
  entry.process.kill()
  loaded.delete(pluginId)
}
