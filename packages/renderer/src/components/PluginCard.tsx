import { useState } from 'react'
import type { RegistryPluginEntry } from '@nodalcore/registry-client'

export interface PluginCardProps {
  plugin: RegistryPluginEntry
  installed: boolean
  installing?: boolean
  onInstall: (id: string) => void
  onUninstall: (id: string) => void
}

function IconFallback({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
  const hue = (name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) * 37) % 360
  return (
    <div
      className="plugin-card__icon"
      style={{ background: `hsl(${hue} 60% 40%)` }}
    >
      {initials}
    </div>
  )
}

export function PluginCard({
  plugin,
  installed,
  installing = false,
  onInstall,
  onUninstall,
}: PluginCardProps) {
  const [iconError, setIconError] = useState(false)

  const showFallback = !plugin.icon || iconError

  return (
    <div className="plugin-card">
      <div className="plugin-card__icon-wrap">
        {showFallback ? (
          <IconFallback name={plugin.name} />
        ) : (
          <div className="plugin-card__icon">
            <img
              src={plugin.icon}
              alt=""
              width={48}
              height={48}
              onError={() => setIconError(true)}
            />
          </div>
        )}
      </div>

      <div className="plugin-card__body">
        <h3 className="plugin-card__name">{plugin.name}</h3>
        <p className="plugin-card__description">{plugin.description}</p>

        <div className="plugin-card__meta">
          <span className={`plugin-card__type-badge plugin-card__type-badge--${plugin.type}`}>
            {plugin.type === 'device-bridge' ? 'Device' : 'Tool'}
          </span>
          {plugin.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="plugin-card__tag">
              {tag}
            </span>
          ))}
          {plugin.installs != null && (
            <span className="plugin-card__installs">↓ {plugin.installs.toLocaleString()}</span>
          )}
        </div>
      </div>

      <div className="plugin-card__action">
        {installed ? (
          <button
            className="plugin-card__btn plugin-card__btn--installed"
            onClick={() => onUninstall(plugin.id)}
            title={`Uninstall ${plugin.name}`}
            aria-label={`Uninstall ${plugin.name}`}
          >
            ✓
          </button>
        ) : (
          <button
            className="plugin-card__btn plugin-card__btn--install"
            onClick={() => onInstall(plugin.id)}
            disabled={installing}
            title={`Install ${plugin.name}`}
            aria-label={`Install ${plugin.name}`}
          >
            {installing ? '…' : '+'}
          </button>
        )}
      </div>
    </div>
  )
}
