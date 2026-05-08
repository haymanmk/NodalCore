import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// Lazy: each call resolves homedir so tests (and any future sandboxing) can
// redirect via $HOME between cases. Resolving once at module load would pin
// the path to whatever HOME was set at import time.
function configFile(): string {
  return path.join(os.homedir(), '.nodalcore', 'configurations.json')
}

type ConfigStore = Record<string, Record<string, unknown>>

async function readStore(): Promise<ConfigStore> {
  try {
    const raw = await fs.readFile(configFile(), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ConfigStore
    }
    return {}
  } catch {
    return {}
  }
}

async function writeStore(store: ConfigStore): Promise<void> {
  const file = configFile()
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(store, null, 2), 'utf8')
}

export type ConfigurationChangeEmitter = (
  pluginId: string,
  newConfig: Record<string, unknown>,
) => void | Promise<void>

let configurationChangeEmitter: ConfigurationChangeEmitter | null = null

/**
 * Hook the host into post-write notifications. Whenever `setConfiguration`
 * succeeds, the emitter is invoked with the merged plugin configuration so
 * the host can push it to the (possibly running) plugin worker. Default is
 * no-op — CLI/headless contexts don't need to notify any worker.
 *
 * Errors thrown by the emitter are caught and logged; they never propagate
 * back to the writer (the user-facing setting save shouldn't fail because
 * the plugin's handler threw).
 */
export function setConfigurationChangeEmitter(
  emitter: ConfigurationChangeEmitter | null,
): void {
  configurationChangeEmitter = emitter
}

export async function getConfiguration(pluginId: string): Promise<Record<string, unknown>> {
  const store = await readStore()
  return store[pluginId] ?? {}
}

export async function setConfiguration(
  pluginId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const store = await readStore()
  store[pluginId] = { ...store[pluginId], ...values }
  await writeStore(store)
  const emitter = configurationChangeEmitter
  if (emitter) {
    void Promise.resolve()
      .then(() => emitter(pluginId, store[pluginId]!))
      .catch((err) => {
        console.warn(
          `[host] configuration-change emitter threw for ${pluginId}:`,
          err,
        )
      })
  }
}

export async function clearConfiguration(pluginId: string): Promise<void> {
  const store = await readStore()
  delete store[pluginId]
  await writeStore(store)
}
