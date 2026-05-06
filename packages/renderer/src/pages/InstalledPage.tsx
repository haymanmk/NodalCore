import { useState } from 'react'
import type { JSONSchema7 } from 'json-schema'
import { usePluginBridge } from '../hooks/usePluginBridge.js'
import { SettingsPanel } from '../components/SettingsPanel.js'
import type { SettingsRecord } from '@nodalcore/sdk'
import type { PluginManifest } from '@nodalcore/sdk'

function PluginIcon({ manifest }: { manifest: PluginManifest }) {
  const [err, setErr] = useState(false)
  if (!manifest.icon || err) {
    const initials = manifest.name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase()
    const hue = (manifest.name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) * 37) % 360
    return (
      <div
        className="installed-page__item-icon"
        style={{ background: `hsl(${hue} 60% 40%)` }}
      >
        {initials}
      </div>
    )
  }
  return (
    <div className="installed-page__item-icon">
      <img src={manifest.icon} alt="" width={36} height={36} onError={() => setErr(true)} />
    </div>
  )
}

function configurationToSchema(
  cfg: NonNullable<NonNullable<PluginManifest['contributes']>['configuration']>,
): JSONSchema7 {
  return { type: 'object', title: cfg.title, properties: cfg.properties }
}

export function InstalledPage() {
  const { installedPlugins, connect, disconnect, startTool, stopTool, writeSettings } = usePluginBridge()

  if (installedPlugins.length === 0) {
    return (
      <div className="installed-page__empty">
        <div className="installed-page__empty-icon">⬡</div>
        <p>No plugins installed. Browse the store to add one.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="installed-page__header-row">
        <h2 className="installed-page__heading">Installed</h2>
        <span className="installed-page__count">{installedPlugins.length} installed</span>
      </div>

      <div className="installed-page__list">
        {installedPlugins.map((entry) => (
          <div key={entry.manifest.id} className="installed-page__item">
            <div className="installed-page__item-header">
              <PluginIcon manifest={entry.manifest} />

              <div className="installed-page__item-info">
                <div className="installed-page__item-name">{entry.manifest.name}</div>
                <div className="installed-page__item-meta">
                  v{entry.manifest.version} · {entry.manifest.type === 'device-bridge' ? 'Device' : 'Tool'}
                  {entry.manifest.connectionType ? ` · ${entry.manifest.connectionType}` : ''}
                </div>
              </div>

              <span className={`installed-page__status installed-page__status--${entry.status}`}>
                <span className="installed-page__status-dot" />
                {entry.status}
              </span>

              <div className="installed-page__item-actions">
                {entry.manifest.type === 'device-bridge' ? (
                  entry.status === 'idle' || entry.status === 'error' ? (
                    <button
                      className="installed-page__btn installed-page__btn--connect"
                      onClick={() => connect(entry.manifest.id)}
                    >
                      Connect
                    </button>
                  ) : (
                    <button
                      className="installed-page__btn installed-page__btn--disconnect"
                      onClick={() => disconnect(entry.manifest.id)}
                    >
                      Disconnect
                    </button>
                  )
                ) : (
                  entry.status === 'idle' || entry.status === 'error' ? (
                    <button
                      className="installed-page__btn installed-page__btn--connect"
                      onClick={() => startTool(entry.manifest.id)}
                    >
                      Start
                    </button>
                  ) : (
                    <button
                      className="installed-page__btn installed-page__btn--disconnect"
                      onClick={() => stopTool(entry.manifest.id)}
                    >
                      Stop
                    </button>
                  )
                )}
              </div>
            </div>

            {entry.status === 'running' && entry.manifest.contributes?.configuration && (
              <SettingsPanel
                pluginId={entry.manifest.id}
                schema={configurationToSchema(entry.manifest.contributes.configuration)}
                onSubmit={async (id: string, settings: SettingsRecord) => {
                  await writeSettings(id, settings)
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
