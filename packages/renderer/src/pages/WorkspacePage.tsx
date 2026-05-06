import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useContributions, type ContributedPanelWebview } from '../contributions/registry.js'

interface WorkspaceBridge {
  showPanel?: (pluginId: string, slotId: string, htmlPath: string) => Promise<unknown>
  hidePanel?: () => Promise<unknown>
  setWorkspaceBounds?: (b: { x: number; y: number; width: number; height: number }) => Promise<unknown>
}

function getBridge(): WorkspaceBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as Window & { __nodalcore?: WorkspaceBridge }).__nodalcore
}

/**
 * Workspace tab — left rail of panel-launcher entries, right side is an empty
 * area whose rectangle main fills with a `WebContentsView`. The renderer never
 * lays out where the webview lives; it just measures and reports.
 *
 * Hot-reload note: main's `did-finish-load` listener tears down all child
 * views on every renderer reload, so this page can mount fresh without
 * stepping on orphaned native views.
 */
export function WorkspacePage() {
  const { contributions } = useContributions()
  const bridge = getBridge()
  const panels = contributions.panels.filter((p) => p.htmlPath)

  const [activeKey, setActiveKey] = useState<string | null>(null)
  const areaRef = useRef<HTMLDivElement>(null)

  const reportBounds = useCallback(() => {
    if (!areaRef.current || !bridge?.setWorkspaceBounds) return
    const r = areaRef.current.getBoundingClientRect()
    void bridge.setWorkspaceBounds({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
    })
  }, [bridge])

  // Re-report on every layout change. ResizeObserver covers content-box
  // changes; the explicit window 'resize' covers the parent BrowserWindow.
  useLayoutEffect(() => {
    if (!areaRef.current) return
    reportBounds()
    const ro = new ResizeObserver(reportBounds)
    ro.observe(areaRef.current)
    window.addEventListener('resize', reportBounds)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', reportBounds)
    }
  }, [reportBounds])

  // When this page unmounts (user switches to Store/Installed), hide the
  // active panel so the WebContentsView doesn't bleed across tabs.
  useEffect(() => {
    return () => {
      void bridge?.hidePanel?.()
    }
  }, [bridge])

  const onSelect = useCallback(
    async (panel: ContributedPanelWebview) => {
      const key = `${panel.pluginId}::${panel.slotId}`
      setActiveKey(key)
      reportBounds()
      try {
        await bridge?.showPanel?.(panel.pluginId, panel.slotId, panel.htmlPath)
      } catch (err) {
        console.error('[workspace] showPanel failed', err)
      }
    },
    [bridge, reportBounds],
  )

  const empty = useMemo(() => panels.length === 0, [panels.length])

  return (
    <div className="workspace">
      <aside className="workspace__rail">
        <header className="workspace__rail-header">Panels</header>
        {empty ? (
          <p className="workspace__empty-rail">
            No plugin contributes a panel webview yet. Plugins declare them
            under <code>contributes.views.panel</code> in <code>nodal.json</code>.
          </p>
        ) : (
          <ul className="workspace__panel-list">
            {panels.map((p) => {
              const key = `${p.pluginId}::${p.slotId}`
              return (
                <li key={key}>
                  <button
                    className={`workspace__panel-item ${
                      activeKey === key ? 'workspace__panel-item--active' : ''
                    }`}
                    onClick={() => void onSelect(p)}
                  >
                    <span className="workspace__panel-name">{p.name}</span>
                    <span className="workspace__panel-plugin">{p.pluginId}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </aside>
      <section className="workspace__area" ref={areaRef}>
        {!activeKey && (
          <div className="workspace__hint">
            {empty
              ? 'Install a plugin that contributes a panel webview to see it here.'
              : 'Select a panel from the left to load it.'}
          </div>
        )}
      </section>
    </div>
  )
}
