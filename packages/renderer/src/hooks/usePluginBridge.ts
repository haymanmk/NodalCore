import { useState, useEffect, useCallback, useMemo } from 'react'
import type { PluginManifest, SettingsRecord } from '@nodalcore/sdk'

/**
 * Abstraction over the NodalCore IPC bridge.
 *
 * In Electron (apps/desktop), `window.__nodalcore` is injected by the preload
 * script via contextBridge. In apps/web, it falls back to a REST/fetch
 * implementation (catalog-browse only — no device access).
 */

interface InstalledPluginEntry {
  manifest: PluginManifest
  installedAt: string
  status: 'idle' | 'running' | 'error'
}

interface NodalCoreBridge {
  listInstalled: () => Promise<InstalledPluginEntry[]>
  install: (idOrUrl: string) => Promise<void>
  uninstall: (id: string) => Promise<void>
  connect: (id: string) => Promise<void>
  disconnect: (id: string) => Promise<void>
  readSettings: (id: string) => Promise<SettingsRecord>
  writeSettings: (id: string, settings: Partial<SettingsRecord>) => Promise<void>
}

function getBridge(): NodalCoreBridge {
  // Electron preload injects window.__nodalcore
  const w = typeof window !== 'undefined' ? (window as Window & { __nodalcore?: NodalCoreBridge }) : undefined
  if (w?.__nodalcore) return w.__nodalcore

  // Web fallback — read-only, no install/connect
  return {
    listInstalled: async () => [],
    install: async () => { throw new Error('Install not available in web mode') },
    uninstall: async () => { throw new Error('Uninstall not available in web mode') },
    connect: async () => { throw new Error('Connect not available in web mode') },
    disconnect: async () => {},
    readSettings: async () => ({}),
    writeSettings: async () => { throw new Error('Write not available in web mode') },
  }
}

export function usePluginBridge() {
  const bridge = useMemo(() => getBridge(), [])
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPluginEntry[]>([])

  const refresh = useCallback(async () => {
    const list = await bridge.listInstalled()
    setInstalledPlugins(list)
  }, [bridge])

  useEffect(() => { refresh() }, [refresh])

  const install = useCallback(async (idOrUrl: string) => {
    await bridge.install(idOrUrl)
    await refresh()
  }, [bridge, refresh])

  const uninstall = useCallback(async (id: string) => {
    await bridge.uninstall(id)
    await refresh()
  }, [bridge, refresh])

  const connect = useCallback(async (id: string) => {
    await bridge.connect(id)
    await refresh()
  }, [bridge, refresh])

  const disconnect = useCallback(async (id: string) => {
    await bridge.disconnect(id)
    await refresh()
  }, [bridge, refresh])

  const readSettings = useCallback(
    (id: string) => bridge.readSettings(id),
    [bridge],
  )

  const writeSettings = useCallback(
    (id: string, settings: Partial<SettingsRecord>) => bridge.writeSettings(id, settings),
    [bridge],
  )

  const installedPluginIds = new Set(installedPlugins.map((p) => p.manifest.id))

  return {
    installedPlugins,
    installedPluginIds,
    install,
    uninstall,
    connect,
    disconnect,
    readSettings,
    writeSettings,
    refresh,
  }
}
