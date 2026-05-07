import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { ConnectionOptions } from '@nodalcore/sdk'

type ConnectionsStore = Record<string, ConnectionOptions>

// Lazy: each call resolves homedir so tests can redirect via $HOME between cases.
function connectionsFilePath(): string {
  return path.join(os.homedir(), '.nodalcore', 'connections.json')
}

async function readStore(): Promise<ConnectionsStore> {
  try {
    const raw = await fs.readFile(connectionsFilePath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ConnectionsStore
    }
    return {}
  } catch {
    return {}
  }
}

async function writeStore(store: ConnectionsStore): Promise<void> {
  const file = connectionsFilePath()
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(store, null, 2), 'utf8')
}

/**
 * Read the last-used connection options for a plugin, or null if none stored.
 * The host validates the discriminator matches what the plugin's manifest
 * declares; a stale stored value (manifest changed plugin types since save)
 * is treated as "no value" rather than handed back wrong.
 */
export async function getConnectionOptions(
  pluginId: string,
  expectedType: string,
): Promise<ConnectionOptions | null> {
  const store = await readStore()
  const entry = store[pluginId]
  if (!entry) return null
  if (entry.connectionType !== expectedType) return null
  return entry
}

export async function setConnectionOptions(
  pluginId: string,
  options: ConnectionOptions,
): Promise<void> {
  const store = await readStore()
  store[pluginId] = options
  await writeStore(store)
}

export async function clearConnectionOptions(pluginId: string): Promise<void> {
  const store = await readStore()
  delete store[pluginId]
  await writeStore(store)
}
