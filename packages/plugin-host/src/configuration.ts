import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const CONFIG_FILE = path.join(os.homedir(), '.nodalcore', 'configurations.json')

type ConfigStore = Record<string, Record<string, unknown>>

async function readStore(): Promise<ConfigStore> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8')
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
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true })
  await fs.writeFile(CONFIG_FILE, JSON.stringify(store, null, 2), 'utf8')
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
}

export async function clearConfiguration(pluginId: string): Promise<void> {
  const store = await readStore()
  delete store[pluginId]
  await writeStore(store)
}

export { CONFIG_FILE }
