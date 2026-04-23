import React, { useEffect, useState, useCallback } from 'react'
import { fetchIndex, searchPlugins } from '@nodalcore/registry-client'
import type { RegistryPluginEntry } from '@nodalcore/registry-client'
import { PluginCard } from '../components/PluginCard.js'
import { usePluginBridge } from '../hooks/usePluginBridge.js'
import { MOCK_REGISTRY } from '../mockRegistry.js'

export function StorePage() {
  const [plugins, setPlugins] = useState<RegistryPluginEntry[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<Set<string>>(new Set())

  const { installedPluginIds, install, uninstall } = usePluginBridge()

  useEffect(() => {
    fetchIndex()
      .then((index) => {
        const list = index.plugins.length > 0 ? index.plugins : MOCK_REGISTRY.plugins
        setPlugins(list)
      })
      .catch(() => {
        setPlugins(MOCK_REGISTRY.plugins)
      })
      .finally(() => setLoading(false))
  }, [])

  const handleSearch = useCallback(
    async (q: string) => {
      setQuery(q)
      if (!q) {
        setPlugins(MOCK_REGISTRY.plugins)
        return
      }
      const lq = q.toLowerCase()
      const results = MOCK_REGISTRY.plugins.filter(
        (p) =>
          p.name.toLowerCase().includes(lq) ||
          p.description.toLowerCase().includes(lq) ||
          p.tags.some((t) => t.toLowerCase().includes(lq)),
      )
      setPlugins(results)

      // Also try the live registry if available
      searchPlugins({ query: q }).then(setPlugins).catch(() => {})
    },
    [],
  )

  const handleInstall = useCallback(
    async (id: string) => {
      setInstalling((prev) => new Set(prev).add(id))
      try {
        await install(id)
      } finally {
        setInstalling((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    },
    [install],
  )

  if (loading) {
    return (
      <div className="store-page__loading">
        <div className="store-page__spinner" />
        <span>Loading registry…</span>
      </div>
    )
  }

  return (
    <div className="store-page">
      <div className="store-page__header">
        <h2 className="store-page__heading">Plugin Store</h2>
        <span className="store-page__count">{plugins.length} plugins</span>
      </div>

      <div className="store-page__search">
        <span className="store-page__search-icon">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </span>
        <input
          type="search"
          placeholder="Search plugins…"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          aria-label="Search plugins"
        />
      </div>

      <div className="store-page__grid">
        {plugins.map((plugin) => (
          <PluginCard
            key={plugin.id}
            plugin={plugin}
            installed={installedPluginIds.has(plugin.id)}
            installing={installing.has(plugin.id)}
            onInstall={handleInstall}
            onUninstall={uninstall}
          />
        ))}

        {plugins.length === 0 && (
          <div className="store-page__empty">No plugins match your search.</div>
        )}
      </div>
    </div>
  )
}
