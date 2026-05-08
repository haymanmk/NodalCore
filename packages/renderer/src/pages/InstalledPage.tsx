import { useCallback, useEffect, useState } from 'react'
import type { JSONSchema7 } from 'json-schema'
import { usePluginBridge } from '../hooks/usePluginBridge.js'
import { SettingsPanel } from '../components/SettingsPanel.js'
import { ConnectDialog } from '../components/ConnectDialog.js'
import { connectionSchemas } from '@nodalcore/sdk/schemas/connection'
import type { ConnectionOptions, ConnectionType, SettingsRecord } from '@nodalcore/sdk'
import type { PluginManifest } from '@nodalcore/sdk'

/** Reserved configuration key — kept in sync with packages/plugin-host/src/auto-start.ts. */
const AUTO_START_KEY = 'autoStart'

const HOST_AUTO_START_FIELD: JSONSchema7 = {
  type: 'boolean',
  title: 'Start automatically',
  description: 'Bring this plugin up when NodalCore opens.',
  default: false,
}

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

function configurationToSchema(manifest: PluginManifest): JSONSchema7 {
  const cfg = manifest.contributes?.configuration
  const userProps = cfg?.properties ?? {}
  // Inject the host-reserved autoStart field unless the plugin already
  // declared one (so plugin authors can customise the default/title).
  const properties = AUTO_START_KEY in userProps
    ? userProps
    : { ...userProps, [AUTO_START_KEY]: HOST_AUTO_START_FIELD }
  return { type: 'object', title: cfg?.title ?? manifest.name, properties }
}

interface PluginSettingsProps {
  pluginId: string
  schema: JSONSchema7
  onSubmit: (pluginId: string, settings: SettingsRecord) => Promise<void>
  readSettings: (pluginId: string) => Promise<SettingsRecord>
}

/**
 * Wrapper around SettingsPanel that loads stored settings per plugin so the
 * form reflects what's currently saved (including the autoStart toggle).
 * Without this, RJSF defaults always win and the user can't tell whether
 * they've previously enabled auto-start.
 */
function PluginSettings({ pluginId, schema, onSubmit, readSettings }: PluginSettingsProps) {
  const [formData, setFormData] = useState<SettingsRecord | undefined>(undefined)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let cancelled = false
    readSettings(pluginId).then((data) => {
      if (cancelled) return
      setFormData(data)
      setLoaded(true)
    }).catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [pluginId, readSettings])
  if (!loaded) return null
  return (
    <SettingsPanel
      pluginId={pluginId}
      schema={schema}
      formData={formData}
      onSubmit={onSubmit}
    />
  )
}

export function InstalledPage() {
  const { installedPlugins, connect, disconnect, startTool, stopTool, writeSettings, readSettings, readConnection } = usePluginBridge()

  const [dialogFor, setDialogFor] = useState<{
    pluginId: string
    pluginName: string
    connectionType: ConnectionType
    initialOptions: ConnectionOptions | null
  } | null>(null)

  const onConnectClick = useCallback(
    async (entry: { manifest: { id: string; name: string; connectionType?: string } }) => {
      const ct = entry.manifest.connectionType
      if (!ct || !(ct in connectionSchemas)) {
        // Unknown/missing connectionType — fall back to no-options behaviour.
        // Plugins can still log + use defaults inside their connect().
        console.warn(
          `[connect] no built-in schema for connectionType="${ct ?? '<unset>'}" on plugin ${entry.manifest.id}; opening with empty options`,
        )
        await connect(entry.manifest.id)
        return
      }
      const initial = await readConnection(entry.manifest.id, ct)
      setDialogFor({
        pluginId: entry.manifest.id,
        pluginName: entry.manifest.name,
        connectionType: ct as ConnectionType,
        initialOptions: initial,
      })
    },
    [connect, readConnection],
  )

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
                      onClick={() => onConnectClick(entry)}
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

            {/*
              Always render — even idle plugins need their settings panel so
              the user can toggle autoStart before the first manual connect.
              The host persists writes regardless of running state and pushes
              workspace.configurationChanged to plugins that ARE loaded.
            */}
            <PluginSettings
              pluginId={entry.manifest.id}
              schema={configurationToSchema(entry.manifest)}
              readSettings={readSettings}
              onSubmit={async (id, settings) => {
                await writeSettings(id, settings)
              }}
            />
          </div>
        ))}
      </div>

      {dialogFor && (
        <ConnectDialog
          pluginId={dialogFor.pluginId}
          pluginName={dialogFor.pluginName}
          connectionType={dialogFor.connectionType}
          initialOptions={dialogFor.initialOptions}
          onSubmit={async (options) => {
            await connect(dialogFor.pluginId, options)
            setDialogFor(null)
          }}
          onCancel={() => setDialogFor(null)}
        />
      )}
    </div>
  )
}
