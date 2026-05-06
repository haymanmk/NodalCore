import { useContributions } from '../contributions/registry.js'

/**
 * Renders the row of declarative statusBar slots contributed by installed
 * plugins. Each slot is an empty pill labeled by its `<pluginId>:<slotId>`
 * — the actual pill content comes from a webview in commit 5b. Until then
 * the chrome shows that the contribution surface exists.
 */
export function StatusBar() {
  const { contributions } = useContributions()
  const left = contributions.statusBar.filter((s) => s.alignment === 'left')
  const right = contributions.statusBar.filter((s) => s.alignment === 'right')

  if (left.length === 0 && right.length === 0) return null

  return (
    <footer className="status-bar">
      <div className="status-bar__group status-bar__group--left">
        {left.map((slot) => (
          <SlotPill key={`${slot.pluginId}:${slot.slotId}`} pluginId={slot.pluginId} slotId={slot.slotId} />
        ))}
      </div>
      <div className="status-bar__group status-bar__group--right">
        {right.map((slot) => (
          <SlotPill key={`${slot.pluginId}:${slot.slotId}`} pluginId={slot.pluginId} slotId={slot.slotId} />
        ))}
      </div>
    </footer>
  )
}

function SlotPill({ pluginId, slotId }: { pluginId: string; slotId: string }) {
  return (
    <span className="status-bar__pill" title={`${pluginId}:${slotId}`}>
      <span className="status-bar__pill-plugin">{pluginId}</span>
      <span className="status-bar__pill-sep">·</span>
      <span className="status-bar__pill-slot">{slotId}</span>
    </span>
  )
}
