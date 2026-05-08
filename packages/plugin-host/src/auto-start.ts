import type { ConnectionType, PluginManifest } from '@nodalcore/sdk'
import { listInstalledPlugins } from './installer.js'
import { getConfiguration } from './configuration.js'
import { getConnectionOptions } from './connection-store.js'
import { loadDevicePlugin } from './loader.js'
import { spawnTool } from './spawner.js'

/**
 * Reserved configuration key that controls whether a plugin is brought up
 * when NodalCore launches. Lives under
 * `manifest.contributes.configuration.properties[AUTO_START_KEY]` (plugin
 * may declare it to set a default and customise the SettingsPanel field) and
 * `~/.nodalcore/configurations.json[pluginId][AUTO_START_KEY]` (user's
 * stored preference, written by the SettingsPanel).
 *
 * Resolution precedence: stored value (boolean) → manifest default (boolean)
 * → `false`.
 */
export const AUTO_START_KEY = 'autoStart'

export function shouldAutoStart(
  manifest: PluginManifest,
  storedConfig: Record<string, unknown> | undefined | null,
): boolean {
  const stored = storedConfig?.[AUTO_START_KEY]
  if (typeof stored === 'boolean') return stored
  const manifestDefault =
    manifest.contributes?.configuration?.properties?.[AUTO_START_KEY]?.default
  return typeof manifestDefault === 'boolean' ? manifestDefault : false
}

export type AutoStartLevel = 'info' | 'warning' | 'error'

export interface AutoStartContext {
  /** Surface a result to the user. The desktop wires this to a system toast. */
  emit: (level: AutoStartLevel, message: string) => void
}

export interface AutoStartDeps {
  listInstalledPlugins: typeof listInstalledPlugins
  getConfiguration: typeof getConfiguration
  getConnectionOptions: typeof getConnectionOptions
  loadDevicePlugin: typeof loadDevicePlugin
  spawnTool: typeof spawnTool
}

const defaultDeps: AutoStartDeps = {
  listInstalledPlugins,
  getConfiguration,
  getConnectionOptions,
  loadDevicePlugin,
  spawnTool,
}

/**
 * Iterate every installed plugin and start the ones whose effective
 * `autoStart` resolves to true. Per-plugin failures are caught and surfaced
 * via `ctx.emit` — one bad plugin must never prevent the rest from starting
 * or block app launch.
 */
export async function autoStartInstalledPlugins(
  ctx: AutoStartContext,
  deps: AutoStartDeps = defaultDeps,
): Promise<void> {
  const entries = await deps.listInstalledPlugins()
  await Promise.allSettled(entries.map((entry) => startOne(entry.manifest, ctx, deps)))
}

async function startOne(
  manifest: PluginManifest,
  ctx: AutoStartContext,
  deps: AutoStartDeps,
): Promise<void> {
  const stored = await deps.getConfiguration(manifest.id).catch(() => null)
  if (!shouldAutoStart(manifest, stored)) return

  try {
    if (manifest.type === 'device-bridge') {
      const ct = manifest.connectionType
      if (!ct) {
        ctx.emit(
          'warning',
          `${manifest.name}: auto-start skipped — device-bridge plugin has no connectionType in its manifest.`,
        )
        return
      }
      const opts = await deps.getConnectionOptions(manifest.id, ct as ConnectionType)
      if (!opts) {
        ctx.emit(
          'warning',
          `${manifest.name}: auto-start skipped — connect once from the Installed page so the connection options can be saved.`,
        )
        return
      }
      const proxy = await deps.loadDevicePlugin(manifest.id)
      await proxy.connect(opts)
      ctx.emit('info', `${manifest.name}: auto-started.`)
    } else if (manifest.type === 'standalone-tool') {
      await deps.spawnTool(manifest.id)
      ctx.emit('info', `${manifest.name}: auto-started.`)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.emit('error', `${manifest.name}: auto-start failed — ${msg}`)
  }
}
